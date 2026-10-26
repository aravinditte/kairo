import { Link } from "react-router-dom";
import { useAppState } from "../app/providers";
import { btnCls, Card, PageTitle } from "../components/ui";

export default function DemoLandingPage() {
  const { mode } = useAppState();
  return (
    <div>
      <PageTitle title="Kairo demonstration" subtitle="See every path. Find every fault." />
      <div className="space-y-4">
        <Card title="Two honest modes">
          <div className="grid gap-4 md:grid-cols-2 text-sm">
            <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"><h3 className="font-semibold">Public demo mode (this build: {mode})</h3><p className="mt-1 text-zinc-600 dark:text-zinc-300">The frontend runs entirely in your browser with a deterministic synthetic dataset covering checkout, inventory, payment, and notifications. Failure Lab scenarios are browser simulations, labelled as synthetic wherever they appear. No backend, database, login, or paid service is involved.</p></div>
            <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"><h3 className="font-semibold">Local application mode</h3><p className="mt-1 text-zinc-600 dark:text-zinc-300">Run the full stack locally with Docker Compose: Go API, PostgreSQL, four OpenTelemetry-instrumented demo services, and this frontend in API mode. Real OTLP traces are persisted, and the Failure Lab faults the actual demo services.</p></div>
          </div>
          <p className="mt-3 text-sm text-zinc-500">The app never silently swaps live data for synthetic data: if the API fails in live mode you get an error state, not demo data.</p>
        </Card>
        <Card title="What to try">
          <ol className="list-decimal space-y-1 pl-5 text-sm text-zinc-600 dark:text-zinc-300">
            <li>Open the overview and note the error rate and p95 latency for the window.</li>
            <li>Filter the trace explorer by status = error and open a failed trace waterfall.</li>
            <li>Run the Payment Errors scenario in the Failure Lab, then compare before/after metrics and open a resulting trace.</li>
            <li>Run Recovery and confirm new traces are healthy while the earlier failures remain visible.</li>
          </ol>
          <Link to="/" className={`${btnCls} mt-4 inline-block`}>Launch the app</Link>
          <Link to="/failure-lab" className="ml-2 inline-block rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700">Open Failure Lab</Link>
        </Card>
      </div>
    </div>
  );
}
