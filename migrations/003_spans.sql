CREATE TABLE IF NOT EXISTS spans (
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    trace_id TEXT NOT NULL,
    span_id TEXT NOT NULL,
    parent_span_id TEXT,
    service_name TEXT NOT NULL,
    operation_name TEXT NOT NULL,
    span_kind INTEGER NOT NULL DEFAULT 0,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    duration_ns BIGINT NOT NULL,
    status_code TEXT NOT NULL DEFAULT 'unset',
    status_message TEXT,
    resource_attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
    span_attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
    events JSONB NOT NULL DEFAULT '[]'::jsonb,
    links JSONB NOT NULL DEFAULT '[]'::jsonb,
    ingested_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (project_id, trace_id, span_id)
);
CREATE INDEX IF NOT EXISTS idx_spans_project_time ON spans(project_id, start_time DESC);
CREATE INDEX IF NOT EXISTS idx_spans_project_service_time ON spans(project_id, service_name, start_time DESC);
CREATE INDEX IF NOT EXISTS idx_spans_project_trace ON spans(project_id, trace_id);
CREATE INDEX IF NOT EXISTS idx_spans_errors ON spans(project_id, start_time DESC) WHERE status_code = 'error';
