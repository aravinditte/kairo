import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./query-client";
import { API_DEMO_PROJECT_ID, DATA_MODE, DEMO_PROJECT_ID, getProvider, resetProvider, type KairoDataProvider } from "../lib/data-source";
import { I18nProvider } from "../lib/i18n";

export interface TimeRange { start: string; end: string; label: string; minutes: number; }
const PRESETS = [
  { label: "5m", minutes: 5 },
  { label: "15m", minutes: 15 },
  { label: "1h", minutes: 60 },
  { label: "6h", minutes: 360 },
  { label: "24h", minutes: 1440 },
];
export const TIME_PRESETS = PRESETS;
interface AppState {
  provider: KairoDataProvider;
  mode: "demo" | "api";
  setMode: (m: "demo" | "api") => void;
  projectId: string;
  setProjectId: (id: string) => void;
  rangeMinutes: number;
  setRangeMinutes: (m: number) => void;
  range: TimeRange;
  refreshTick: number;
  refresh: () => void;
  theme: "dark" | "light";
  toggleTheme: () => void;
}
const Ctx = createContext<AppState | null>(null);
export function useAppState(): AppState { const c = useContext(Ctx); if (!c) throw new Error("useAppState outside provider"); return c; }

export function AppProviders({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<"demo" | "api">(() => {
    const saved = localStorage.getItem("kairo_data_mode");
    if (saved === "api" || saved === "demo") return saved;
    return DATA_MODE;
  });
  const defaultProjectId = mode === "demo" ? DEMO_PROJECT_ID : API_DEMO_PROJECT_ID;
  const [projectId, setProjectIdState] = useState(() => localStorage.getItem("kairo_project_id") || defaultProjectId);
  const [rangeMinutes, setRangeMinutes] = useState(360);
  const [refreshTick, setRefreshTick] = useState(0);
  const [theme, setTheme] = useState<"dark" | "light">(() => (localStorage.getItem("kairo_theme") as "dark" | "light") || "dark");
  const provider = useMemo(() => {
    resetProvider();
    return getProvider(projectId, mode);
  }, [projectId, mode]);
  const range = useMemo<TimeRange>(() => {
    void refreshTick;
    const end = new Date(); const start = new Date(end.getTime() - rangeMinutes * 60000);
    return { start: start.toISOString(), end: end.toISOString(), label: PRESETS.find((p) => p.minutes === rangeMinutes)?.label ?? `${rangeMinutes}m`, minutes: rangeMinutes };
  }, [rangeMinutes, refreshTick]);
  const value: AppState = {
    provider,
    mode,
    setMode: (m) => {
      localStorage.setItem("kairo_data_mode", m);
      const targetProject = m === "demo" ? DEMO_PROJECT_ID : API_DEMO_PROJECT_ID;
      localStorage.setItem("kairo_project_id", targetProject);
      setProjectIdState(targetProject);
      setModeState(m);
      resetProvider();
      void queryClient.invalidateQueries();
    },
    projectId,
    setProjectId: (id) => {
      localStorage.setItem("kairo_project_id", id);
      resetProvider();
      setProjectIdState(id);
      void queryClient.invalidateQueries();
    },
    rangeMinutes, setRangeMinutes, range, refreshTick, refresh: () => setRefreshTick((x) => x + 1),
    theme, toggleTheme: () => { const next = theme === "dark" ? "light" : "dark"; setTheme(next); localStorage.setItem("kairo_theme", next); document.documentElement.classList.toggle("dark", next === "dark"); document.documentElement.classList.toggle("light", next === "light"); },
  };
  return (
    <I18nProvider>
      <QueryClientProvider client={queryClient}>
        <Ctx.Provider value={value}>{children}</Ctx.Provider>
      </QueryClientProvider>
    </I18nProvider>
  );
}
