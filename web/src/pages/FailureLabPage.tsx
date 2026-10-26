import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useAppState } from "../app/providers";
import { DataState } from "../components/feedback";
import { Badge, btnCls, btnGhost, Card, inputCls, PageTitle, TraceLink } from "../components/ui";
import { defaultParams } from "../data/factories/scenarioFactory";
import { formatDuration, formatPercent } from "../lib/formatting";
import type { RedMetrics, ScenarioDefinition, ScenarioRun } from "../types";

export default function FailureLabPage() {
  const { provider, range, mode, refresh } = useAppState();
  const qc = useQueryClient();
  const defs = useQuery({ queryKey: ["scenarios"], queryFn: () => provider.listScenarios() });
  const runs = useQuery({ queryKey: ["scenario-runs"], queryFn: () => provider.listScenarioRuns() });
  const [selectedId, setSelectedId] = useState("slow-inventory");
  const [params, setParams] = useState<Record<string, number>>({});
  const [workload, setWorkload] = useState(10);
  const [lastRun, setLastRun] = useState<ScenarioRun | null>(null);
  const [before, setBefore] = useState<RedMetrics | null>(null);
  const [after, setAfter] = useState<RedMetrics | null>(null);
  const selected: ScenarioDefinition | undefined = defs.data?.find((d) => d.id === selectedId);
  const effectiveParams = selected ? { ...defaultParams(selected), ...params } : {};
  const runMutation = useMutation({
    mutationFn: async () => {
      const b = await provider.getMetrics({ start: range.start, end: range.end, interval_seconds: 300 });
      setBefore(b);
      let run = await provider.runScenario({ scenario_id: selectedId, parameters: effectiveParams, workload });
      // Live backend runs are asynchronous: poll until the run reaches a
      // terminal state (demo-provider runs complete immediately).
      for (let i = 0; i < 90 && (run.status === "running" || run.status === "pending"); i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const polled = await provider.getScenarioRun(run.id);
        if (polled) run = polled;
      }
      const now = new Date(); const start = new Date(now.getTime() - 6 * 3600000);
      const a = await provider.getMetrics({ start: start.toISOString(), end: new Date(now.getTime() + 3600000).toISOString(), interval_seconds: 300 });
      setAfter(a); return run;
    },
    onSuccess: (run) => { setLastRun(run); void qc.invalidateQueries({ queryKey: ["scenario-runs"] }); refresh(); },
  });
  return (
    <div>
      <PageTitle title="Failure Lab" subtitle={mode === "demo" ? "Browser simulation mode: scenarios generate deterministic synthetic traces in this browser. No real services are faulted." : "Live mode: scenarios run against the isolated demo services only (checkout, inventory, payment, notifications). Arbitrary targets and commands are not accepted."} />
      <DataState isLoading={defs.isLoading} isError={defs.isError} error={defs.error} data={defs.data} onRetry={() => defs.refetch()}>
        {() => (
          <div className="grid gap-4 xl:grid-cols-[280px_1fr_340px]">
            <Card title="Scenario library">
              <div className="space-y-2">{(defs.data ?? []).map((d) => (<button key={d.id} type="button" onClick={() => { setSelectedId(d.id); setParams({}); }} className={`block w-full rounded-lg border p-3 text-left ${d.id === selectedId ? "border-teal-500 bg-teal-50 dark:bg-teal-950/40" : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800"}`}><p className="font-medium">{d.name}</p><p className="mt-1 line-clamp-3 text-xs text-zinc-500">{d.description}</p><Link className="text-xs text-teal-700 hover:underline dark:text-teal-300" to={`/failure-lab/${d.id}`} onClick={(e) => e.stopPropagation()}>Scenario details</Link></button>))}</div>
            </Card>
            <Card title={selected ? selected.name : "Scenario controls"}>
              {selected && <>
                <p className="text-sm text-zinc-600 dark:text-zinc-300">{selected.description}</p>
                <div className="mt-4 space-y-3">
                  {selected.parameters.map((p) => (<label key={p.key} className="block text-sm">{p.label} ({p.unit}) - min {p.min}, max {p.max}<input type="number" className={`${inputCls} ml-2 w-32`} min={p.min} max={p.max} value={effectiveParams[p.key] ?? p.default} onChange={(e) => setParams((prev) => ({ ...prev, [p.key]: Math.min(p.max, Math.max(p.min, Number(e.target.value) || 0)) }))} /></label>))}
                  <label className="block text-sm">Workload (requests, 1-50)<input type="number" className={`${inputCls} ml-2 w-24`} min={1} max={50} value={workload} onChange={(e) => setWorkload(Math.min(50, Math.max(1, Number(e.target.value) || 1)))} /></label>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button className={btnCls} disabled={runMutation.isPending} onClick={() => runMutation.mutate()}>{runMutation.isPending ? "Running..." : "Run scenario"}</button>
                  <button className={btnGhost} onClick={() => { if (provider.resetDemoData) provider.resetDemoData(); setLastRun(null); setBefore(null); setAfter(null); void qc.invalidateQueries(); refresh(); }}>Reset {mode === "demo" ? "demo data to baseline" : ""}</button>
                </div>
                {runMutation.isError && <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">{runMutation.error instanceof Error ? runMutation.error.message : "Scenario run failed."}</p>}
                <p className="mt-3 text-xs text-zinc-500">Status: {runMutation.isPending ? "running" : lastRun ? lastRun.status : "idle"}. Runs are explicit: nothing starts until you press Run scenario.</p>
                {(runs.data ?? []).length > 0 && <div className="mt-4"><h3 className="mb-2 text-sm font-semibold">Run history (this session)</h3>{(runs.data ?? []).map((r) => <p key={r.id} className="text-sm">{r.id} - {r.scenario_type} - <Badge tone={r.status === "completed" ? "ok" : "neutral"}>{r.status}</Badge></p>)}</div>}
              </>}
            </Card>
            <Card title="Results">
              {!lastRun?.result_summary ? <p className="text-sm text-zinc-500">No run yet in this view. Results show requests generated, successes, failures, observed p95, affected services, and links to the resulting traces.</p> : (
                <div className="space-y-2 text-sm">
                  <p>Requests generated: <strong>{lastRun.result_summary.requests}</strong></p>
                  <p>Succeeded: <strong>{lastRun.result_summary.succeeded}</strong></p>
                  <p>Failed: <strong>{lastRun.result_summary.failed}</strong></p>
                  <p>Observed p95 (checkout): <strong>{formatDuration(lastRun.result_summary.p95_ns)}</strong></p>
                  <p>Affected services: {lastRun.result_summary.affected_services.join(", ")}</p>
                  <div><p className="font-medium">Resulting traces</p>{lastRun.result_summary.trace_ids.slice(0, 10).map((id) => <p key={id}><TraceLink traceId={id} /></p>)}</div>
                </div>
              )}
            </Card>
            <div className="xl:col-span-3">
              <Card title="Investigation - before and after">
                {!before || !after ? <p className="text-sm text-zinc-500">Run a scenario to capture a before/after comparison of error rate and p95 latency for the current dataset.</p> : (
                  <table className="w-full text-left text-sm"><thead><tr className="text-zinc-500"><th className="py-1">Metric</th><th>Before run</th><th>After run</th></tr></thead><tbody>
                    <tr className="border-t border-zinc-100 dark:border-zinc-800"><td>Requests (window)</td><td>{before.request_count}</td><td>{after.request_count}</td></tr>
                    <tr className="border-t border-zinc-100 dark:border-zinc-800"><td>Error rate</td><td>{formatPercent(before.error_rate)}</td><td>{formatPercent(after.error_rate)}</td></tr>
                    <tr className="border-t border-zinc-100 dark:border-zinc-800"><td>P95 latency</td><td>{formatDuration(before.p95_ns)}</td><td>{formatDuration(after.p95_ns)}</td></tr>
                  </tbody></table>
                )}
                {lastRun?.result_summary && <div className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">{lastRun.scenario_type === "slow-inventory" && <p>Finding: inventory spans in the new traces carry the injected delay, and checkout duration grows by roughly the same amount - open a resulting trace and compare the inventory bar in the waterfall.</p>}{lastRun.scenario_type === "payment-errors" && <p>Finding: payment spans in the new traces carry error status and an exception event; filtering the trace explorer by status = error surfaces them.</p>}{lastRun.scenario_type === "notification-timeout" && <p>Finding: notification spans exceed the 800 ms checkout timeout and record a timeout event, while checkout itself still succeeds - the failure is distinguishable from a payment failure.</p>}{lastRun.scenario_type === "recovery" && <p>Finding: the new traces are healthy; earlier failed traces remain in the window, so the dashboard distinguishes old failures from the recovered workload by start time.</p>}</div>}
              </Card>
            </div>
          </div>
        )}
      </DataState>
    </div>
  );
}
