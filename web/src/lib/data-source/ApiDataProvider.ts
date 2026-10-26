import type { KairoDataProvider } from "./DataProvider";
import type { AlertQuery, CreateApiKeyResponse, MetricsQuery, OverviewData, OverviewQuery, Project, RedMetrics, ScenarioRun, ScenarioRunRequest, Thresholds, TraceSearchQuery } from "../../types";

/** Calls the Go backend. Never falls back to demo data: failures surface as errors to the UI. */
export class ApiDataProvider implements KairoDataProvider {
  readonly mode = "api" as const;
  private base: string; private projectId: string;
  constructor(baseUrl: string, projectId: string) { this.base = baseUrl.replace(/\/$/, ""); this.projectId = projectId; }
  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    const apiKey = sessionStorage.getItem("kairo_api_key");
    const admin = sessionStorage.getItem("kairo_admin_token");
    if (apiKey) h["X-Api-Key"] = apiKey;
    if (admin) h["X-Admin-Token"] = admin;
    return h;
  }
  private async req<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.base}${path}`, { ...init, headers: { ...this.headers(), ...(init?.headers ?? {}) } });
    if (!res.ok) {
      let msg = `API request failed (${res.status})`;
      try { const body = await res.json(); msg = body?.error?.message ?? msg; } catch { /* keep default */ }
      throw new Error(msg);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
  private qs(params: Record<string, string | number | undefined | null>): string {
    const u = new URLSearchParams(); u.set("project_id", this.projectId);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") u.set(k, String(v));
    return u.toString();
  }
  async getOverview(q: OverviewQuery) { return this.req<OverviewData>(`/api/v1/overview?${this.qs({ start: q.start, end: q.end, interval_seconds: q.interval_seconds })}`); }
  async searchTraces(q: TraceSearchQuery) {
    const raw = await this.req<any>(`/api/v1/traces?${this.qs({ start: q.start, end: q.end, service: q.service, operation: q.operation, status: q.status, trace_id: q.trace_id, min_duration_ns: q.min_duration_ns, max_duration_ns: q.max_duration_ns, limit: q.limit, cursor: q.cursor })}`);
    if (Array.isArray(raw)) return { items: raw, next_cursor: null, total: raw.length };
    return { items: raw.items ?? raw.traces ?? [], next_cursor: raw.next_cursor ?? null, total: raw.total ?? (raw.items ?? raw.traces ?? []).length };
  }
  async getTrace(traceId: string) {
    try { const raw = await this.req<any>(`/api/v1/traces/${encodeURIComponent(traceId)}?project_id=${encodeURIComponent(this.projectId)}`); return raw?.trace ?? raw; }
    catch (e) { if (e instanceof Error && e.message.includes("404")) return null; throw e; }
  }
  async getServices(q: { start: string; end: string }) { const r = await this.req<any>(`/api/v1/services?${this.qs({ start: q.start, end: q.end })}`); return Array.isArray(r) ? r : r.services ?? []; }
  async getService(name: string, q: { start: string; end: string }) {
    const r = await this.req<any>(`/api/v1/services/${encodeURIComponent(name)}?${this.qs({ start: q.start, end: q.end })}`);
    if (r?.summary) return r;
    return { summary: r, operations: r?.operations ?? [], incoming: r?.incoming ?? [], outgoing: r?.outgoing ?? [], recent_traces: r?.recent_traces ?? [] };
  }
  async getDependencies(q: { start: string; end: string }) {
    const r = await this.req<any>(`/api/v1/dependencies?${this.qs({ start: q.start, end: q.end })}`);
    const edges = Array.isArray(r) ? r : r.edges ?? [];
    const services = await this.getServices(q).catch(() => []);
    return { nodes: Array.isArray(r) ? services : r.nodes ?? services, edges, inferred_note: "Edges are inferred from observed traces only (cross-service parent-child spans)." };
  }
  async getMetrics(q: MetricsQuery) { return this.req<RedMetrics>(`/api/v1/metrics/red?${this.qs({ start: q.start, end: q.end, service: q.service, operation: q.operation, interval_seconds: q.interval_seconds })}`); }
  async listScenarios() { const r = await this.req<any>(`/api/v1/scenarios`); return Array.isArray(r) ? r : r.scenarios ?? []; }
  async runScenario(req: ScenarioRunRequest) { return this.req<ScenarioRun>(`/api/v1/scenarios`, { method: "POST", body: JSON.stringify({ project_id: this.projectId, scenario_type: req.scenario_id, parameters: req.parameters, workload: req.workload }) }); }
  async getScenarioRun(runId: string) { try { return await this.req<ScenarioRun>(`/api/v1/scenarios/${encodeURIComponent(runId)}?project_id=${encodeURIComponent(this.projectId)}`); } catch { return null; } }
  async listScenarioRuns() { return []; /* The backend exposes runs by id; definitions endpoint lists types only. */ }
  async getAlerts(q: AlertQuery) { const r = await this.req<any>(`/api/v1/alerts?${this.qs({ limit: q.limit })}`); return Array.isArray(r) ? r : r.alerts ?? []; }
  async getProject(): Promise<Project> { return this.req<Project>(`/api/v1/projects/${encodeURIComponent(this.projectId)}`); }
  async updateProject(patch: Partial<Pick<Project, "name" | "retention_days">>) { return this.req<Project>(`/api/v1/projects/${encodeURIComponent(this.projectId)}`, { method: "PATCH", body: JSON.stringify(patch) }); }
  async listApiKeys() { const r = await this.req<any>(`/api/v1/projects/${encodeURIComponent(this.projectId)}/api-keys`); return Array.isArray(r) ? r : r.api_keys ?? []; }
  async createApiKey() { return this.req<CreateApiKeyResponse>(`/api/v1/projects/${encodeURIComponent(this.projectId)}/api-keys`, { method: "POST", body: JSON.stringify({}) }); }
  async revokeApiKey(keyId: string) { await this.req(`/api/v1/api-keys/${encodeURIComponent(keyId)}/revoke`, { method: "POST", body: JSON.stringify({}) }); }
  async getThresholds(): Promise<Thresholds> { const r = await this.req<any>(`/api/v1/settings/thresholds?project_id=${encodeURIComponent(this.projectId)}`); return r.thresholds ?? r; }
  async updateThresholds(t: Thresholds) { const r = await this.req<any>(`/api/v1/settings/thresholds?project_id=${encodeURIComponent(this.projectId)}`, { method: "PATCH", body: JSON.stringify(t) }); return r.thresholds ?? r; }
  async getRetention() { const r = await this.req<any>(`/api/v1/settings/retention?project_id=${encodeURIComponent(this.projectId)}`); return { retention_days: r.retention_days ?? r.retention?.retention_days ?? 7 }; }
  async updateRetention(days: number) { const r = await this.req<any>(`/api/v1/settings/retention?project_id=${encodeURIComponent(this.projectId)}`, { method: "PATCH", body: JSON.stringify({ retention_days: days }) }); return { retention_days: r.retention_days ?? days }; }
}
