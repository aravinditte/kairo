import type { ReactNode } from "react";
import { AlertCircle, AlertTriangle, Info, Loader2, RefreshCw } from "lucide-react";
import { btnCls } from "../ui";

export function LoadingState({ label = "Loading data..." }: { label?: string }) {
  return (
    <div
      role="status"
      className="flex items-center gap-3 rounded-xl border border-border bg-card p-8 text-sm text-muted-foreground shadow-xs"
    >
      <Loader2 className="size-5 animate-spin text-primary" />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({
  title,
  children,
  icon,
}: {
  title: string;
  children?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/50 p-10 text-center text-card-foreground shadow-xs">
      <div className="mb-3 flex size-12 items-center justify-center rounded-full border border-border bg-muted/60 text-muted-foreground">
        {icon || <Info className="size-6" />}
      </div>
      <p className="text-base font-semibold text-foreground">{title}</p>
      {children && <div className="mt-2 max-w-md text-sm text-muted-foreground">{children}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : "The data request failed.";
  return (
    <div
      role="alert"
      className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-card-foreground shadow-xs"
    >
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 size-5 shrink-0 text-red-600 dark:text-red-400" />
        <div className="flex-1">
          <p className="font-semibold text-red-600 dark:text-red-400">Could not load telemetry</p>
          <p className="mt-1 text-sm text-foreground/80">{msg}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Live API failures are shown explicitly. Kairo never silently substitutes synthetic demo data in place of real telemetry.
          </p>
          {onRetry && (
            <button className={`${btnCls} mt-4`} onClick={onRetry}>
              <RefreshCw className="size-3.5" />
              <span>Retry Request</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function DemoModeBanner({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className="flex items-center gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-700 dark:text-amber-300"
      role="note"
    >
      <AlertTriangle className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <div>
        <strong className="font-semibold">Demo mode — deterministic synthetic telemetry.</strong>
        {!compact && (
          <span className="ml-1 text-muted-foreground">
            All traces and metrics are simulated locally in the browser to demonstrate platform behavior without requiring a running backend.
          </span>
        )}
      </div>
    </div>
  );
}

export function DataState<T>({
  isLoading,
  isError,
  error,
  data,
  empty,
  children,
  onRetry,
}: {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  data: T | undefined;
  empty?: (d: T) => boolean;
  children: (d: T) => ReactNode;
  onRetry?: () => void;
}) {
  if (isLoading) return <LoadingState />;
  if (isError) return <ErrorState error={error} onRetry={onRetry} />;
  if (data === undefined) return <EmptyState title="No data available" />;
  if (empty && empty(data)) {
    return (
      <EmptyState title="No telemetry in this window">
        Try selecting a broader time window or trigger a Failure Lab scenario to generate realistic traffic across services.
      </EmptyState>
    );
  }
  return <>{children(data)}</>;
}
