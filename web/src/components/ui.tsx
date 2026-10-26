import type { ReactNode } from "react";
import { Link } from "react-router-dom";
export function Card({ title, children, action }: { title?: string; children: ReactNode; action?: ReactNode }) {
  return (<section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
    {(title || action) && (<div className="mb-3 flex items-center justify-between gap-2"><h2 className="text-sm font-semibold tracking-wide text-zinc-700 dark:text-zinc-200">{title}</h2>{action}</div>)}
    {children}</section>);
}
export function Badge({ tone = "neutral", children }: { tone?: "ok" | "error" | "warn" | "neutral" | "accent"; children: ReactNode }) {
  const tones: Record<string, string> = {
    ok: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
    error: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
    warn: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
    neutral: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
    accent: "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300",
  };
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}
export function StatusBadge({ error }: { error: boolean }) { return error ? <Badge tone="error">Error</Badge> : <Badge tone="ok">OK</Badge>; }
export function PageTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (<div className="mb-4"><h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{title}</h1>{subtitle && <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{subtitle}</p>}</div>);
}
export const inputCls = "rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100";
export const btnCls = "rounded-md bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-500 disabled:cursor-not-allowed disabled:opacity-50";
export const btnGhost = "rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800 disabled:opacity-50";
export function TraceLink({ traceId }: { traceId: string }) {
  return <Link className="mono text-teal-700 hover:underline dark:text-teal-300" to={`/traces/${traceId}`}>{traceId.slice(0, 12)}...</Link>;
}
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useCopy();
  return <button type="button" className={btnGhost} onClick={() => { void navigator.clipboard?.writeText(text); setCopied(true); }}>{copied ? "Copied" : label}</button>;
}
import { useState } from "react";
function useCopy(): [boolean, (v: boolean) => void] { const [c, setC] = useState(false); return [c, (v) => { setC(v); if (v) setTimeout(() => setC(false), 1500); }]; }
