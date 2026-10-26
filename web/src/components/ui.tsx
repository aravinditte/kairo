import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Copy, Check, ArrowUpRight, ArrowDownRight } from "lucide-react";

export function Card({
  title,
  subtitle,
  children,
  action,
  className = "",
}: {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-border bg-card text-card-foreground shadow-xs ${className}`}>
      {(title || action || subtitle) && (
        <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
          <div>
            {title && <h2 className="text-base font-semibold tracking-tight text-foreground">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          {action && <div className="flex items-center gap-2">{action}</div>}
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function MiniSparkline({ data, stroke = "#F472B6" }: { data: number[]; stroke?: string }) {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const w = 72;
  const h = 20;
  const points = data
    .map((val, idx) => {
      const x = (idx / (data.length - 1)) * w;
      const y = h - ((val - min) / range) * (h - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg className="shrink-0 overflow-visible" width={w} height={h} aria-hidden="true">
      <polyline
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}

export function StatCard({
  title,
  value,
  hint,
  trend,
  trendDirection,
  icon,
  sparkline,
  to,
}: {
  title: string;
  value: string;
  hint?: string;
  trend?: string;
  trendDirection?: "up" | "down" | "neutral";
  icon?: ReactNode;
  sparkline?: number[];
  to?: string;
}) {
  const content = (
    <div className={`flex min-w-0 flex-col rounded-xl border border-border bg-card p-5 text-card-foreground shadow-xs transition-all ${to ? "hover:border-[#F472B6]/50 hover:bg-[#1E2838]" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</span>
        {icon && (
          <div className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40 text-muted-foreground">
            {icon}
          </div>
        )}
      </div>
      <div className="mt-3 flex items-baseline justify-between gap-2">
        <span className="font-mono text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{value}</span>
        {sparkline && sparkline.length > 1 && (
          <MiniSparkline
            data={sparkline}
            stroke={trendDirection === "down" ? "#FF6B6B" : "#F472B6"}
          />
        )}
      </div>
      {(hint || trend) && (
        <div className="mt-2 flex items-center justify-between gap-1.5 text-xs text-muted-foreground">
          {trend && (
            <span
              className={`inline-flex items-center font-medium ${
                trendDirection === "down"
                  ? "text-[#FF6B6B]"
                  : trendDirection === "up"
                  ? "text-[#22C55E]"
                  : "text-muted-foreground"
              }`}
            >
              {trendDirection === "up" && <ArrowUpRight className="mr-0.5 size-3.5" />}
              {trendDirection === "down" && <ArrowDownRight className="mr-0.5 size-3.5" />}
              {trend}
            </span>
          )}
          {hint && <span className="truncate">{hint}</span>}
          {to && <span className="ml-auto text-[11px] font-medium text-[#F472B6] hover:underline">View &rarr;</span>}
        </div>
      )}
    </div>
  );

  if (to) {
    return (
      <Link to={to} className="block group">
        {content}
      </Link>
    );
  }

  return content;
}

export function Badge({
  tone = "neutral",
  children,
  className = "",
}: {
  tone?: "ok" | "error" | "warn" | "neutral" | "accent";
  children: ReactNode;
  className?: string;
}) {
  const tones: Record<string, string> = {
    ok: "border-[#22C55E]/30 bg-[#22C55E]/10 text-[#22C55E]",
    error: "border-[#FF6B6B]/30 bg-[#FF6B6B]/10 text-[#FF6B6B]",
    warn: "border-amber-500/30 bg-amber-500/10 text-amber-400",
    neutral: "border-border bg-muted/60 text-muted-foreground",
    accent: "border-[#F472B6]/30 bg-[#F472B6]/10 text-[#F472B6]",
  };
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium transition-colors ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function StatusBadge({ error }: { error: boolean }) {
  return error ? <Badge tone="error">Error</Badge> : <Badge tone="ok">OK</Badge>;
}

export function PageTitle({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export const inputCls =
  "h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm text-foreground shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

export const btnCls =
  "inline-flex items-center justify-center gap-2 rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary/90 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";

export const btnGhost =
  "inline-flex items-center justify-center gap-2 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium text-foreground shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";

export const btnSecondary =
  "inline-flex items-center justify-center gap-2 rounded-md bg-secondary px-3 py-1.5 text-sm font-medium text-secondary-foreground shadow-xs transition-colors hover:bg-secondary/80 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";

export function TraceLink({ traceId }: { traceId: string }) {
  return (
    <Link
      className="mono font-medium text-blue-600 hover:underline dark:text-blue-400"
      to={`/traces/${traceId}`}
      title={traceId}
    >
      {traceId.slice(0, 8)}...{traceId.slice(-4)}
    </Link>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useCopy();
  return (
    <button
      type="button"
      className={btnGhost}
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setCopied(true);
      }}
      aria-label={label}
    >
      {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
      <span>{copied ? "Copied" : label}</span>
    </button>
  );
}

function useCopy(): [boolean, (v: boolean) => void] {
  const [c, setC] = useState(false);
  return [
    c,
    (v) => {
      setC(v);
      if (v) setTimeout(() => setC(false), 1500);
    },
  ];
}
