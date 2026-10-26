import { ApiDataProvider } from "./ApiDataProvider";
import { DemoDataProvider } from "./DemoDataProvider";
import type { KairoDataProvider } from "./DataProvider";
export type { KairoDataProvider } from "./DataProvider";
export { ApiDataProvider, DemoDataProvider };

export type DataMode = "demo" | "api";
export const DATA_MODE: DataMode = (import.meta.env.VITE_DATA_MODE === "api" ? "api" : "demo");
export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? "";
export const DEMO_SEED: number = Number(import.meta.env.VITE_DEMO_SCENARIO_SEED ?? 42) || 42;
export const DEMO_PROJECT_ID = "demo-project";
export const API_DEMO_PROJECT_ID = "00000000-0000-0000-0000-000000000001";

let singleton: KairoDataProvider | null = null;
export function getProvider(customProjectId?: string, customMode?: DataMode): KairoDataProvider {
  if (singleton) return singleton;
  const activeMode = customMode ?? (localStorage.getItem("kairo_data_mode") as DataMode) ?? DATA_MODE;
  const defaultProjectId = activeMode === "demo" ? DEMO_PROJECT_ID : API_DEMO_PROJECT_ID;
  const projectId = customProjectId ?? localStorage.getItem("kairo_project_id") ?? defaultProjectId;
  singleton = activeMode === "api" ? new ApiDataProvider(API_BASE_URL, projectId) : new DemoDataProvider(DEMO_SEED);
  return singleton;
}
/** Recreate the provider after the project id or mode changes. */
export function resetProvider() { singleton = null; }
