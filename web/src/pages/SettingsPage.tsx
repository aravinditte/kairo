import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useAppState } from "../app/providers";
import { DataState } from "../components/feedback";
import { btnCls, Card, inputCls, PageTitle } from "../components/ui";
import { API_BASE_URL } from "../lib/data-source";

export default function SettingsPage() {
  const { provider, mode, projectId } = useAppState();
  const qc = useQueryClient();
  const project = useQuery({ queryKey: ["project", projectId], queryFn: () => provider.getProject() });
  const [name, setName] = useState(""); const [p95, setP95] = useState(""); const [errRate, setErrRate] = useState(""); const [rate, setRate] = useState("");
  const [apiKey, setApiKey] = useState(() => sessionStorage.getItem("kairo_api_key") ?? "");
  const [adminToken, setAdminToken] = useState(() => sessionStorage.getItem("kairo_admin_token") ?? "");
  useEffect(() => { if (project.data) { setName(project.data.name); setP95(String(project.data.thresholds.p95_latency_ms)); setErrRate(String(project.data.thresholds.error_rate_percent)); setRate(project.data.thresholds.request_rate_per_sec ? String(project.data.thresholds.request_rate_per_sec) : ""); } }, [project.data]);
  const saveProject = useMutation({ mutationFn: () => provider.updateProject({ name }), onSuccess: () => void qc.invalidateQueries({ queryKey: ["project"] }) });
  const saveThresholds = useMutation({ mutationFn: () => provider.updateThresholds({ p95_latency_ms: Number(p95) || 500, error_rate_percent: Number(errRate) || 5, ...(rate ? { request_rate_per_sec: Number(rate) } : {}) }), onSuccess: () => void qc.invalidateQueries() });
  return (
    <div>
      <PageTitle title="Project settings" subtitle={mode === "demo" ? "Demo mode: changes are kept in browser memory only and reset on reload. Settings that need a backend are labelled read-only where they cannot apply." : "Live mode: changes are saved through the management API (admin token required)."} />
      <DataState isLoading={project.isLoading} isError={project.isError} error={project.error} data={project.data} onRetry={() => project.refetch()}>
        {(p) => (
          <div className="space-y-4">
            <Card title="Project">
              <dl className="grid gap-2 text-sm sm:grid-cols-2"><div><dt className="text-xs text-zinc-500">Project ID</dt><dd className="mono">{p.id}</dd></div><div><dt className="text-xs text-zinc-500">Data source</dt><dd>{mode === "demo" ? "Demo provider (synthetic, in-browser)" : `API provider (${API_BASE_URL || "same origin"})`}</dd></div><div><dt className="text-xs text-zinc-500">Retention</dt><dd>{p.retention_days} days - <Link className="text-teal-700 hover:underline dark:text-teal-300" to="/settings/retention">manage retention</Link></dd></div><div><dt className="text-xs text-zinc-500">API keys</dt><dd><Link className="text-teal-700 hover:underline dark:text-teal-300" to="/settings/api-keys">Manage API keys</Link></dd></div></dl>
              <label className="mt-4 block text-sm">Project name<input className={`${inputCls} ml-2 w-72`} value={name} onChange={(e) => setName(e.target.value)} /></label>
              <button className={`${btnCls} mt-3`} disabled={saveProject.isPending} onClick={() => saveProject.mutate()}>{saveProject.isPending ? "Saving..." : "Save project name"}</button>
              {saveProject.isSuccess && <p className="mt-2 text-sm text-emerald-600">Saved.</p>}{saveProject.isError && <p className="mt-2 text-sm text-red-600">Save failed: {saveProject.error instanceof Error ? saveProject.error.message : "unknown error"}</p>}
            </Card>
            <Card title="Thresholds">
              <div className="flex flex-wrap gap-3 text-sm">
                <label>P95 latency threshold (ms)<input type="number" className={`${inputCls} ml-2 w-28`} value={p95} onChange={(e) => setP95(e.target.value)} /></label>
                <label>Error rate threshold (%)<input type="number" className={`${inputCls} ml-2 w-28`} value={errRate} onChange={(e) => setErrRate(e.target.value)} /></label>
                <label>Request rate threshold (req/s, optional)<input type="number" className={`${inputCls} ml-2 w-28`} value={rate} onChange={(e) => setRate(e.target.value)} /></label>
              </div>
              <button className={`${btnCls} mt-3`} disabled={saveThresholds.isPending} onClick={() => saveThresholds.mutate()}>{saveThresholds.isPending ? "Saving..." : "Save thresholds"}</button>
              {saveThresholds.isSuccess && <p className="mt-2 text-sm text-emerald-600">Thresholds saved. New evaluations use these values.</p>}{saveThresholds.isError && <p className="mt-2 text-sm text-red-600">Save failed: {saveThresholds.error instanceof Error ? saveThresholds.error.message : "unknown error"}</p>}
            </Card>
            <Card title="API connection (live mode)">
              <p className="text-sm text-zinc-500">Used only in API mode. Values are kept in sessionStorage for this tab and sent as request headers; they are never written into the build or a URL.</p>
              <div className="mt-3 flex flex-wrap gap-3 text-sm">
                <label>Project API key (X-Api-Key)<input type="password" className={`${inputCls} ml-2 w-64`} value={apiKey} onChange={(e) => { setApiKey(e.target.value); sessionStorage.setItem("kairo_api_key", e.target.value); }} placeholder="paste project API key" /></label>
                <label>Admin token (X-Admin-Token)<input type="password" className={`${inputCls} ml-2 w-64`} value={adminToken} onChange={(e) => { setAdminToken(e.target.value); sessionStorage.setItem("kairo_admin_token", e.target.value); }} placeholder="management token" /></label>
              </div>
            </Card>
          </div>
        )}
      </DataState>
    </div>
  );
}
