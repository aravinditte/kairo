import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { Network, RefreshCw, Server, ArrowRight, Layers, Activity } from "lucide-react";
import { useAppState } from "../app/providers";
import { useI18n } from "../lib/i18n";
import { DataState } from "../components/feedback";
import { Card, PageTitle, Badge } from "../components/ui";
import DependencyGraphView from "../features/services/DependencyGraph";
import { formatDuration, formatPercent } from "../lib/formatting";

export default function DependenciesPage() {
  const { provider, range, refreshTick, refresh } = useAppState();
  const { t } = useI18n();
  const navigate = useNavigate();

  const q = useQuery({
    queryKey: ["dependencies-page", range.start, range.end, refreshTick],
    queryFn: () => provider.getDependencies({ start: range.start, end: range.end }),
  });

  return (
    <div className="space-y-6">
      <PageTitle
        title={t.dependencies.title}
        subtitle={t.dependencies.subtitle}
        actions={
          <button
            type="button"
            onClick={refresh}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#27354A] bg-[#1A2332] px-3 py-1.5 text-xs font-medium text-[#F7F6F3] hover:bg-[#1E2838] transition-colors"
          >
            <RefreshCw className="size-3.5 text-[#F472B6]" />
            <span>Refresh</span>
          </button>
        }
      />

      <DataState
        isLoading={q.isLoading}
        isError={q.isError}
        error={q.error}
        data={q.data}
        onRetry={() => q.refetch()}
      >
        {(d) => (
          <div className="space-y-6">
            <Card
              title="Dynamic Service Communication Mesh"
              subtitle="Nodes represent observed microservices; directed edges convey observed call volume, error rates, and P95 latency"
            >
              <DependencyGraphView
                graph={d}
                height={480}
                onNavigate={(svc) => navigate(`/services/${encodeURIComponent(svc)}`)}
              />
            </Card>
          </div>
        )}
      </DataState>
    </div>
  );
}
