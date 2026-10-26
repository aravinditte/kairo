package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib" // pgx driver for database/sql

	"github.com/aravinditte/kairo/internal/metrics"
	"github.com/aravinditte/kairo/internal/model"
	"github.com/aravinditte/kairo/migrations"
)

// PostgresStore is the durable Store backed by PostgreSQL via the pgx stdlib
// driver. The schema comes verbatim from the embedded migrations/*.sql files,
// which are the single source of truth for the schema.
type PostgresStore struct {
	db *sql.DB
}

// NewPostgresStore connects to the database, pings it, and applies embedded
// migrations in filename order.
func NewPostgresStore(ctx context.Context, dsn string) (*PostgresStore, error) {
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return nil, fmt.Errorf("open postgres: %w", err)
	}
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(30 * time.Minute)
	s := &PostgresStore{db: db}
	pingCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err := db.PingContext(pingCtx); err != nil {
		db.Close()
		return nil, fmt.Errorf("ping postgres: %w", err)
	}
	if err := s.migrate(ctx); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

func (s *PostgresStore) migrate(ctx context.Context) error {
	if _, err := s.db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`); err != nil {
		return fmt.Errorf("migrations bookkeeping: %w", err)
	}
	entries, err := migrations.FS.ReadDir(".")
	if err != nil {
		return fmt.Errorf("read migrations: %w", err)
	}
	names := []string{}
	for _, e := range entries {
		if !e.IsDir() {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)
	for _, name := range names {
		var exists bool
		if err := s.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=$1)`, name).Scan(&exists); err != nil {
			return fmt.Errorf("check migration %s: %w", name, err)
		}
		if exists {
			continue
		}
		body, err := migrations.FS.ReadFile(name)
		if err != nil {
			return fmt.Errorf("read migration %s: %w", name, err)
		}
		tx, err := s.db.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, string(body)); err != nil {
			tx.Rollback()
			return fmt.Errorf("apply migration %s: %w", name, err)
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO schema_migrations(version) VALUES($1)`, name); err != nil {
			tx.Rollback()
			return fmt.Errorf("record migration %s: %w", name, err)
		}
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("commit migration %s: %w", name, err)
		}
	}
	return nil
}

func (s *PostgresStore) Mode() string { return "postgres" }

func (s *PostgresStore) Ping(ctx context.Context) error { return s.db.PingContext(ctx) }

func (s *PostgresStore) Close() error { return s.db.Close() }

// --- projects ---

func encodeThresholds(t model.Thresholds) []byte {
	b, _ := json.Marshal(t)
	return b
}

func scanProject(rows interface{ Scan(...any) error }) (model.Project, error) {
	var p model.Project
	var thJSON []byte
	if err := rows.Scan(&p.ID, &p.Name, &p.CreatedAt, &p.UpdatedAt, &p.RetentionDays, &thJSON); err != nil {
		return model.Project{}, err
	}
	if len(thJSON) > 0 {
		_ = json.Unmarshal(thJSON, &p.Thresholds)
	}
	p.CreatedAt = p.CreatedAt.UTC()
	p.UpdatedAt = p.UpdatedAt.UTC()
	return p, nil
}

const projectCols = `id, name, created_at, updated_at, retention_days, thresholds`

func (s *PostgresStore) CreateProject(p model.Project) error {
	_, err := s.db.ExecContext(context.Background(),
		`INSERT INTO projects(id,name,created_at,updated_at,retention_days,thresholds) VALUES($1,$2,$3,$4,$5,$6)`,
		p.ID, p.Name, p.CreatedAt, p.UpdatedAt, p.RetentionDays, encodeThresholds(p.Thresholds))
	return err
}

func (s *PostgresStore) ListProjects() []model.Project {
	rows, err := s.db.QueryContext(context.Background(), `SELECT `+projectCols+` FROM projects ORDER BY created_at ASC`)
	if err != nil {
		return []model.Project{}
	}
	defer rows.Close()
	out := []model.Project{}
	for rows.Next() {
		p, err := scanProject(rows)
		if err != nil {
			continue
		}
		out = append(out, p)
	}
	return out
}

func (s *PostgresStore) GetProject(id string) (model.Project, bool) {
	row := s.db.QueryRowContext(context.Background(), `SELECT `+projectCols+` FROM projects WHERE id=$1`, id)
	p, err := scanProject(row)
	if err != nil {
		return model.Project{}, false
	}
	return p, true
}

func (s *PostgresStore) UpdateProject(p model.Project) (model.Project, bool) {
	res, err := s.db.ExecContext(context.Background(),
		`UPDATE projects SET name=$2, updated_at=$3, retention_days=$4, thresholds=$5 WHERE id=$1`,
		p.ID, p.Name, p.UpdatedAt, p.RetentionDays, encodeThresholds(p.Thresholds))
	if err != nil {
		return model.Project{}, false
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return model.Project{}, false
	}
	got, _ := s.GetProject(p.ID)
	return got, true
}

func (s *PostgresStore) DeleteProject(id string) bool {
	res, err := s.db.ExecContext(context.Background(), `DELETE FROM projects WHERE id=$1`, id)
	if err != nil {
		return false
	}
	n, _ := res.RowsAffected()
	return n > 0
}

// --- API keys ---

func (s *PostgresStore) CreateAPIKey(meta model.APIKeyMeta, keyHash string) error {
	_, err := s.db.ExecContext(context.Background(),
		`INSERT INTO api_keys(id,project_id,key_hash,created_at,revoked_at,last_used_at) VALUES($1,$2,$3,$4,$5,$6)`,
		meta.ID, meta.ProjectID, keyHash, meta.CreatedAt, meta.RevokedAt, meta.LastUsedAt)
	return err
}

func scanKey(rows interface{ Scan(...any) error }) (model.APIKeyMeta, error) {
	var m model.APIKeyMeta
	err := rows.Scan(&m.ID, &m.ProjectID, &m.CreatedAt, &m.RevokedAt, &m.LastUsedAt)
	return m, err
}

const keyCols = `id, project_id, created_at, revoked_at, last_used_at`

func (s *PostgresStore) ListAPIKeys(projectID string) []model.APIKeyMeta {
	rows, err := s.db.QueryContext(context.Background(), `SELECT `+keyCols+` FROM api_keys WHERE project_id=$1 ORDER BY created_at ASC`, projectID)
	if err != nil {
		return []model.APIKeyMeta{}
	}
	defer rows.Close()
	out := []model.APIKeyMeta{}
	for rows.Next() {
		m, err := scanKey(rows)
		if err != nil {
			continue
		}
		out = append(out, m)
	}
	return out
}

func (s *PostgresStore) GetAPIKeyByHash(hash string) (model.APIKeyMeta, string, bool) {
	row := s.db.QueryRowContext(context.Background(),
		`SELECT `+keyCols+`, key_hash FROM api_keys WHERE key_hash=$1`, hash)
	var m model.APIKeyMeta
	var stored string
	if err := row.Scan(&m.ID, &m.ProjectID, &m.CreatedAt, &m.RevokedAt, &m.LastUsedAt, &stored); err != nil {
		return model.APIKeyMeta{}, "", false
	}
	return m, stored, true
}

func (s *PostgresStore) GetAPIKeyByID(id string) (model.APIKeyMeta, bool) {
	row := s.db.QueryRowContext(context.Background(), `SELECT `+keyCols+` FROM api_keys WHERE id=$1`, id)
	m, err := scanKey(row)
	if err != nil {
		return model.APIKeyMeta{}, false
	}
	return m, true
}

func (s *PostgresStore) RevokeAPIKey(id string, at time.Time) (model.APIKeyMeta, bool) {
	_, err := s.db.ExecContext(context.Background(), `UPDATE api_keys SET revoked_at=$2 WHERE id=$1`, id, at)
	if err != nil {
		return model.APIKeyMeta{}, false
	}
	return s.GetAPIKeyByID(id)
}

func (s *PostgresStore) TouchAPIKey(id string, at time.Time) {
	_, _ = s.db.ExecContext(context.Background(), `UPDATE api_keys SET last_used_at=$2 WHERE id=$1`, id, at)
}

// --- spans ---

func (s *PostgresStore) InsertSpans(ctx context.Context, spans []model.Span) (int, int, error) {
	if len(spans) == 0 {
		return 0, 0, nil
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, 0, err
	}
	defer tx.Rollback()
	stmt, err := tx.PrepareContext(ctx, `INSERT INTO spans(project_id,trace_id,span_id,parent_span_id,service_name,operation_name,span_kind,start_time,end_time,duration_ns,status_code,status_message,resource_attributes,span_attributes,events,links,ingested_at)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) ON CONFLICT (project_id,trace_id,span_id) DO NOTHING`)
	if err != nil {
		return 0, 0, err
	}
	defer stmt.Close()
	inserted := 0
	for _, sp := range spans {
		var parent any
		if sp.ParentSpanID != "" {
			parent = sp.ParentSpanID
		}
		var msg any
		if sp.StatusMessage != "" {
			msg = sp.StatusMessage
		}
		resAttrs, _ := json.Marshal(orEmptyMap(sp.ResourceAttributes))
		spanAttrs, _ := json.Marshal(orEmptyMap(sp.SpanAttributes))
		events, _ := json.Marshal(orEmptyEvents(sp.Events))
		links, _ := json.Marshal(orEmptyLinks(sp.Links))
		res, err := stmt.ExecContext(ctx, sp.ProjectID, sp.TraceID, sp.SpanID, parent, sp.ServiceName, sp.OperationName, sp.SpanKind, sp.StartTime, sp.EndTime, sp.DurationNs, sp.StatusCode, msg, resAttrs, spanAttrs, events, links, sp.IngestedAt)
		if err != nil {
			return 0, 0, err
		}
		n, _ := res.RowsAffected()
		if n > 0 {
			inserted++
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, 0, err
	}
	return inserted, len(spans) - inserted, nil
}

func orEmptyMap(m map[string]any) map[string]any {
	if m == nil {
		return map[string]any{}
	}
	return m
}

func orEmptyEvents(e []model.SpanEvent) []model.SpanEvent {
	if e == nil {
		return []model.SpanEvent{}
	}
	return e
}

func orEmptyLinks(l []model.SpanLink) []model.SpanLink {
	if l == nil {
		return []model.SpanLink{}
	}
	return l
}

const spanCols = `project_id, trace_id, span_id, COALESCE(parent_span_id,''), service_name, operation_name, span_kind, start_time, end_time, duration_ns, status_code, COALESCE(status_message,''), resource_attributes, span_attributes, events, links, ingested_at`

func scanSpan(rows *sql.Rows) (model.Span, error) {
	var sp model.Span
	var resAttrs, spanAttrs, events, links []byte
	err := rows.Scan(&sp.ProjectID, &sp.TraceID, &sp.SpanID, &sp.ParentSpanID, &sp.ServiceName, &sp.OperationName, &sp.SpanKind, &sp.StartTime, &sp.EndTime, &sp.DurationNs, &sp.StatusCode, &sp.StatusMessage, &resAttrs, &spanAttrs, &events, &links, &sp.IngestedAt)
	if err != nil {
		return model.Span{}, err
	}
	sp.ResourceAttributes = map[string]any{}
	sp.SpanAttributes = map[string]any{}
	_ = json.Unmarshal(resAttrs, &sp.ResourceAttributes)
	_ = json.Unmarshal(spanAttrs, &sp.SpanAttributes)
	_ = json.Unmarshal(events, &sp.Events)
	_ = json.Unmarshal(links, &sp.Links)
	if sp.Events == nil {
		sp.Events = []model.SpanEvent{}
	}
	if sp.Links == nil {
		sp.Links = []model.SpanLink{}
	}
	sp.StartTime = sp.StartTime.UTC()
	sp.EndTime = sp.EndTime.UTC()
	sp.IngestedAt = sp.IngestedAt.UTC()
	return sp, nil
}

func (s *PostgresStore) QuerySpans(ctx context.Context, projectID string, start, end time.Time, service, operation string, limit int) ([]model.Span, error) {
	if limit <= 0 || limit > maxQuerySpans {
		limit = maxQuerySpans
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+spanCols+` FROM spans WHERE project_id=$1 AND start_time>=$2 AND start_time<$3 AND ($4='' OR service_name=$4) AND ($5='' OR operation_name=$5) ORDER BY start_time ASC LIMIT $6`,
		projectID, start, end, service, operation, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []model.Span{}
	for rows.Next() {
		sp, err := scanSpan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, sp)
	}
	return out, rows.Err()
}

func (s *PostgresStore) GetTraceSpans(ctx context.Context, projectID, traceID string) ([]model.Span, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+spanCols+` FROM spans WHERE project_id=$1 AND trace_id=$2 ORDER BY start_time ASC`, projectID, traceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []model.Span{}
	for rows.Next() {
		sp, err := scanSpan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, sp)
	}
	return out, rows.Err()
}

func (s *PostgresStore) SearchTraces(ctx context.Context, projectID string, f model.TraceSearchFilter) (model.TraceSearchPage, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+spanCols+` FROM spans WHERE project_id=$1 AND start_time>=$2 AND start_time<$3 ORDER BY start_time ASC`, projectID, f.Start, f.End)
	if err != nil {
		return model.TraceSearchPage{}, err
	}
	defer rows.Close()
	all := []model.Span{}
	for rows.Next() {
		sp, err := scanSpan(rows)
		if err != nil {
			return model.TraceSearchPage{}, err
		}
		all = append(all, sp)
	}
	if err := rows.Err(); err != nil {
		return model.TraceSearchPage{}, err
	}
	needsMatch := f.Service != "" || f.Operation != "" || f.Status != "" || f.TraceID != ""
	matching := make(map[string]bool)
	for _, sp := range all {
		if !needsMatch || MatchesSpan(sp, f) {
			matching[sp.TraceID] = true
		}
	}
	relevant := []model.Span{}
	for _, sp := range all {
		if matching[sp.TraceID] {
			relevant = append(relevant, sp)
		}
	}
	summaries := metrics.GroupTraces(relevant)
	filtered := summaries[:0:0]
	for _, sum := range summaries {
		if MatchTraceFilter(sum, f) {
			filtered = append(filtered, sum)
		}
	}
	return PaginateTraces(filtered, f)
}

func (s *PostgresStore) DeleteSpansBefore(ctx context.Context, projectID string, cutoff time.Time, batch int) (int, error) {
	if batch <= 0 {
		batch = 1000
	}
	res, err := s.db.ExecContext(ctx,
		`DELETE FROM spans WHERE ctid IN (SELECT ctid FROM spans WHERE project_id=$1 AND start_time<$2 LIMIT $3)`, projectID, cutoff, batch)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return int(n), nil
}

// --- alerts ---

func (s *PostgresStore) InsertAlert(a model.AlertEvent) error {
	_, err := s.db.ExecContext(context.Background(),
		`INSERT INTO alert_events(id,project_id,service_name,rule_type,observed_value,threshold_value,window_start,window_end,created_at,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
		a.ID, a.ProjectID, a.ServiceName, a.RuleType, a.ObservedValue, a.ThresholdValue, a.WindowStart, a.WindowEnd, a.CreatedAt, a.Status)
	return err
}

func (s *PostgresStore) ListAlerts(projectID string, limit int) []model.AlertEvent {
	if limit <= 0 {
		limit = 100
	}
	rows, err := s.db.QueryContext(context.Background(),
		`SELECT id,project_id,service_name,rule_type,observed_value,threshold_value,window_start,window_end,created_at,status FROM alert_events WHERE project_id=$1 ORDER BY created_at DESC LIMIT $2`, projectID, limit)
	if err != nil {
		return []model.AlertEvent{}
	}
	defer rows.Close()
	out := []model.AlertEvent{}
	for rows.Next() {
		var a model.AlertEvent
		if err := rows.Scan(&a.ID, &a.ProjectID, &a.ServiceName, &a.RuleType, &a.ObservedValue, &a.ThresholdValue, &a.WindowStart, &a.WindowEnd, &a.CreatedAt, &a.Status); err != nil {
			continue
		}
		out = append(out, a)
	}
	return out
}

func (s *PostgresStore) HasRecentAlert(projectID, service, rule string, since time.Time) bool {
	var exists bool
	err := s.db.QueryRowContext(context.Background(),
		`SELECT EXISTS(SELECT 1 FROM alert_events WHERE project_id=$1 AND service_name=$2 AND rule_type=$3 AND created_at>=$4)`,
		projectID, service, rule, since).Scan(&exists)
	return err == nil && exists
}

// --- scenario runs ---

func (s *PostgresStore) CreateScenarioRun(r model.ScenarioRun) error {
	params, _ := json.Marshal(orEmptyParams(r.Parameters))
	var summary []byte
	if r.ResultSummary != nil {
		summary, _ = json.Marshal(r.ResultSummary)
	}
	_, err := s.db.ExecContext(context.Background(),
		`INSERT INTO scenario_runs(id,project_id,scenario_type,parameters,status,started_at,finished_at,result_summary) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
		r.ID, r.ProjectID, r.ScenarioType, params, r.Status, r.StartedAt, r.FinishedAt, summary)
	return err
}

func orEmptyParams(m map[string]any) map[string]any {
	if m == nil {
		return map[string]any{}
	}
	return m
}

func scanRun(rows interface{ Scan(...any) error }) (model.ScenarioRun, error) {
	var r model.ScenarioRun
	var params, summary []byte
	if err := rows.Scan(&r.ID, &r.ProjectID, &r.ScenarioType, &params, &r.Status, &r.StartedAt, &r.FinishedAt, &summary); err != nil {
		return model.ScenarioRun{}, err
	}
	r.Parameters = map[string]any{}
	_ = json.Unmarshal(params, &r.Parameters)
	if len(summary) > 0 {
		var rs model.ScenarioResult
		if err := json.Unmarshal(summary, &rs); err == nil {
			r.ResultSummary = &rs
		}
	}
	return r, nil
}

const runCols = `id, project_id, scenario_type, parameters, status, started_at, finished_at, result_summary`

func (s *PostgresStore) GetScenarioRun(projectID, id string) (model.ScenarioRun, bool) {
	row := s.db.QueryRowContext(context.Background(),
		`SELECT `+runCols+` FROM scenario_runs WHERE id=$1 AND project_id=$2`, id, projectID)
	r, err := scanRun(row)
	if err != nil {
		return model.ScenarioRun{}, false
	}
	return r, true
}

func (s *PostgresStore) UpdateScenarioRun(r model.ScenarioRun) error {
	params, _ := json.Marshal(orEmptyParams(r.Parameters))
	var summary []byte
	if r.ResultSummary != nil {
		summary, _ = json.Marshal(r.ResultSummary)
	}
	_, err := s.db.ExecContext(context.Background(),
		`UPDATE scenario_runs SET parameters=$3, status=$4, finished_at=$5, result_summary=$6 WHERE id=$1 AND project_id=$2`,
		r.ID, r.ProjectID, params, r.Status, r.FinishedAt, summary)
	return err
}
