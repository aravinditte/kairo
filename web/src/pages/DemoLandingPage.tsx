import { Link } from "react-router-dom";
import { Laptop, Server, Play, ArrowRight, CheckCircle2, ShieldCheck, Sparkles } from "lucide-react";
import { useAppState } from "../app/providers";
import { btnCls, btnGhost, Card, PageTitle, Badge } from "../components/ui";

export default function DemoLandingPage() {
  const { mode } = useAppState();

  return (
    <div className="space-y-6 max-w-4xl">
      <PageTitle
        title="Kairo Platform Guide"
        subtitle="See every path. Find every fault. An OpenTelemetry-native distributed observability and failure diagnosis studio."
      />

      <div className="space-y-6">
        {/* Two Modes Card */}
        <Card
          title="Architectural Modes & Data Isolation"
          subtitle="Designed with zero paid dependencies and zero hidden synthetic fallback"
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 text-xs">
            <div className="flex flex-col justify-between rounded-xl border border-blue-500/30 bg-blue-500/5 p-4">
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Laptop className="size-4 text-blue-500" />
                    <h3 className="font-semibold text-foreground">
                      Public Demonstration Mode
                    </h3>
                  </div>
                  <Badge tone="accent">Active ({mode})</Badge>
                </div>
                <p className="mt-2 text-muted-foreground leading-relaxed">
                  Operates 100% in-browser with deterministic synthetic traces across checkout, inventory, payment, and notifications.
                  Failure Lab scenarios simulate fault injections locally with reproducible seeds. Zero backend or cloud infra required.
                </p>
              </div>
              <div className="mt-4 pt-3 border-t border-border/40 text-[11px] text-muted-foreground">
                Honest reporting: Clearly labeled as synthetic everywhere it appears.
              </div>
            </div>

            <div className="flex flex-col justify-between rounded-xl border border-border bg-card p-4">
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Server className="size-4 text-emerald-500" />
                    <h3 className="font-semibold text-foreground">Local Application Mode</h3>
                  </div>
                  <Badge tone="ok">Full Stack</Badge>
                </div>
                <p className="mt-2 text-muted-foreground leading-relaxed">
                  The complete production-grade stack running locally: Go ingestion API, PostgreSQL persistent store, and four official OpenTelemetry-instrumented Go services. Real OTLP/HTTP traces are persisted and analyzed.
                </p>
              </div>
              <div className="mt-4 pt-3 border-t border-border/40 text-[11px] text-muted-foreground">
                Run locally with one PowerShell command: <code className="mono text-foreground font-semibold">.\scripts\run-local.ps1</code>
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
            <strong className="text-foreground">Explicit Failure Contract:</strong> If an API query fails in live mode, Kairo displays a real error state. It never silently substitutes fake or synthetic demo data in place of live telemetry.
          </div>
        </Card>

        {/* Guided Tour Card */}
        <Card
          title="Recommended Investigation Tour"
          subtitle="Try these steps to evaluate Kairo's diagnostics capabilities"
        >
          <div className="space-y-3 text-xs">
            <div className="flex items-start gap-3 rounded-lg border border-border/60 bg-muted/20 p-3">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
                1
              </span>
              <div>
                <strong className="text-foreground font-semibold">Inspect System-Wide RED Metrics</strong>
                <p className="mt-0.5 text-muted-foreground">
                  Open the Overview dashboard to review request volume, error rates, and P95 latency distributions.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 rounded-lg border border-border/60 bg-muted/20 p-3">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
                2
              </span>
              <div>
                <strong className="text-foreground font-semibold">Filter Errors in Trace Explorer</strong>
                <p className="mt-0.5 text-muted-foreground">
                  Navigate to Traces, filter by status = error, and click a failed trace to inspect the timeline waterfall and span attributes.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 rounded-lg border border-border/60 bg-muted/20 p-3">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
                3
              </span>
              <div>
                <strong className="text-foreground font-semibold">Inject Downstream Latency or Failures</strong>
                <p className="mt-0.5 text-muted-foreground">
                  Open the Failure Lab, choose the Payment Errors or Slow Inventory scenario, and trigger the workload to observe ripple effects on checkout.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 rounded-lg border border-border/60 bg-muted/20 p-3">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
                4
              </span>
              <div>
                <strong className="text-foreground font-semibold">Verify Recovery & Baseline Isolation</strong>
                <p className="mt-0.5 text-muted-foreground">
                  Execute the Recovery scenario to see clean traffic resume while preserving earlier failure traces in the historical timeline.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link to="/" className={btnCls}>
              <span>Launch Overview Dashboard</span>
              <ArrowRight className="size-3.5" />
            </Link>
            <Link to="/failure-lab" className={btnGhost}>
              <Play className="size-3.5 fill-current" />
              <span>Open Failure Lab</span>
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
