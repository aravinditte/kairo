import { percentile, computeAlerts, computeDependencies, computeOverview, computeRED, computeServices, DEFAULT_THRESHOLDS, traceSummaries } from "../aggregations";
import { generateBaselineSpans, DEMO_PROJECT_ID } from "../../data/demo/fixtures";
import { generateScenarioTraces, SCENARIO_DEFINITIONS, defaultParams } from "../../data/factories/scenarioFactory";
import { mulberry32, hexFromRng } from "../rng";
import type { KairoDataProvider } from "./DataProvider";
import type { AlertQuery, ConsoleLogEntry, MetricsQuery, OverviewQuery, Project, ScenarioRun, Span, Thresholds, TraceSearchQuery } from "../../types";

const delay = () => new Promise((r) => setTimeout(r, 30));
export class DemoDataProvider implements KairoDataProvider {
  readonly mode = "demo" as const;
  private seed: number; private projectId: string;
  private baseline: Span[]; private extra: Span[] = [];
  private runs: ScenarioRun[] = []; private runCounter = 0;
  private thresholds: Thresholds = { ...DEFAULT_THRESHOLDS };
  private project: Project;
  private keys: import("../../types").ApiKeyMeta[] = [{ id: "demo-key-1", project_id: DEMO_PROJECT_ID, created_at: new Date(Date.now() - 86400000).toISOString(), revoked_at: null, last_used_at: null }];
  private keyCounter = 1;
  private logs: ConsoleLogEntry[] = [];
  private logCounter = 0;

  constructor(seed = 42, nowMs = Date.now(), projectId = DEMO_PROJECT_ID) {
    this.seed = seed; this.projectId = projectId;
    this.baseline = generateBaselineSpans(seed, nowMs, projectId);
    this.project = { id: projectId, name: "Kairo Demo Project", created_at: new Date(nowMs - 7 * 86400000).toISOString(), updated_at: new Date(nowMs).toISOString(), retention_days: 7, thresholds: this.thresholds };
    this.initDefaultLogs();
  }

  private initDefaultLogs() {
    const t = Date.now();
    this.logs = [
      { id: "log-1", timestamp: new Date(t - 15000).toISOString(), severity: "INFO", subsystem: "simulator", message: "Environment initialized (Kairo Demo, seed: " + this.seed + ")" },
      { id: "log-2", timestamp: new Date(t - 12000).toISOString(), severity: "INFO", subsystem: "topology", message: "Discovered 4 services: checkout, inventory, payment, notifications" },
      { id: "log-3", timestamp: new Date(t - 9000).toISOString(), severity: "SUCCESS", subsystem: "w3c", message: "Trace context propagation verified across caller-callee edges" },
      { id: "log-4", timestamp: new Date(t - 3000).toISOString(), severity: "INFO", subsystem: "console", message: "Simulator console ready. Type 'help' for supported commands." },
    ];
  }

  getConsoleLogs(): ConsoleLogEntry[] {
    return [...this.logs];
  }

  addConsoleLog(entry: Omit<ConsoleLogEntry, "id" | "timestamp">): void {
    this.logCounter++;
    this.logs.push({
      id: `log-${Date.now()}-${this.logCounter}`,
      timestamp: new Date().toISOString(),
      ...entry,
    });
    if (this.logs.length > 500) {
      this.logs = this.logs.slice(-400);
    }
  }

  clearConsoleLogs(): void {
    this.logs = [];
  }

  private all(): Span[] { return [...this.baseline, ...this.extra]; }
  private inRange(spans: Span[], start: string, end: string) { return spans.filter((s) => { const t = Date.parse(s.start_time); return t >= Date.parse(start) && t <= Date.parse(end); }); }
  
  resetDemoData(full = false) {
    this.extra = [];
    this.runs = [];
    this.runCounter = 0;
    if (full) {
      this.initDefaultLogs();
    } else {
      this.addConsoleLog({
        severity: "INFO",
        subsystem: "simulator",
        message: "Active simulation state reset to healthy baseline",
      });
    }
  }

  /** Test/inspection helper: total spans currently in the dataset. */
  spanCount() { return this.all().length; }
  traceIds() { return [...new Set(this.all().map((s) => s.trace_id))].sort(); }

  async getOverview(q: OverviewQuery) { await delay(); return computeOverview(this.all(), q, this.projectId, this.thresholds); }
  async searchTraces(q: TraceSearchQuery) {
    await delay();
    let summaries = traceSummaries(this.inRange(this.all(), q.start, q.end));
    if (q.service) summaries = summaries.filter((t) => { const spans = this.all().filter((s) => s.trace_id === t.trace_id); return spans.some((s) => s.service_name === q.service) || t.root_service === q.service; });
    if (q.operation) summaries = summaries.filter((t) => t.root_operation.toLowerCase().includes(q.operation!.toLowerCase()));
    if (q.status === "error") summaries = summaries.filter((t) => t.has_error);
    if (q.status === "ok") summaries = summaries.filter((t) => !t.has_error);
    if (q.trace_id) summaries = summaries.filter((t) => t.trace_id.includes(q.trace_id!.toLowerCase()));
    if (q.min_duration_ns !== undefined) summaries = summaries.filter((t) => t.duration_ns >= q.min_duration_ns!);
    if (q.max_duration_ns !== undefined) summaries = summaries.filter((t) => t.duration_ns <= q.max_duration_ns!);
    const total = summaries.length;
    const limit = Math.min(200, Math.max(1, q.limit ?? 20));
    const offset = q.cursor ? Number(atob(q.cursor)) || 0 : 0;
    const items = summaries.slice(offset, offset + limit);
    const next = offset + limit < total ? btoa(String(offset + limit)) : null;
    return { items, next_cursor: next, total };
  }
  async getTrace(traceId: string) {
    await delay();
    const spans = this.all().filter((s) => s.trace_id === traceId).sort((a, b) => Date.parse(a.start_time) - Date.parse(b.start_time));
    if (!spans.length) return null;
    const summary = traceSummaries(spans)[0];
    return { ...summary, services: [...new Set(spans.map((s) => s.service_name))], spans };
  }
  async getServices(q: { start: string; end: string }) { await delay(); return computeServices(this.inRange(this.all(), q.start, q.end), this.thresholds); }
  async getService(name: string, q: { start: string; end: string }) {
    await delay();
    const spans = this.inRange(this.all(), q.start, q.end);
    const summary = computeServices(spans, this.thresholds).find((s) => s.service_name === name);
    if (!summary) return null;
    const serverSpans = spans.filter((s) => s.span_kind === 2 && s.service_name === name);
    const ops = new Map<string, Span[]>();
    for (const s of serverSpans) { const a = ops.get(s.operation_name) ?? []; a.push(s); ops.set(s.operation_name, a); }
    const deps = computeDependencies(spans);
    const traceIds = new Set(serverSpans.map((s) => s.trace_id));
    return {
      summary,
      operations: [...ops.entries()].map(([operation, ss]) => ({ operation, service: name, count: ss.length, error_count: ss.filter((s) => s.status_code === "error").length, p50_ns: percentile(ss.map((s) => s.duration_ns), 50), p95_ns: percentile(ss.map((s) => s.duration_ns), 95) })),
      incoming: deps.filter((d) => d.target === name), outgoing: deps.filter((d) => d.source === name),
      recent_traces: traceSummaries(spans.filter((s) => traceIds.has(s.trace_id))).slice(0, 10),
    };
  }
  async getDependencies(q: { start: string; end: string }) {
    await delay(); const spans = this.inRange(this.all(), q.start, q.end);
    return { nodes: computeServices(spans, this.thresholds), edges: computeDependencies(spans), inferred_note: "Edges are inferred from observed traces only (cross-service parent-child spans). Dependencies that never appear in captured telemetry are not shown." };
  }
  async getMetrics(q: MetricsQuery) { await delay(); return computeRED(this.all(), { start: q.start, end: q.end, interval_seconds: q.interval_seconds ?? 300, service: q.service, operation: q.operation }); }
  async listScenarios() { await delay(); return SCENARIO_DEFINITIONS; }
  
  async runScenario(req: { scenario_id: string; parameters: Record<string, number>; workload: number }) {
    await delay();
    const def = SCENARIO_DEFINITIONS.find((d) => d.id === req.scenario_id);
    if (!def) throw new Error(`Unknown scenario: ${req.scenario_id}`);
    const workload = Math.min(150, Math.max(1, Math.floor(req.workload) || 40));
    const params = { ...defaultParams(def), ...req.parameters };
    this.runCounter++;
    const baseMs = Math.floor(Date.now() / 60000) * 60000;

    this.addConsoleLog({
      severity: "INFO",
      subsystem: "scenario",
      message: `Scenario initiated: ${def.name} (${def.id})`,
    });
    this.addConsoleLog({
      severity: "INFO",
      subsystem: "workload",
      message: `Generating ${workload} synthetic requests across service mesh`,
    });

    if (req.scenario_id === "slow-inventory") {
      this.addConsoleLog({
        severity: "WARN",
        subsystem: "inventory",
        message: `Latency injection configured: ${params.delay_ms ?? 1500} ms`,
      });
    } else if (req.scenario_id === "payment-errors") {
      this.addConsoleLog({
        severity: "WARN",
        subsystem: "payment",
        message: `Error rate configured: ${params.error_rate ?? 25}% 5xx responses`,
      });
    } else if (req.scenario_id === "notification-timeout") {
      this.addConsoleLog({
        severity: "WARN",
        subsystem: "notifications",
        message: `Delay injection configured: ${params.timeout_ms ?? 2000} ms (>800ms client deadline)`,
      });
    } else if (req.scenario_id === "traffic-spike") {
      this.addConsoleLog({
        severity: "WARN",
        subsystem: "load",
        message: `Traffic surge applied: ${params.multiplier ?? 5}x concurrency multiplier`,
      });
    } else if (req.scenario_id === "cascading-failure") {
      this.addConsoleLog({
        severity: "ERROR",
        subsystem: "cascade",
        message: `Cascading failure injection: ${params.severity ?? 75}% downstream inventory depletion`,
      });
    } else if (req.scenario_id === "recovery") {
      this.addConsoleLog({
        severity: "INFO",
        subsystem: "recovery",
        message: "Faults deactivated; resuming healthy traffic stream",
      });
    }

    const spans = generateScenarioTraces({
      seed: this.seed,
      scenarioId: req.scenario_id,
      parameters: params,
      workload,
      runCounter: this.runCounter,
      baseMs,
      projectId: this.projectId,
    });
    this.extra.push(...spans);
    const traceIds = [...new Set(spans.map((s) => s.trace_id))];
    const roots = spans.filter((s) => s.service_name === "checkout" && s.span_kind === 2);
    const durations = roots.map((s) => s.duration_ns).sort((a, b) => a - b);
    const p95 = durations.length ? durations[Math.min(durations.length - 1, Math.ceil(0.95 * durations.length) - 1)] : null;
    const affected = [...new Set(spans.map((s) => s.service_name))];

    if (traceIds.length > 0) {
      this.addConsoleLog({
        severity: "DEBUG",
        subsystem: "trace",
        message: `Sample trace generated: ${traceIds[0].slice(0, 8)}... (${spans.length} total spans in batch)`,
      });
    }

    this.addConsoleLog({
      severity: "INFO",
      subsystem: "ingestion",
      message: `Persisted ${spans.length} normalized spans with zero schema violations`,
    });

    if (p95 !== null) {
      const p95Ms = (p95 / 1_000_000).toFixed(1);
      this.addConsoleLog({
        severity: Number(p95Ms) > 500 ? "WARN" : "INFO",
        subsystem: "metrics",
        message: `Observed P95 latency: ${p95Ms} ms`,
      });
    }

    this.addConsoleLog({
      severity: "SUCCESS",
      subsystem: "scenario",
      message: `Scenario ${def.name} execution completed`,
    });

    const run: ScenarioRun = {
      id: `demo-run-${this.runCounter}`,
      project_id: this.projectId,
      scenario_type: req.scenario_id,
      parameters: params,
      status: "completed",
      started_at: new Date(baseMs).toISOString(),
      finished_at: new Date(baseMs + workload * 2000).toISOString(),
      workload,
      result_summary: {
        requests: roots.length,
        succeeded: roots.filter((s) => s.status_code !== "error").length,
        failed: roots.filter((s) => s.status_code === "error").length,
        p95_ns: p95,
        affected_services: affected,
        trace_ids: traceIds,
      },
    };
    this.runs.unshift(run);
    return run;
  }

  async cancelScenario(runId: string) {
    await delay();
    const run = this.runs.find((r) => r.id === runId);
    if (run) {
      run.status = "cancelled";
      this.addConsoleLog({
        severity: "WARN",
        subsystem: "scenario",
        message: `Scenario run ${runId} cancelled by operator`,
      });
    }
  }

  async getScenarioRun(runId: string) { await delay(); return this.runs.find((r) => r.id === runId) ?? null; }
  async listScenarioRuns(scenarioId?: string) { await delay(); return scenarioId ? this.runs.filter((r) => r.scenario_type === scenarioId) : [...this.runs]; }
  async getAlerts(q: AlertQuery) {
    await delay();
    const end = new Date().toISOString(); const start = new Date(Date.now() - 6 * 3600000).toISOString();
    const services = computeServices(this.inRange(this.all(), start, end), this.thresholds);
    return computeAlerts(services, this.all(), this.projectId, this.thresholds, { start, end }).slice(0, q.limit ?? 50);
  }
  async getProject() { await delay(); return { ...this.project, thresholds: this.thresholds }; }
  async updateProject(patch: Partial<Pick<Project, "name" | "retention_days">>) { await delay(); this.project = { ...this.project, ...patch, updated_at: new Date().toISOString() }; return this.getProject(); }
  async listApiKeys() { await delay(); return [...this.keys]; }
  async createApiKey() {
    await delay(); this.keyCounter++;
    const rng = mulberry32(this.seed + this.keyCounter * 7919);
    const raw = `kairo_demo_${hexFromRng(rng, 32)}`;
    const meta = { id: `demo-key-${this.keyCounter}`, project_id: this.projectId, created_at: new Date().toISOString(), revoked_at: null, last_used_at: null };
    this.keys.unshift(meta); return { api_key: meta, raw_key: raw };
  }
  async revokeApiKey(keyId: string) { await delay(); this.keys = this.keys.map((k) => k.id === keyId ? { ...k, revoked_at: new Date().toISOString() } : k); }
  async getThresholds() { await delay(); return { ...this.thresholds }; }
  async updateThresholds(t: Thresholds) { await delay(); this.thresholds = { ...t }; return { ...this.thresholds }; }
  async getRetention() { await delay(); return { retention_days: this.project.retention_days }; }
  async updateRetention(days: number) { await delay(); this.project = { ...this.project, retention_days: days }; return { retention_days: days }; }
}
// Re-export types used by consumers
export type { TraceSearchQuery };
