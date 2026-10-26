import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAppState, TIME_PRESETS } from "../app/providers";
import { DemoModeBanner } from "../components/feedback";
import { formatTimestamp } from "../lib/formatting";

const NAV = [
  { to: "/", label: "Overview", end: true }, { to: "/traces", label: "Traces" }, { to: "/services", label: "Services" },
  { to: "/metrics", label: "Metrics" }, { to: "/failure-lab", label: "Failure Lab" }, { to: "/alerts", label: "Alerts" }, { to: "/settings", label: "Settings" },
];
function crumbs(path: string): string {
  if (path === "/") return "Overview";
  return path.split("/").filter(Boolean).map((s) => s.replace(/-/g, " ")).join(" / ");
}
export default function AppLayout() {
  const { mode, projectId, setProjectId, rangeMinutes, setRangeMinutes, range, refresh, theme, toggleTheme } = useAppState();
  const loc = useLocation();
  return (
    <div className="flex min-h-full bg-zinc-100 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 md:flex">
        <div className="mb-1 flex items-center gap-2"><svg width="28" height="28" viewBox="0 0 64 64" aria-hidden><rect width="64" height="64" rx="12" fill="#0b0e14"/><path d="M18 14v36M18 32l16-18M19 33l17 17" stroke="#2dd4bf" strokeWidth="6" strokeLinecap="round" fill="none"/></svg><span className="text-lg font-bold">Kairo</span></div>
        <p className="mb-4 text-xs text-zinc-500">See every path. Find every fault.</p>
        <nav className="flex flex-col gap-1" aria-label="Primary">
          {NAV.map((n) => (<NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `rounded-md px-3 py-2 text-sm ${isActive ? "bg-teal-600 font-medium text-white" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"}`}>{n.label}</NavLink>))}
        </nav>
        <div className="mt-auto space-y-2 text-xs text-zinc-500">
          <p>Data source: <strong className="text-zinc-700 dark:text-zinc-200">{mode === "demo" ? "Demo (synthetic)" : "Live API"}</strong></p>
          <NavLink to="/demo" className="text-teal-700 hover:underline dark:text-teal-300">About the demo</NavLink>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white/90 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/90">
          <div className="flex flex-wrap items-center gap-2 px-4 py-2">
            <span className="text-sm capitalize text-zinc-500 md:hidden">Kairo - </span>
            <nav aria-label="Breadcrumb" className="text-sm capitalize text-zinc-500 dark:text-zinc-400">{crumbs(loc.pathname)}</nav>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <label className="text-xs text-zinc-500">Project <input aria-label="Project ID" className="w-36 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800" value={projectId} onChange={(e) => setProjectId(e.target.value)} placeholder={mode === "demo" ? "demo-project" : "project id"} /></label>
              <label className="text-xs text-zinc-500">Range <select aria-label="Time range" className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800" value={rangeMinutes} onChange={(e) => setRangeMinutes(Number(e.target.value))}>{TIME_PRESETS.map((p) => <option key={p.minutes} value={p.minutes}>Last {p.label}</option>)}</select></label>
              <button className="rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700" onClick={refresh}>Refresh</button>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${mode === "demo" ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" : "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"}`}>{mode === "demo" ? "Synthetic demo data" : "Live API"}</span>
              <button className="rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700" onClick={toggleTheme} aria-label="Toggle theme">{theme === "dark" ? "Light" : "Dark"}</button>
            </div>
          </div>
          <div className="flex gap-1 overflow-x-auto px-4 pb-2 md:hidden">{NAV.map((n) => (<NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `whitespace-nowrap rounded-md px-2 py-1 text-sm ${isActive ? "bg-teal-600 text-white" : "text-zinc-600 dark:text-zinc-300"}`}>{n.label}</NavLink>))}</div>
        </header>
        <main className="mx-auto max-w-[1440px] p-4">
          {mode === "demo" && <div className="mb-4"><DemoModeBanner /></div>}
          <p className="mb-3 text-xs text-zinc-400">Window: {formatTimestamp(range.start)} - {formatTimestamp(range.end)}</p>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
