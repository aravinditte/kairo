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

let singleton: KairoDataProvider | null = null;
export function getProvider(): KairoDataProvider {
  if (singleton) return singleton;
  const projectId = localStorage.getItem("kairo_project_id") ?? (DATA_MODE === "demo" ? DEMO_PROJECT_ID : "");
  singleton = DATA_MODE === "api" ? new ApiDataProvider(API_BASE_URL, projectId) : new DemoDataProvider(DEMO_SEED);
  return singleton;
}
/** Recreate the provider after the project id changes (API mode). */
export function resetProvider() { singleton = null; }
