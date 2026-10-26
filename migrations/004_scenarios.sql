CREATE TABLE IF NOT EXISTS scenario_runs (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    scenario_type TEXT NOT NULL,
    parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'pending',
    started_at TIMESTAMPTZ NOT NULL,
    finished_at TIMESTAMPTZ,
    result_summary JSONB
);
CREATE INDEX IF NOT EXISTS idx_scenario_runs_project ON scenario_runs(project_id, started_at DESC);
