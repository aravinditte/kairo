import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import {
  FlaskConical,
  Play,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Activity,
  Layers,
  ArrowRight,
  Info,
  Terminal,
  StopCircle,
} from "lucide-react";
import { useAppState } from "../app/providers";
import { DataState } from "../components/feedback";
import { Badge, btnCls, btnGhost, Card, inputCls, PageTitle, TraceLink } from "../components/ui";
import { defaultParams, getLocalizedScenario, SCENARIO_DEFINITIONS } from "../data/factories/scenarioFactory";
import { useI18n } from "../lib/i18n";
import { formatDuration, formatPercent } from "../lib/formatting";
import type { RedMetrics, ScenarioDefinition, ScenarioRun, Span } from "../types";
import SimulatorConsole from "../features/failure-lab/SimulatorConsole";
import DependencyGraphView from "../features/services/DependencyGraph";
import TraceWaterfall, { SpanInspector } from "../features/traces/TraceWaterfall";

export default function FailureLabPage() {
  const [searchParams] = useSearchParams();
  const initialScenario = searchParams.get("scenario") || "slow-inventory";
  const { provider, range, mode, refresh } = useAppState();
  const { lang, t } = useI18n();
  const qc = useQueryClient();
  const defs = useQuery({ queryKey: ["scenarios"], queryFn: () => provider.listScenarios() });
  const [selectedId, setSelectedId] = useState(initialScenario);
  const [params, setParams] = useState<Record<string, number>>({});
  const [workload, setWorkload] = useState(40);
  const [lastRun, setLastRun] = useState<ScenarioRun | null>(null);
  const [before, setBefore] = useState<RedMetrics | null>(null);
  const [after, setAfter] = useState<RedMetrics | null>(null);
  const [activeTab, setActiveTab] = useState<"console" | "investigation" | "waterfall">("console");
  const [selectedSpan, setSelectedSpan] = useState<Span | null>(null);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);

  const rawSelected: ScenarioDefinition | undefined =
    defs.data?.find((d) => d.id === selectedId) || SCENARIO_DEFINITIONS.find((d) => d.id === selectedId);
  const selected = rawSelected ? getLocalizedScenario(rawSelected, lang) : undefined;
  const effectiveParams = rawSelected ? { ...defaultParams(rawSelected), ...params } : {};

  const depsQuery = useQuery({
    queryKey: ["failure-lab-deps", range.start, range.end],
    queryFn: () => provider.getDependencies({ start: range.start, end: range.end }),
  });

  const traceDetailQuery = useQuery({
    queryKey: ["failure-lab-trace", selectedTraceId],
    queryFn: () => (selectedTraceId ? provider.getTrace(selectedTraceId) : null),
    enabled: !!selectedTraceId,
  });

  const runMutation = useMutation({
    mutationFn: async () => {
      const b = await provider.getMetrics({ start: range.start, end: range.end, interval_seconds: 300 });
      setBefore(b);
      let run = await provider.runScenario({ scenario_id: selectedId, parameters: effectiveParams, workload });
      for (let i = 0; i < 90 && (run.status === "running" || run.status === "pending"); i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const polled = await provider.getScenarioRun(run.id);
        if (polled) run = polled;
      }
      const now = new Date();
      const start = new Date(now.getTime() - 6 * 3600000);
      const a = await provider.getMetrics({
        start: start.toISOString(),
        end: new Date(now.getTime() + 3600000).toISOString(),
        interval_seconds: 300,
      });
      setAfter(a);
      return run;
    },
    onSuccess: (run) => {
      setLastRun(run);
      if (run.result_summary?.trace_ids?.length) {
        setSelectedTraceId(run.result_summary.trace_ids[0]);
      }
      void qc.invalidateQueries({ queryKey: ["scenario-runs"] });
      void qc.invalidateQueries({ queryKey: ["failure-lab-deps"] });
      refresh();
    },
  });

  const handleResetEnvironment = () => {
    if (provider.resetDemoData) {
      provider.resetDemoData(false);
    }
    setLastRun(null);
    setBefore(null);
    setAfter(null);
    setSelectedTraceId(null);
    void qc.invalidateQueries();
    refresh();
  };

  const currentStatus = runMutation.isPending
    ? "RUNNING"
    : lastRun?.status === "completed"
    ? "COMPLETED"
    : lastRun?.status === "cancelled"
    ? "CANCELLED"
    : "IDLE";

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-[#27354A] pb-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-[#F7F6F3]">{t.failureLab.title}</h1>
            <span className="rounded bg-[#1A2332] border border-[#27354A] px-2 py-0.5 font-mono text-xs text-[#A7B0BE]">
              {t.header.envDemo}
            </span>
            <span
              className={`rounded px-2 py-0.5 font-mono text-xs font-semibold uppercase ${
                currentStatus === "RUNNING"
                  ? "bg-amber-500/20 text-amber-400 border border-amber-500/40"
                  : currentStatus === "COMPLETED"
                  ? "bg-[#22C55E]/20 text-[#22C55E] border border-[#22C55E]/40"
                  : "bg-[#1A2332] text-[#A7B0BE] border border-[#27354A]"
              }`}
            >
              {t.common.status}: {currentStatus}
            </span>
          </div>
          <p className="mt-1 text-xs text-[#A7B0BE]">
            {t.failureLab.subtitle}
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <span className="rounded-md border border-[#27354A] bg-[#1A2332] px-2.5 py-1 text-xs text-[#A7B0BE]">
            Mode: <strong className="text-[#F7F6F3]">{mode === "demo" ? t.header.simulatedData : t.header.liveBackend}</strong>
          </span>
          <button
            type="button"
            onClick={handleResetEnvironment}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#27354A] bg-[#1A2332] px-3 py-1.5 text-xs font-medium text-[#F7F6F3] hover:bg-[#1E2838] transition-colors"
          >
            <RotateCcw className="size-3.5 text-[#F472B6]" />
            <span>{t.failureLab.resetBaseline}</span>
          </button>
        </div>
      </div>

      <DataState
        isLoading={defs.isLoading}
        isError={defs.isError}
        error={defs.error}
        data={defs.data || SCENARIO_DEFINITIONS}
        onRetry={() => defs.refetch()}
      >
        {(scenarios) => (
          <div className="space-y-6">
            {/* Top Workspace Grid: 3-column Layout */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
              {/* Left Column: Scenario Library (4 cols) */}
              <div className="lg:col-span-4 space-y-4">
                <Card
                  title={t.failureLab.scenarioLibrary}
                  subtitle="Select a fault injection recipe"
                >
                  <div className="space-y-2 max-h-[580px] overflow-y-auto pr-1">
                    {scenarios.map((rawD) => {
                      const d = getLocalizedScenario(rawD, lang);
                      const isSel = d.id === selectedId;
                      return (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => {
                            setSelectedId(d.id);
                            setParams({});
                          }}
                          className={`group block w-full rounded-lg border p-3 text-left transition-all ${
                            isSel
                              ? "border-[#F472B6] bg-[#F472B6]/10 shadow-xs"
                              : "border-[#27354A] bg-[#1A2332] hover:bg-[#1E2838]"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className={`text-xs font-bold ${isSel ? "text-[#F472B6]" : "text-[#F7F6F3]"}`}>
                              {d.name}
                            </span>
                            <div className="flex items-center gap-1.5">
                              {d.difficulty && (
                                <span className="rounded bg-[#0B0F1A] border border-[#27354A] px-1.5 py-0.5 text-[10px] font-semibold text-[#A7B0BE]">
                                  {d.difficulty}
                                </span>
                              )}
                              {isSel && (
                                <span className="rounded bg-[#F472B6]/20 border border-[#F472B6]/40 px-1.5 py-0.5 text-[10px] font-bold text-[#F472B6]">
                                  Selected
                                </span>
                              )}
                            </div>
                          </div>
                          <p className="mt-1 line-clamp-2 text-xs text-[#A7B0BE]">
                            {d.description}
                          </p>
                          <div className="mt-2 flex items-center justify-between border-t border-[#27354A] pt-2 text-[10px] text-[#A7B0BE]">
                            <span className="font-mono text-[#A7B0BE]/70">{d.id}</span>
                            <span>{d.estimated_duration || "~2s"}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </Card>
              </div>

              {/* Center Column: Scenario Configuration (4 cols) */}
              <div className="lg:col-span-4 space-y-4">
                <Card
                  title={selected ? selected.name : t.failureLab.configuration}
                  subtitle={selected ? "Tune fault parameters and trigger synthetic workload" : undefined}
                >
                  {selected && (
                    <div className="space-y-4">
                      <div className="rounded-lg border border-[#27354A] bg-[#0B0F1A] p-3 text-xs text-[#F7F6F3]/90 leading-relaxed">
                        <div className="font-semibold text-[#F472B6] mb-1">Recipe Description:</div>
                        {selected.description}
                        {selected.expected_impact && (
                          <div className="mt-2 pt-2 border-t border-[#27354A] text-[11px] text-[#A7B0BE]">
                            <strong className="text-[#F7F6F3]">{t.failureLab.impact}:</strong> {selected.expected_impact}
                          </div>
                        )}
                      </div>

                      <div className="space-y-3">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-[#A7B0BE]">
                          {t.failureLab.parameters}
                        </h4>
                        {selected.parameters.map((p) => (
                          <div key={p.key} className="rounded-lg border border-[#27354A] bg-[#131A26] p-3">
                            <label className="mb-1 block text-xs font-medium text-[#F7F6F3]">
                              {p.label} ({p.unit})
                            </label>
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                className={`${inputCls} w-full font-mono`}
                                min={p.min}
                                max={p.max}
                                value={effectiveParams[p.key] ?? p.default}
                                onChange={(e) =>
                                  setParams((prev) => ({
                                    ...prev,
                                    [p.key]: Math.min(
                                      p.max,
                                      Math.max(p.min, Number(e.target.value) || 0)
                                    ),
                                  }))
                                }
                              />
                              <span className="text-xs font-mono text-[#A7B0BE] whitespace-nowrap">
                                [{p.min}..{p.max}]
                              </span>
                            </div>
                          </div>
                        ))}

                        <div className="rounded-lg border border-[#27354A] bg-[#131A26] p-3">
                          <label className="mb-1 block text-xs font-medium text-[#F7F6F3]">
                            Workload Volume (requests)
                          </label>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              className={`${inputCls} w-full font-mono`}
                              min={10}
                              max={150}
                              value={workload}
                              onChange={(e) =>
                                setWorkload(Math.min(150, Math.max(1, Number(e.target.value) || 1)))
                              }
                            />
                            <span className="text-xs font-mono text-[#A7B0BE] whitespace-nowrap">[10..150]</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 pt-2 border-t border-[#27354A]">
                        <button
                          type="button"
                          className={`${btnCls} flex-1`}
                          disabled={runMutation.isPending}
                          onClick={() => runMutation.mutate()}
                        >
                          <Play className="size-3.5 fill-current" />
                          <span>{runMutation.isPending ? t.failureLab.running : t.failureLab.runScenario}</span>
                        </button>
                        {runMutation.isPending && (
                          <button
                            type="button"
                            className="inline-flex items-center justify-center rounded-md border border-[#FF6B6B]/40 bg-[#FF6B6B]/10 px-3 py-2 text-xs font-semibold text-[#FF6B6B] hover:bg-[#FF6B6B]/20 transition-colors"
                            onClick={() => {
                              if (provider.cancelScenario) provider.cancelScenario("current");
                            }}
                          >
                            <StopCircle className="size-3.5" />
                            <span>{t.failureLab.cancelScenario}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </Card>
              </div>

              {/* Right Column: Live System State & Telemetry Feedback (4 cols) */}
              <div className="lg:col-span-4 space-y-4">
                <Card
                  title={t.failureLab.systemState}
                  subtitle="Active scenario telemetry summary"
                >
                  <div className="space-y-4">
                    {/* Real-time KPI summary */}
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-lg border border-[#27354A] bg-[#131A26] p-2.5">
                        <span className="text-[10px] uppercase font-semibold text-[#A7B0BE]">Requests</span>
                        <p className="mt-0.5 font-mono text-base font-bold text-[#F7F6F3]">
                          {lastRun?.result_summary?.requests ?? 0}
                        </p>
                      </div>
                      <div className="rounded-lg border border-[#27354A] bg-[#131A26] p-2.5">
                        <span className="text-[10px] uppercase font-semibold text-[#A7B0BE]">Failed</span>
                        <p className="mt-0.5 font-mono text-base font-bold text-[#FF6B6B]">
                          {lastRun?.result_summary?.failed ?? 0}
                        </p>
                      </div>
                      <div className="rounded-lg border border-[#27354A] bg-[#131A26] p-2.5">
                        <span className="text-[10px] uppercase font-semibold text-[#A7B0BE]">P95 Latency</span>
                        <p className="mt-0.5 font-mono text-base font-bold text-[#F7F6F3]">
                          {lastRun?.result_summary?.p95_ns ? formatDuration(lastRun.result_summary.p95_ns) : "Baseline"}
                        </p>
                      </div>
                      <div className="rounded-lg border border-[#27354A] bg-[#131A26] p-2.5">
                        <span className="text-[10px] uppercase font-semibold text-[#A7B0BE]">Error Rate</span>
                        <p className="mt-0.5 font-mono text-base font-bold text-[#FF6B6B]">
                          {lastRun?.result_summary
                            ? formatPercent(lastRun.result_summary.failed / Math.max(1, lastRun.result_summary.requests))
                            : "0.0%"}
                        </p>
                      </div>
                    </div>

                    {/* Affected Services List */}
                    <div className="rounded-lg border border-[#27354A] bg-[#131A26] p-3 text-xs space-y-1.5">
                      <div className="text-[10px] uppercase font-semibold text-[#A7B0BE]">Affected Services:</div>
                      <div className="flex flex-wrap gap-1.5">
                        {lastRun?.result_summary?.affected_services?.length ? (
                          lastRun.result_summary.affected_services.map((svc) => (
                            <span
                              key={svc}
                              className="rounded bg-[#1A2332] border border-[#27354A] px-2 py-0.5 font-mono text-[11px] text-[#F7F6F3]"
                            >
                              {svc}
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-[#A7B0BE]">checkout, inventory, payment, notifications</span>
                        )}
                      </div>
                    </div>

                    {/* Generated Trace IDs shortcut list */}
                    {lastRun?.result_summary?.trace_ids?.length ? (
                      <div className="space-y-1.5">
                        <div className="text-[10px] uppercase font-semibold text-[#A7B0BE]">Sample Generated Traces:</div>
                        <div className="space-y-1 max-h-32 overflow-y-auto">
                          {lastRun.result_summary.trace_ids.slice(0, 5).map((tid) => (
                            <div
                              key={tid}
                              className="flex items-center justify-between rounded bg-[#131A26] border border-[#27354A] px-2.5 py-1 text-xs"
                            >
                              <TraceLink traceId={tid} />
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedTraceId(tid);
                                  setActiveTab("waterfall");
                                }}
                                className="text-[10px] font-semibold text-[#F472B6] hover:underline"
                              >
                                Inspect Waterfall &rarr;
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </Card>
              </div>
            </div>

            {/* Bottom Investigation & Console Workspace */}
            <div className="space-y-3">
              {/* Tab Navigation */}
              <div className="flex items-center gap-1 border-b border-[#27354A] text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setActiveTab("console")}
                  className={`inline-flex items-center gap-2 border-b-2 px-4 py-2.5 transition-colors ${
                    activeTab === "console"
                      ? "border-[#F472B6] text-[#F472B6] bg-[#1A2332]"
                      : "border-transparent text-[#A7B0BE] hover:text-[#F7F6F3]"
                  }`}
                >
                  <Terminal className="size-3.5" />
                  <span>{t.failureLab.tabConsole}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("investigation")}
                  className={`inline-flex items-center gap-2 border-b-2 px-4 py-2.5 transition-colors ${
                    activeTab === "investigation"
                      ? "border-[#F472B6] text-[#F472B6] bg-[#1A2332]"
                      : "border-transparent text-[#A7B0BE] hover:text-[#F7F6F3]"
                  }`}
                >
                  <Activity className="size-3.5" />
                  <span>{t.failureLab.tabFindings}</span>
                </button>
                {selectedTraceId && (
                  <button
                    type="button"
                    onClick={() => setActiveTab("waterfall")}
                    className={`inline-flex items-center gap-2 border-b-2 px-4 py-2.5 transition-colors ${
                      activeTab === "waterfall"
                        ? "border-[#F472B6] text-[#F472B6] bg-[#1A2332]"
                        : "border-transparent text-[#A7B0BE] hover:text-[#F7F6F3]"
                    }`}
                  >
                    <Layers className="size-3.5" />
                    <span>{t.failureLab.tabWaterfall} ({selectedTraceId.slice(0, 8)}...)</span>
                  </button>
                )}
              </div>

              {/* Tab Content 1: Terminal Console */}
              {activeTab === "console" && (
                <div className="h-[360px]">
                  <SimulatorConsole
                    provider={provider}
                    activeScenarioId={selectedId}
                    onSelectScenario={setSelectedId}
                    onScenarioExecuted={(r) => {
                      setLastRun(r);
                      if (r.result_summary?.trace_ids?.length) {
                        setSelectedTraceId(r.result_summary.trace_ids[0]);
                      }
                      refresh();
                    }}
                    onRefresh={refresh}
                    mode={mode}
                  />
                </div>
              )}

              {/* Tab Content 2: Investigation & Before vs After Table */}
              {activeTab === "investigation" && (
                <Card
                  title={t.failureLab.tabFindings}
                  subtitle="Evaluate how the injected scenario altered system-wide latency and error metrics"
                >
                  {!before || !after ? (
                    <div className="py-8 text-center text-xs text-[#A7B0BE]">
                      Execute a scenario above or run a command in the console to generate before/after comparative findings.
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead className="border-b border-[#27354A] bg-[#131A26] text-[#A7B0BE]">
                            <tr>
                              <th className="py-2.5 px-3 font-semibold uppercase tracking-wider">{t.failureLab.metric}</th>
                              <th className="py-2.5 px-3 font-semibold uppercase tracking-wider">{t.failureLab.baseline}</th>
                              <th className="py-2.5 px-3 font-semibold uppercase tracking-wider">{t.failureLab.active}</th>
                              <th className="py-2.5 px-3 font-semibold uppercase tracking-wider">{t.failureLab.delta}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#27354A]">
                            <tr>
                              <td className="py-2.5 px-3 font-medium text-[#F7F6F3]">Total Requests in Window</td>
                              <td className="font-mono py-2.5 px-3 text-[#A7B0BE]">{before.request_count}</td>
                              <td className="font-mono py-2.5 px-3 text-[#F7F6F3] font-bold">{after.request_count}</td>
                              <td className="font-mono py-2.5 px-3 font-medium text-[#22C55E]">
                                +{after.request_count - before.request_count} requests
                              </td>
                            </tr>
                            <tr>
                              <td className="py-2.5 px-3 font-medium text-[#F7F6F3]">Observed Error Rate</td>
                              <td className="font-mono py-2.5 px-3 text-[#A7B0BE]">{formatPercent(before.error_rate)}</td>
                              <td className="font-mono py-2.5 px-3 font-bold text-[#FF6B6B]">
                                {formatPercent(after.error_rate)}
                              </td>
                              <td className="font-mono py-2.5 px-3 font-semibold text-[#FF6B6B]">
                                {formatPercent(after.error_rate - before.error_rate)} shift
                              </td>
                            </tr>
                            <tr>
                              <td className="py-2.5 px-3 font-medium text-[#F7F6F3]">P95 Latency</td>
                              <td className="font-mono py-2.5 px-3 text-[#A7B0BE]">{formatDuration(before.p95_ns)}</td>
                              <td className="font-mono py-2.5 px-3 font-bold text-[#F7F6F3]">
                                {formatDuration(after.p95_ns)}
                              </td>
                              <td className="font-mono py-2.5 px-3 font-semibold text-[#F472B6]">
                                {formatDuration((after.p95_ns ?? 0) - (before.p95_ns ?? 0))}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>

                      {lastRun?.result_summary && (
                        <div className="rounded-lg border border-[#27354A] bg-[#131A26] p-4 text-xs text-[#F7F6F3] space-y-1.5 leading-relaxed">
                          <span className="font-bold text-[#F472B6]">{t.failureLab.diagnosticConclusion}:</span>
                          {lastRun.scenario_type === "slow-inventory" && (
                            <p>
                              {lang === "ja"
                                ? "在庫サービス (Inventory) の応答遅延により、同期呼び出し元のチェックアウトスパンがブロックされました。決済処理前に在庫引当を行うため、全体の所要時間が設定遅延分直接増加しました。"
                                : "Inventory response latency caused synchronous checkout caller spans to block. Because checkout reserves items before payment authorization, overall checkout request duration grew proportionally to inventory delay."}
                            </p>
                          )}
                          {lastRun.scenario_type === "payment-errors" && (
                            <p>
                              {lang === "ja"
                                ? "決済ゲートウェイが HTTP 500 エラーを返却しました。チェックアウトは注文処理を中断し、下流へ HTTP 502 Bad Gateway を返却しました。"
                                : "Payment gateway returned HTTP 500 status codes with PaymentGatewayError exception annotations. Checkout aborted order completion and responded with downstream HTTP 502 Bad Gateway."}
                            </p>
                          )}
                          {lastRun.scenario_type === "notification-timeout" && (
                            <p>
                              {lang === "ja"
                                ? "通知処理がクライアントタイムアウト (800ms) を超過し、タイムアウトイベントを記録しました。非同期処理の分離により、注文完了自体は正常に成功しました。"
                                : "Notification dispatch exceeded checkout client deadline (800ms) and logged a timeout event. Checkout gracefully continued and finalized order confirmation, illustrating non-fatal fault isolation."}
                            </p>
                          )}
                          {lastRun.scenario_type === "traffic-spike" && (
                            <p>
                              {lang === "ja"
                                ? "並列トラフィックの急増によりキューイング遅延が発生。エラー率は安定したまま、P95およびP99レイテンシが大幅に伸長しました。"
                                : "Concurrency spike produced queueing contention across inventory and payment services. P95 and P99 latency stretched significantly while baseline error rates remained steady."}
                            </p>
                          )}
                          {lastRun.scenario_type === "cascading-failure" && (
                            <p>
                              {lang === "ja"
                                ? "在庫枯渇が決済の中断とスレッド枯渇を誘発。相互接続された3つのマイクロサービス全体でエラー率がSLO制限を超過しました。"
                                : "Downstream inventory exhaustion cascaded to payment aborts and checkout thread starvation. System-wide error rates breached SLO limits across three interconnected microservices."}
                            </p>
                          )}
                          {lastRun.scenario_type === "telemetry-issue" && (
                            <p>
                              {lang === "ja"
                                ? "ネットワーク分断によりスパン重複と未完全トレースが発生。DBの主キー制約により重複は安全に排除され、不完全トレースが検出されました。"
                                : "Synthetic network partition produced duplicate span deliveries and partial traces. Duplicate spans were safely deduplicated via database primary key conflicts, and incomplete traces flagged in inspector."}
                            </p>
                          )}
                          {lastRun.scenario_type === "recovery" && (
                            <p>
                              {lang === "ja"
                                ? "すべての注入障害を解除。新しいテレメトリは直ちにエラー率0%、通常レイテンシに復帰しました。"
                                : "Active faults removed. New telemetry stream returned to 0% error rate and baseline latency."}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </Card>
              )}

              {/* Tab Content 3: Embedded Waterfall for Selected Scenario Trace */}
              {activeTab === "waterfall" && selectedTraceId && (
                <div className="space-y-4">
                  {traceDetailQuery.isLoading ? (
                    <div className="py-8 text-center text-xs text-[#A7B0BE]">Loading trace telemetry...</div>
                  ) : traceDetailQuery.data ? (
                    <div className="space-y-4">
                      <TraceWaterfall
                        spans={traceDetailQuery.data.spans}
                        selected={selectedSpan}
                        onSelect={setSelectedSpan}
                      />
                      {selectedSpan && <SpanInspector span={selectedSpan} />}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        )}
      </DataState>
    </div>
  );
}
