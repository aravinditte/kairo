import { createBrowserRouter } from "react-router-dom";
import AppLayout from "../layouts/AppLayout";
import OverviewPage from "../pages/OverviewPage";
import TracesPage from "../pages/TracesPage";
import TraceDetailPage from "../pages/TraceDetailPage";
import ServicesPage from "../pages/ServicesPage";
import ServiceDetailPage from "../pages/ServiceDetailPage";
import DependenciesPage from "../pages/DependenciesPage";
import MetricsPage from "../pages/MetricsPage";
import FailureLabPage from "../pages/FailureLabPage";
import ScenarioDetailPage from "../pages/ScenarioDetailPage";
import AlertsPage from "../pages/AlertsPage";
import SettingsPage from "../pages/SettingsPage";
import ApiKeysPage from "../pages/ApiKeysPage";
import RetentionPage from "../pages/RetentionPage";
import DemoLandingPage from "../pages/DemoLandingPage";

export const router = createBrowserRouter([
  { path: "/", element: <AppLayout />, children: [
    { index: true, element: <OverviewPage /> },
    { path: "traces", element: <TracesPage /> },
    { path: "traces/:traceId", element: <TraceDetailPage /> },
    { path: "services", element: <ServicesPage /> },
    { path: "services/:serviceName", element: <ServiceDetailPage /> },
    { path: "dependencies", element: <DependenciesPage /> },
    { path: "metrics", element: <MetricsPage /> },
    { path: "failure-lab", element: <FailureLabPage /> },
    { path: "failure-lab/:scenarioId", element: <ScenarioDetailPage /> },
    { path: "alerts", element: <AlertsPage /> },
    { path: "settings", element: <SettingsPage /> },
    { path: "settings/api-keys", element: <ApiKeysPage /> },
    { path: "settings/retention", element: <RetentionPage /> },
    { path: "demo", element: <DemoLandingPage /> },
  ]},
]);
