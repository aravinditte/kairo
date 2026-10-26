import type { ReactNode } from "react";
import { btnCls } from "../ui";
export function LoadingState({ label = "Loading data..." }: { label?: string }) {
  return <div role="status" className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white p-6 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400"><span className="h-4 w-4 animate-spin rounded-full border-2 border-teal-500 border-t-transparent" />{label}</div>;
}
export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-6 text-center dark:border-zinc-700 dark:bg-zinc-900"><p className="font-medium text-zinc-800 dark:text-zinc-100">{title}</p>{children && <div className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{children}</div>}</div>;
}
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : "The data request failed.";
  return <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-6 dark:border-red-900 dark:bg-red-950/40"><p className="font-medium text-red-800 dark:text-red-200">Could not load data</p><p className="mt-1 text-sm text-red-700 dark:text-red-300">{msg}</p><p className="mt-1 text-xs text-red-600 dark:text-red-400">Live API failures are shown as errors. Kairo does not silently substitute synthetic demo data.</p>{onRetry && <button className={`${btnCls} mt-3`} onClick={onRetry}>Retry</button>}</div>;
}
export function DemoModeBanner({ compact = false }: { compact?: boolean }) {
  return <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200" role="note"><strong>Demo mode - synthetic data.</strong>{!compact && " Everything on this page is generated deterministically in your browser. It is not live backend telemetry."}</div>;
}
export function DataState<T>({ isLoading, isError, error, data, empty, children, onRetry }: { isLoading: boolean; isError: boolean; error: unknown; data: T | undefined; empty?: (d: T) => boolean; children: (d: T) => ReactNode; onRetry?: () => void }) {
  if (isLoading) return <LoadingState />;
  if (isError) return <ErrorState error={error} onRetry={onRetry} />;
  if (data === undefined) return <EmptyState title="No data" />;
  if (empty && empty(data)) return <EmptyState title="No telemetry in this window">Try a wider time range, or run a Failure Lab scenario to generate traces.</EmptyState>;
  return <>{children(data)}</>;
}
