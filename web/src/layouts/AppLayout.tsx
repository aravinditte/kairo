import { useState, useEffect } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Activity,
  Layers,
  BarChart3,
  FlaskConical,
  Bell,
  Settings,
  PanelLeft,
  RefreshCw,
  Network,
} from "lucide-react";
import { useAppState, TIME_PRESETS } from "../app/providers";
import { useI18n } from "../lib/i18n";

export default function AppLayout() {
  const {
    mode,
    setMode,
    projectId,
    rangeMinutes,
    setRangeMinutes,
    refresh,
  } = useAppState();

  const { lang, setLang, t } = useI18n();

  const navItems = [
    { to: "/", label: t.nav.overview, icon: LayoutDashboard, end: true },
    { to: "/traces", label: t.nav.traces, icon: Activity },
    { to: "/services", label: t.nav.services, icon: Layers },
    { to: "/dependencies", label: t.nav.dependencies, icon: Network },
    { to: "/metrics", label: t.nav.metrics, icon: BarChart3 },
    { to: "/failure-lab", label: t.nav.failureLab, icon: FlaskConical },
    { to: "/alerts", label: t.nav.alerts, icon: Bell },
    { to: "/settings", label: t.nav.settings, icon: Settings },
  ];

  const loc = useLocation();
  const [collapsed, setCollapsed] = useState(() => {
    return localStorage.getItem("kairo_sidebar_collapsed") === "true";
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(() => new Date().toLocaleTimeString());

  const toggleSidebar = () => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("kairo_sidebar_collapsed", String(next));
      return next;
    });
  };

  const handleRefresh = () => {
    setIsRefreshing(true);
    refresh();
    setLastUpdated(new Date().toLocaleTimeString());
    setTimeout(() => setIsRefreshing(false), 500);
  };

  useEffect(() => {
    setMobileOpen(false);
  }, [loc.pathname]);

  const sidebarContent = (
    <div className="flex h-full flex-col justify-between overflow-hidden bg-[#131A26]">
      {/* Brand Header with Logo */}
      <div>
        <div className="flex h-16 items-center justify-between border-b border-[#27354A] px-4">
          <Link to="/" className="flex items-center gap-3 overflow-hidden group">
            <div className="relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[#F472B6]/40 bg-[#0B0F1A] shadow-xs">
              <img
                src="/kairo-app-icon.png"
                alt="Kairo Logo"
                className="size-full object-cover transition-transform group-hover:scale-105"
              />
            </div>
            {!collapsed && (
              <div className="flex flex-col truncate">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-base font-black tracking-widest text-[#F7F6F3]">
                    KAIRO
                  </span>
                  <span className="text-[10px] font-mono text-[#F472B6] border border-[#F472B6]/30 px-1 rounded bg-[#F472B6]/10">
                    回路
                  </span>
                </div>
                <span className="truncate text-[9.5px] uppercase tracking-wider text-[#A7B0BE]">
                  {t.nav.tagline}
                </span>
              </div>
            )}
          </Link>
        </div>

        {/* Navigation List */}
        <nav aria-label="Main Navigation" className="space-y-1.5 px-3 py-4">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                title={collapsed ? item.label : undefined}
                className={({ isActive }) =>
                  `group flex items-center gap-3 rounded-md px-3 py-2.5 text-xs font-medium transition-all ${
                    isActive
                      ? "bg-[#F472B6]/15 text-[#F472B6] font-bold border-l-3 border-[#F472B6] shadow-2xs"
                      : "text-[#A7B0BE] hover:bg-[#1E2838] hover:text-[#F7F6F3] border-l-3 border-transparent"
                  } ${collapsed ? "justify-center px-0 border-l-0" : ""}`
                }
              >
                <Icon className="size-4 shrink-0" />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </NavLink>
            );
          })}
        </nav>
      </div>

      {/* Footer System Mode Badge */}
      <div className="border-t border-[#27354A] p-3">
        <div
          className={`flex items-center gap-2.5 rounded-lg border border-[#27354A] bg-[#1A2332] p-2.5 ${
            collapsed ? "justify-center p-2" : ""
          }`}
        >
          <span
            className={`size-2 shrink-0 rounded-full ${
              mode === "demo" ? "bg-amber-400" : "bg-[#22C55E]"
            }`}
          />
          {!collapsed && (
            <div className="flex flex-col truncate">
              <span className="font-mono text-[11px] font-bold tracking-wider text-[#F7F6F3]">
                {mode === "demo" ? t.header.simulatedData : t.header.liveBackend}
              </span>
              <span className="truncate text-[10px] text-[#A7B0BE]">
                {projectId}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-[#0B0F1A] text-[#F7F6F3]">
      {/* Desktop Fixed Left Sidebar */}
      <aside
        className={`hidden shrink-0 border-r border-[#27354A] transition-all duration-200 md:block ${
          collapsed ? "w-16" : "w-60"
        }`}
      >
        <div className="sticky top-0 h-screen">{sidebarContent}</div>
      </aside>

      {/* Mobile Sidebar Overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-xs"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative w-64 border-r border-[#27354A] bg-[#131A26]">
            {sidebarContent}
          </div>
        </div>
      )}

      {/* Main Workspace Column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top Navigation Bar */}
        <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between gap-3 border-b border-[#27354A] bg-[#0B0F1A]/95 px-4 backdrop-blur-md sm:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                if (window.innerWidth < 768) {
                  setMobileOpen(true);
                } else {
                  toggleSidebar();
                }
              }}
              className="inline-flex size-8 items-center justify-center rounded-lg border border-[#27354A] bg-[#1A2332] text-[#A7B0BE] hover:bg-[#1E2838] hover:text-[#F7F6F3] transition-colors"
              aria-label={t.header.toggleSidebar}
            >
              <PanelLeft className="size-4" />
            </button>

            {/* Current Project Selector */}
            <div className="hidden items-center gap-1.5 lg:flex">
              <span className="text-xs font-medium text-[#A7B0BE]">{t.header.project}</span>
              <div className="flex items-center gap-1 rounded-md border border-[#27354A] bg-[#1A2332] px-2.5 py-1 text-xs text-[#F7F6F3] font-medium">
                <span>{t.header.projectDemo}</span>
              </div>
            </div>

            {/* Environment Selector */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-[#A7B0BE] hidden sm:inline">{t.header.env}</span>
              <div className="flex items-center gap-1.5 rounded-md border border-[#27354A] bg-[#1A2332] px-2.5 py-1 text-xs text-[#F7F6F3] font-medium">
                <span className="size-1.5 rounded-full bg-[#F472B6]" />
                <span>{t.header.envDemo}</span>
              </div>
            </div>
          </div>

          {/* Right Action Controls */}
          <div className="flex items-center gap-2.5">
            {/* ENG / 日本語 Language Toggle Switch */}
            <div
              className="flex items-center rounded-md border border-[#27354A] bg-[#1A2332] p-0.5 text-xs shadow-2xs"
              role="group"
              aria-label={t.header.language}
            >
              <button
                type="button"
                onClick={() => setLang("en")}
                className={`rounded px-2.5 py-1 font-mono text-[11px] font-bold transition-all cursor-pointer ${
                  lang === "en"
                    ? "bg-[#F472B6] text-[#0B0F1A] shadow-xs"
                    : "text-[#A7B0BE] hover:text-[#F7F6F3]"
                }`}
                title="Switch to English"
              >
                ENG
              </button>
              <button
                type="button"
                onClick={() => setLang("ja")}
                className={`rounded px-2.5 py-1 text-[11px] font-bold transition-all cursor-pointer ${
                  lang === "ja"
                    ? "bg-[#F472B6] text-[#0B0F1A] shadow-xs"
                    : "text-[#A7B0BE] hover:text-[#F7F6F3]"
                }`}
                title="日本語に切り替える (Switch to Japanese)"
              >
                日本語
              </button>
            </div>

            {/* Global Time Range Selector */}
            <div className="flex items-center gap-1">
              <span className="text-xs font-medium text-[#A7B0BE] hidden xl:inline">{t.header.range}</span>
              <select
                aria-label="Global Time Range"
                className="h-8 rounded-md border border-[#27354A] bg-[#1A2332] px-2 text-xs font-medium text-[#F7F6F3] focus:outline-hidden focus:border-[#F472B6]"
                value={rangeMinutes}
                onChange={(e) => setRangeMinutes(Number(e.target.value))}
              >
                {TIME_PRESETS.map((p) => (
                  <option key={p.minutes} value={p.minutes}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Refresh Control */}
            <button
              type="button"
              onClick={handleRefresh}
              className="inline-flex size-8 items-center justify-center rounded-md border border-[#27354A] bg-[#1A2332] text-[#F7F6F3] hover:bg-[#1E2838] transition-colors"
              aria-label="Refresh telemetry snapshot"
              title="Refresh telemetry snapshot"
            >
              <RefreshCw
                className={`size-3.5 text-[#F472B6] ${isRefreshing ? "animate-spin" : ""}`}
              />
            </button>

            {/* Last Updated Timestamp */}
            <div className="hidden font-mono text-[11px] text-[#A7B0BE] md:block whitespace-nowrap">
              {t.header.updated} {lastUpdated}
            </div>

            {/* Data Source Indicator: LIVE BACKEND or SIMULATED DATA */}
            <button
              type="button"
              onClick={() => setMode(mode === "demo" ? "api" : "demo")}
              title={`Currently using ${mode === "demo" ? t.header.simulatedData : t.header.liveBackend}. Click to toggle.`}
              className="flex items-center gap-1.5 rounded-md border border-[#27354A] bg-[#1A2332] px-2.5 py-1 text-xs hover:border-[#F472B6]/50 transition-colors cursor-pointer"
            >
              <span
                className={`size-2 rounded-full ${
                  mode === "demo" ? "bg-amber-400" : "bg-[#22C55E]"
                }`}
              />
              <span className="font-mono text-[11px] font-bold tracking-wider text-[#F7F6F3]">
                {mode === "demo" ? t.header.simulatedData : t.header.liveBackend}
              </span>
            </button>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
