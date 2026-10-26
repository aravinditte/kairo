import type { AlertEvent, AlertQuery, ApiKeyMeta, CreateApiKeyResponse, DependencyGraph, DependencyQuery, MetricsQuery, OverviewData, OverviewQuery, Project, RedMetrics, ScenarioDefinition, ScenarioRun, ScenarioRunRequest, ServiceDetail, ServiceQuery, ServiceSummary, Thresholds, TraceDetail, TraceSearchQuery, TraceSearchResult } from "../../types";

export interface KairoDataProvider {
  readonly mode: "demo" | "api";
  getOverview(query: OverviewQuery): Promise<OverviewData>;
  searchTraces(query: TraceSearchQuery): Promise<TraceSearchResult>;
  getTrace(traceId: string): Promise<TraceDetail | null>;
  getServices(query: ServiceQuery): Promise<ServiceSummary[]>;
  getService(serviceName: string, query: ServiceQuery): Promise<ServiceDetail | null>;
  getDependencies(query: DependencyQuery): Promise<DependencyGraph>;
  getMetrics(query: MetricsQuery): Promise<RedMetrics>;
  listScenarios(): Promise<ScenarioDefinition[]>;
  runScenario(request: ScenarioRunRequest): Promise<ScenarioRun>;
  getScenarioRun(runId: string): Promise<ScenarioRun | null>;
  listScenarioRuns(scenarioId?: string): Promise<ScenarioRun[]>;
  getAlerts(query: AlertQuery): Promise<AlertEvent[]>;
  getProject(): Promise<Project>;
  updateProject(patch: Partial<Pick<Project, "name" | "retention_days">>): Promise<Project>;
  listApiKeys(): Promise<ApiKeyMeta[]>;
  createApiKey(): Promise<CreateApiKeyResponse>;
  revokeApiKey(keyId: string): Promise<void>;
  getThresholds(): Promise<Thresholds>;
  updateThresholds(t: Thresholds): Promise<Thresholds>;
  getRetention(): Promise<{ retention_days: number }>;
  updateRetention(days: number): Promise<{ retention_days: number }>;
  resetDemoData?(): void;
}
