package storage

import (
	"context"
	"sort"
	"sync"
	"time"

	"github.com/aravinditte/kairo/internal/metrics"
	"github.com/aravinditte/kairo/internal/model"
)

// maxQuerySpans bounds how many spans a single in-memory query returns.
const maxQuerySpans = 200000

// MemoryStore is a mutex-guarded in-memory Store. It is non-durable and is
// used only when KAIRO_DATABASE_URL is empty (demo mode); startup logs a
// clear warning in that case.
type MemoryStore struct {
	mu       sync.RWMutex
	projects map[string]model.Project
	keys     map[string]model.APIKeyMeta // by key id
	keyHash  map[string]string           // key id -> hash
	hashToID map[string]string           // hash -> key id
	spans    map[string][]model.Span     // project id -> spans
	spanKeys map[string]bool             // project|trace|span dedupe set
	alerts   []model.AlertEvent
	runs     map[string]model.ScenarioRun
}

// NewMemoryStore returns an empty in-memory store.
func NewMemoryStore() *MemoryStore {
	return &MemoryStore{
		projects: make(map[string]model.Project),
		keys:     make(map[string]model.APIKeyMeta),
		keyHash:  make(map[string]string),
		hashToID: make(map[string]string),
		spans:    make(map[string][]model.Span),
		spanKeys: make(map[string]bool),
		runs:     make(map[string]model.ScenarioRun),
	}
}

func (m *MemoryStore) Mode() string { return "memory" }

func (m *MemoryStore) Ping(context.Context) error { return nil }

func (m *MemoryStore) Close() error { return nil }

// --- projects ---

func (m *MemoryStore) CreateProject(p model.Project) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.projects[p.ID] = p
	return nil
}

func (m *MemoryStore) ListProjects() []model.Project {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]model.Project, 0, len(m.projects))
	for _, p := range m.projects {
		out = append(out, p)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.Before(out[j].CreatedAt) })
	return out
}

func (m *MemoryStore) GetProject(id string) (model.Project, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	p, ok := m.projects[id]
	return p, ok
}

func (m *MemoryStore) UpdateProject(p model.Project) (model.Project, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.projects[p.ID]; !ok {
		return model.Project{}, false
	}
	m.projects[p.ID] = p
	return p, true
}

func (m *MemoryStore) DeleteProject(id string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.projects[id]; !ok {
		return false
	}
	delete(m.projects, id)
	for kid, meta := range m.keys {
		if meta.ProjectID == id {
			delete(m.hashToID, m.keyHash[kid])
			delete(m.keyHash, kid)
			delete(m.keys, kid)
		}
	}
	delete(m.spans, id)
	for k := range m.spanKeys {
		if len(k) > len(id) && k[:len(id)] == id {
			delete(m.spanKeys, k)
		}
	}
	kept := m.alerts[:0]
	for _, a := range m.alerts {
		if a.ProjectID != id {
			kept = append(kept, a)
		}
	}
	m.alerts = kept
	for rid, r := range m.runs {
		if r.ProjectID == id {
			delete(m.runs, rid)
		}
	}
	return true
}

// --- API keys ---

func (m *MemoryStore) CreateAPIKey(meta model.APIKeyMeta, keyHash string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.keys[meta.ID] = meta
	m.keyHash[meta.ID] = keyHash
	m.hashToID[keyHash] = meta.ID
	return nil
}

func (m *MemoryStore) ListAPIKeys(projectID string) []model.APIKeyMeta {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := []model.APIKeyMeta{}
	for _, k := range m.keys {
		if k.ProjectID == projectID {
			out = append(out, k)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.Before(out[j].CreatedAt) })
	return out
}

func (m *MemoryStore) GetAPIKeyByHash(hash string) (model.APIKeyMeta, string, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	id, ok := m.hashToID[hash]
	if !ok {
		return model.APIKeyMeta{}, "", false
	}
	return m.keys[id], hash, true
}

func (m *MemoryStore) GetAPIKeyByID(id string) (model.APIKeyMeta, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	meta, ok := m.keys[id]
	return meta, ok
}

func (m *MemoryStore) RevokeAPIKey(id string, at time.Time) (model.APIKeyMeta, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	meta, ok := m.keys[id]
	if !ok {
		return model.APIKeyMeta{}, false
	}
	t := at
	meta.RevokedAt = &t
	m.keys[id] = meta
	return meta, true
}

func (m *MemoryStore) TouchAPIKey(id string, at time.Time) {
	m.mu.Lock()
	defer m.mu.Unlock()
	meta, ok := m.keys[id]
	if !ok {
		return
	}
	t := at
	meta.LastUsedAt = &t
	m.keys[id] = meta
}

// --- spans ---

func dedupeKey(s model.Span) string {
	return s.ProjectID + "|" + s.TraceID + "|" + s.SpanID
}

func (m *MemoryStore) InsertSpans(_ context.Context, spans []model.Span) (int, int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	inserted, dups := 0, 0
	for _, s := range spans {
		k := dedupeKey(s)
		if m.spanKeys[k] {
			dups++
			continue
		}
		m.spanKeys[k] = true
		m.spans[s.ProjectID] = append(m.spans[s.ProjectID], s)
		inserted++
	}
	return inserted, dups, nil
}

func (m *MemoryStore) QuerySpans(_ context.Context, projectID string, start, end time.Time, service, operation string, limit int) ([]model.Span, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if limit <= 0 || limit > maxQuerySpans {
		limit = maxQuerySpans
	}
	out := []model.Span{}
	for _, s := range m.spans[projectID] {
		if s.StartTime.Before(start) || !s.StartTime.Before(end) {
			continue
		}
		if service != "" && s.ServiceName != service {
			continue
		}
		if operation != "" && s.OperationName != operation {
			continue
		}
		out = append(out, s)
		if len(out) >= limit {
			break
		}
	}
	return out, nil
}

func (m *MemoryStore) GetTraceSpans(_ context.Context, projectID, traceID string) ([]model.Span, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := []model.Span{}
	for _, s := range m.spans[projectID] {
		if s.TraceID == traceID {
			out = append(out, s)
		}
	}
	return out, nil
}

func (m *MemoryStore) SearchTraces(ctx context.Context, projectID string, f model.TraceSearchFilter) (model.TraceSearchPage, error) {
	spans, err := m.queryForSearch(projectID, f)
	if err != nil {
		return model.TraceSearchPage{}, err
	}
	_ = ctx
	summaries := metrics.GroupTraces(spans)
	filtered := summaries[:0:0]
	for _, sum := range summaries {
		if MatchTraceFilter(sum, f) {
			filtered = append(filtered, sum)
		}
	}
	return PaginateTraces(filtered, f)
}

// queryForSearch returns the spans relevant to a search: when span-level
// filters are set, a trace is included if any of its spans matches, and all
// of that trace's spans are returned so grouping/counts stay correct.
func (m *MemoryStore) queryForSearch(projectID string, f model.TraceSearchFilter) ([]model.Span, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	all := m.spans[projectID]
	needsMatch := f.Service != "" || f.Operation != "" || f.Status != "" || f.TraceID != ""
	matchingTraces := make(map[string]bool)
	for _, s := range all {
		if s.StartTime.Before(f.Start) || !s.StartTime.Before(f.End) {
			continue
		}
		if !needsMatch || MatchesSpan(s, f) {
			matchingTraces[s.TraceID] = true
		}
	}
	out := []model.Span{}
	for _, s := range all {
		if matchingTraces[s.TraceID] {
			out = append(out, s)
		}
	}
	return out, nil
}

func (m *MemoryStore) DeleteSpansBefore(_ context.Context, projectID string, cutoff time.Time, batch int) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if batch <= 0 {
		batch = 1000
	}
	existing := m.spans[projectID]
	kept := existing[:0:0]
	deleted := 0
	for _, s := range existing {
		if deleted < batch && s.StartTime.Before(cutoff) {
			delete(m.spanKeys, dedupeKey(s))
			deleted++
			continue
		}
		kept = append(kept, s)
	}
	m.spans[projectID] = kept
	return deleted, nil
}

// --- alerts ---

func (m *MemoryStore) InsertAlert(a model.AlertEvent) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.alerts = append(m.alerts, a)
	return nil
}

func (m *MemoryStore) ListAlerts(projectID string, limit int) []model.AlertEvent {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := []model.AlertEvent{}
	for _, a := range m.alerts {
		if a.ProjectID == projectID {
			out = append(out, a)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out
}

func (m *MemoryStore) HasRecentAlert(projectID, service, rule string, since time.Time) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for _, a := range m.alerts {
		if a.ProjectID == projectID && a.ServiceName == service && a.RuleType == rule && !a.CreatedAt.Before(since) {
			return true
		}
	}
	return false
}

// --- scenario runs ---

func (m *MemoryStore) CreateScenarioRun(r model.ScenarioRun) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.runs[r.ID] = r
	return nil
}

func (m *MemoryStore) GetScenarioRun(projectID, id string) (model.ScenarioRun, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	r, ok := m.runs[id]
	if !ok || r.ProjectID != projectID {
		return model.ScenarioRun{}, false
	}
	return r, true
}

func (m *MemoryStore) UpdateScenarioRun(r model.ScenarioRun) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if existing, ok := m.runs[r.ID]; ok && existing.ProjectID == r.ProjectID {
		m.runs[r.ID] = r
	}
	return nil
}
