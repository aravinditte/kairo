import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  KeyRound,
  Database,
  Shield,
  Save,
  RotateCcw,
  Sliders,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { useAppState } from "../app/providers";
import { useI18n } from "../lib/i18n";
import { DataState } from "../components/feedback";
import { btnCls, btnGhost, Card, inputCls, PageTitle } from "../components/ui";
import { API_BASE_URL } from "../lib/data-source";

export default function SettingsPage() {
  const { provider, mode, projectId, setProjectId } = useAppState();
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const project = useQuery({ queryKey: ["project", projectId], queryFn: () => provider.getProject() });
  const [name, setName] = useState("");
  const [p95, setP95] = useState("");
  const [errRate, setErrRate] = useState("");
  const [rate, setRate] = useState("");
  const [apiKey, setApiKey] = useState(
    () => sessionStorage.getItem("kairo_api_key") ?? (mode === "api" ? "kairo-dev-key" : "")
  );
  const [adminToken, setAdminToken] = useState(
    () => sessionStorage.getItem("kairo_admin_token") ?? (mode === "api" ? "kairo-dev-admin" : "")
  );
  const [targetProjectId, setTargetProjectId] = useState(projectId);

  useEffect(() => {
    setTargetProjectId(projectId);
  }, [projectId]);

  useEffect(() => {
    if (project.data) {
      setName(project.data.name);
      setP95(String(project.data.thresholds.p95_latency_ms));
      setErrRate(String(project.data.thresholds.error_rate_percent));
      setRate(
        project.data.thresholds.request_rate_per_sec
          ? String(project.data.thresholds.request_rate_per_sec)
          : ""
      );
    }
  }, [project.data]);

  const saveProject = useMutation({
    mutationFn: () => provider.updateProject({ name }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["project"] }),
  });

  const saveThresholds = useMutation({
    mutationFn: () =>
      provider.updateThresholds({
        p95_latency_ms: Number(p95) || 500,
        error_rate_percent: Number(errRate) || 5,
        ...(rate ? { request_rate_per_sec: Number(rate) } : {}),
      }),
    onSuccess: () => void qc.invalidateQueries(),
  });

  const applyAuth = () => {
    sessionStorage.setItem("kairo_api_key", apiKey);
    sessionStorage.setItem("kairo_admin_token", adminToken);
    if (targetProjectId !== projectId) {
      setProjectId(targetProjectId);
    } else {
      void qc.invalidateQueries();
    }
  };

  return (
    <div className="space-y-6">
      <PageTitle
        title={t.settings.title}
        subtitle={
          mode === "demo"
            ? lang === "ja"
              ? "デモモード: 設定の変更はこのブラウザセッションのインメモリでのみ保持されます。"
              : "Demo Mode: Settings updates apply in-memory during this browser session. Live backend telemetry requires local execution."
            : lang === "ja"
              ? "ライブクラスタモード: プロジェクトメタデータ、認証トークン、SLO閾値を設定します。"
              : "Live Cluster Mode: Configures project metadata, administrative authentication credentials, and SLO evaluation limits."
        }
      />

      {mode === "api" && (
        <Card
          title={t.settings.apiCredentials}
          subtitle={
            lang === "ja"
              ? "現在のブラウザタブのsessionStorageでのみ保持され、外部には送信されません。"
              : "Managed in browser sessionStorage for this tab only. Never baked into static assets or sent across third-party endpoints."
          }
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 text-xs">
            <div>
              <label className="mb-1 block font-medium text-foreground">{lang === "ja" ? "アクティブプロジェクトID" : "Active Project ID"}</label>
              <input
                list="project-suggestions"
                className={`${inputCls} w-full`}
                value={targetProjectId}
                onChange={(e) => setTargetProjectId(e.target.value)}
                placeholder="project UUID"
              />
            </div>
            <div>
              <label className="mb-1 block font-medium text-foreground">
                {t.settings.apiKey}
              </label>
              <input
                type="password"
                className={`${inputCls} w-full`}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="paste project API key"
              />
            </div>
            <div>
              <label className="mb-1 block font-medium text-foreground">
                {t.settings.adminToken}
              </label>
              <input
                type="password"
                className={`${inputCls} w-full`}
                value={adminToken}
                onChange={(e) => setAdminToken(e.target.value)}
                placeholder="management admin token"
              />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2 pt-2 border-t border-border/60">
            <button className={btnCls} onClick={applyAuth}>
              <Save className="size-3.5" />
              <span>{lang === "ja" ? "認証情報を適用して再読込" : "Apply Credentials & Reload Project"}</span>
            </button>
            <button
              className={btnGhost}
              onClick={() => {
                setApiKey("kairo-dev-key");
                setAdminToken("kairo-dev-admin");
                setTargetProjectId("00000000-0000-0000-0000-000000000001");
                sessionStorage.setItem("kairo_api_key", "kairo-dev-key");
                sessionStorage.setItem("kairo_admin_token", "kairo-dev-admin");
                setProjectId("00000000-0000-0000-0000-000000000001");
              }}
            >
              <RotateCcw className="size-3.5" />
              <span>{lang === "ja" ? "ローカル開発初期値にリセット" : "Reset to Local Dev Defaults"}</span>
            </button>
          </div>
        </Card>
      )}

      <DataState
        isLoading={project.isLoading}
        isError={project.isError}
        error={project.error}
        data={project.data}
        onRetry={() => project.refetch()}
      >
        {(p) => (
          <div className="space-y-6">
            {/* General Project Metadata */}
            <Card
              title={t.settings.projectConfig}
              subtitle={lang === "ja" ? "アイデンティティおよびテレメトリ収集設定" : "Identity and telemetry collection metadata"}
              action={
                <div className="flex items-center gap-2">
                  <Link
                    to="/settings/api-keys"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-input bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-2xs hover:bg-accent hover:text-accent-foreground"
                  >
                    <KeyRound className="size-3.5" />
                    <span>{lang === "ja" ? "キー管理" : "Manage Keys"}</span>
                  </Link>
                  <Link
                    to="/settings/retention"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-input bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-2xs hover:bg-accent hover:text-accent-foreground"
                  >
                    <Database className="size-3.5" />
                    <span>{t.settings.dataRetention}</span>
                  </Link>
                </div>
              }
            >
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 text-xs">
                <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
                  <dt className="text-muted-foreground">{lang === "ja" ? "プロジェクトUUID" : "Project UUID"}</dt>
                  <dd className="mono mt-1 font-semibold text-foreground truncate">{p.id}</dd>
                </div>
                <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
                  <dt className="text-muted-foreground">{lang === "ja" ? "プロバイダモード" : "Provider Mode"}</dt>
                  <dd className="mt-1 font-semibold text-foreground">
                    {mode === "demo"
                      ? lang === "ja" ? "決定論的デモ (ブラウザ)" : "Deterministic Demo (Browser)"
                      : `Live Cluster API (${API_BASE_URL || "Same Origin"})`}
                  </dd>
                </div>
                <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
                  <dt className="text-muted-foreground">{lang === "ja" ? "データ保持期間" : "Retention Policy"}</dt>
                  <dd className="mt-1 font-semibold text-foreground">{p.retention_days} {lang === "ja" ? "日間" : "Days Active"}</dd>
                </div>
                <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
                  <dt className="text-muted-foreground">{lang === "ja" ? "テナント分離" : "Tenant Isolation"}</dt>
                  <dd className="mt-1 font-semibold text-emerald-500">{lang === "ja" ? "行レベルプロジェクト分離" : "Row-Level Project Scoped"}</dd>
                </div>
              </dl>

              <div className="mt-5 max-w-md">
                <label className="mb-1 block text-xs font-medium text-foreground">{t.settings.projectName}</label>
                <div className="flex items-center gap-2">
                  <input
                    className={`${inputCls} w-full`}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                  <button
                    className={btnCls}
                    disabled={saveProject.isPending}
                    onClick={() => saveProject.mutate()}
                  >
                    <Save className="size-3.5" />
                    <span>{saveProject.isPending ? (lang === "ja" ? "保存中..." : "Saving...") : (lang === "ja" ? "保存" : "Save")}</span>
                  </button>
                </div>
                {saveProject.isSuccess && (
                  <p className="mt-2 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                    {lang === "ja" ? "プロジェクト名を保存しました。" : "Project name saved successfully."}
                  </p>
                )}
                {saveProject.isError && (
                  <p className="mt-2 text-xs text-red-600">
                    {saveProject.error instanceof Error ? saveProject.error.message : "unknown error"}
                  </p>
                )}
              </div>
            </Card>

            {/* SLO Thresholds */}
            <Card
              title={t.settings.thresholds}
              subtitle={lang === "ja" ? "ダッシュボードおよびアラート判定で使用されるSLO閾値を設定します" : "Configure service-level breach limits used across dashboards and alert engines"}
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 text-xs">
                <div className="rounded-lg border border-border bg-muted/10 p-3">
                  <label className="mb-1 block font-medium text-foreground">
                    {t.settings.p95Threshold}
                  </label>
                  <input
                    type="number"
                    className={`${inputCls} w-full`}
                    value={p95}
                    onChange={(e) => setP95(e.target.value)}
                  />
                  <p className="mt-1 text-[11px] text-muted-foreground">{lang === "ja" ? "デフォルト: 500 ms" : "Default: 500 ms"}</p>
                </div>

                <div className="rounded-lg border border-border bg-muted/10 p-3">
                  <label className="mb-1 block font-medium text-foreground">
                    {t.settings.errorRateThreshold}
                  </label>
                  <input
                    type="number"
                    className={`${inputCls} w-full`}
                    value={errRate}
                    onChange={(e) => setErrRate(e.target.value)}
                  />
                  <p className="mt-1 text-[11px] text-muted-foreground">{lang === "ja" ? "デフォルト: 5%" : "Default: 5%"}</p>
                </div>

                <div className="rounded-lg border border-border bg-muted/10 p-3">
                  <label className="mb-1 block font-medium text-foreground">
                    {t.settings.rateThreshold}
                  </label>
                  <input
                    type="number"
                    className={`${inputCls} w-full`}
                    value={rate}
                    onChange={(e) => setRate(e.target.value)}
                    placeholder="None"
                  />
                  <p className="mt-1 text-[11px] text-muted-foreground">{lang === "ja" ? "任意のスループット下限" : "Optional throughput floor"}</p>
                </div>
              </div>

              <div className="mt-4 pt-2 border-t border-border/60">
                <button
                  className={btnCls}
                  disabled={saveThresholds.isPending}
                  onClick={() => saveThresholds.mutate()}
                >
                  <Save className="size-3.5" />
                  <span>{saveThresholds.isPending ? (lang === "ja" ? "更新中..." : "Updating Thresholds...") : t.settings.saveThresholds}</span>
                </button>
                {saveThresholds.isSuccess && (
                  <p className="mt-2 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                    {t.settings.savedSuccess}
                  </p>
                )}
                {saveThresholds.isError && (
                  <p className="mt-2 text-xs text-red-600">
                    {saveThresholds.error instanceof Error ? saveThresholds.error.message : "unknown error"}
                  </p>
                )}
              </div>
            </Card>
          </div>
        )}
      </DataState>
    </div>
  );
}
