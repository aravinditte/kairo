import { useMemo, useState } from "react";
import { Background, Controls, ReactFlow, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Link } from "react-router-dom";
import type { DependencyEdge, DependencyGraph as Graph } from "../../types";
import { formatDuration, formatPercent } from "../../lib/formatting";
import { Card, Badge } from "../../components/ui";

export default function DependencyGraphView({
  graph,
  height = 380,
  onNavigate,
}: {
  graph: Graph;
  height?: number;
  onNavigate?: (service: string) => void;
}) {
  const [selectedEdge, setSelectedEdge] = useState<DependencyEdge | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  const { nodes, edges } = useMemo(() => {
    const names = graph.nodes.map((n) => n.service_name);
    const ns: Node[] = names.map((name, i) => {
      const nodeData = graph.nodes.find((n) => n.service_name === name);
      const isBreached = nodeData?.threshold_status === "breach";
      const isDegraded = (nodeData?.error_rate ?? 0) > 0.05 || ((nodeData?.p95_ns ?? 0) / 1e6) > 400;
      const isSel = selectedNode === name;
      const healthLabel = isBreached ? "Breach" : isDegraded ? "Degraded" : "Healthy";
      const p95Text = nodeData?.p95_ns != null ? formatDuration(nodeData.p95_ns) : "No Data";
      const errText = nodeData?.error_rate != null ? formatPercent(nodeData.error_rate) : "0.0%";
      const reqRateText = nodeData?.request_count != null ? `${nodeData.request_count} req` : "0 req";

      // Fixed topological layout for the 4 demo services:
      // Checkout at left, Inventory / Payment / Notifications stacked at right
      let x = 40;
      let y = 140;
      if (name === "checkout") {
        x = 40;
        y = 120;
      } else if (name === "inventory") {
        x = 380;
        y = 20;
      } else if (name === "payment") {
        x = 380;
        y = 140;
      } else if (name === "notifications") {
        x = 380;
        y = 260;
      } else {
        x = (i % 2) * 340 + 40;
        y = Math.floor(i / 2) * 140 + 20;
      }

      return {
        id: name,
        position: { x, y },
        data: {
          label: (
            <div className="space-y-1.5 text-left">
              <div className="flex items-center justify-between gap-3 border-b border-[#27354A] pb-1">
                <span className="font-bold text-[#F7F6F3] text-xs uppercase tracking-wider">{name}</span>
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                    isBreached
                      ? "bg-[#FF6B6B]/20 text-[#FF6B6B] border border-[#FF6B6B]/40"
                      : isDegraded
                      ? "bg-amber-500/20 text-amber-400 border border-amber-500/40"
                      : "bg-[#22C55E]/20 text-[#22C55E] border border-[#22C55E]/40"
                  }`}
                >
                  {healthLabel}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 font-mono text-[10px] text-[#A7B0BE]">
                <div>
                  <div className="text-[9px] text-[#A7B0BE]/70">RATE</div>
                  <div className="font-semibold text-[#F7F6F3]">{reqRateText}</div>
                </div>
                <div>
                  <div className="text-[9px] text-[#A7B0BE]/70">ERR%</div>
                  <div className={`font-semibold ${isBreached || isDegraded ? "text-[#FF6B6B]" : "text-[#F7F6F3]"}`}>
                    {errText}
                  </div>
                </div>
                <div>
                  <div className="text-[9px] text-[#A7B0BE]/70">P95</div>
                  <div className={`font-semibold ${((nodeData?.p95_ns ?? 0) / 1e6) > 400 ? "text-[#FF6B6B]" : "text-[#F7F6F3]"}`}>
                    {p95Text}
                  </div>
                </div>
              </div>
            </div>
          ),
        },
        style: {
          border: isSel
            ? "2px solid #F472B6"
            : isBreached
            ? "1.5px solid #FF6B6B"
            : isDegraded
            ? "1.5px solid #F59E0B"
            : "1px solid #27354A",
          borderRadius: "0.5rem",
          padding: "10px 14px",
          background: isBreached
            ? "rgba(255, 107, 107, 0.12)"
            : isDegraded
            ? "rgba(245, 158, 11, 0.1)"
            : "#1A2332",
          color: "#F7F6F3",
          minWidth: "210px",
          boxShadow: isSel ? "0 0 0 3px rgba(244, 114, 182, 0.25)" : "0 2px 6px rgba(0,0,0,0.3)",
        },
      };
    });

    const es: Edge[] = graph.edges.map((e) => {
      const isHighErr = e.error_rate > 0.05;
      const isSlow = (e.p95_ns != null && e.p95_ns / 1e6 > 400);
      const edgeLatency = e.p95_ns != null ? formatDuration(e.p95_ns) : `${formatDuration(e.avg_duration_ns)} avg`;
      return {
        id: `${e.source}->${e.target}`,
        source: e.source,
        target: e.target,
        label: `${e.request_count} calls • ${formatPercent(e.error_rate)} err • ${edgeLatency}`,
        animated: isHighErr || isSlow,
        style: {
          stroke: isHighErr ? "#FF6B6B" : isSlow ? "#F59E0B" : "#F472B6",
          strokeWidth: isHighErr || isSlow ? 2.5 : 1.75,
        },
        labelStyle: {
          fontSize: 10,
          fontWeight: 600,
          fill: "#F7F6F3",
          fontFamily: "var(--font-mono)",
        },
        labelBgStyle: {
          fill: "#1A2332",
          fillOpacity: 0.95,
          rx: 4,
          ry: 4,
          stroke: "#27354A",
          strokeWidth: 1,
        },
      };
    });

    return { nodes: ns, edges: es };
  }, [graph, selectedNode]);

  return (
    <div className="space-y-4">
      <div
        style={{ height }}
        className="relative overflow-hidden rounded-xl border border-border bg-card/60 shadow-xs"
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView
          onNodeClick={(_, n) => {
            setSelectedNode(n.id);
            onNavigate?.(n.id);
          }}
          onEdgeClick={(_, e) =>
            setSelectedEdge(graph.edges.find((x) => `${x.source}->${x.target}` === e.id) ?? null)
          }
        >
          <Background color="var(--border)" gap={16} />
          <Controls className="!border-border !bg-card !text-foreground shadow-xs" />
        </ReactFlow>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#A7B0BE]">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-[#F472B6]" /> Normal Dependency Call
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-[#FF6B6B]" /> Degraded / High Error (&gt; 5%)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-amber-400" /> Elevated Latency (&gt; 400ms)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full border border-[#FF6B6B] bg-[#FF6B6B]/20" /> Breached Node
          </span>
        </div>
        <span className="text-[11px] text-[#A7B0BE]/80">{graph.inferred_note}</span>
      </div>

      {selectedNode && (
        <div className="flex items-center justify-between rounded-lg border border-[#27354A] bg-[#1A2332] px-4 py-2.5 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase font-medium text-[#A7B0BE]">Selected Service Node:</span>
            <span className="font-bold text-[#F7F6F3]">{selectedNode}</span>
          </div>
          <Link
            className="text-xs font-semibold text-[#F472B6] hover:underline"
            to={`/services/${encodeURIComponent(selectedNode)}`}
          >
            Open Service Profile &rarr;
          </Link>
        </div>
      )}

      {selectedEdge && (
        <Card
          title={`Dependency: ${selectedEdge.source} → ${selectedEdge.target}`}
          subtitle="Direct inter-service call performance reconstructed from span parentage"
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-border/60 bg-muted/20 p-2.5">
              <span className="text-xs text-muted-foreground">Total Calls</span>
              <p className="text-lg font-semibold text-foreground">{selectedEdge.request_count}</p>
            </div>
            <div className="rounded-lg border border-border/60 bg-muted/20 p-2.5">
              <span className="text-xs text-muted-foreground">Error Rate</span>
              <p className="text-lg font-semibold text-red-500">
                {selectedEdge.error_count} ({formatPercent(selectedEdge.error_rate)})
              </p>
            </div>
            <div className="rounded-lg border border-border/60 bg-muted/20 p-2.5">
              <span className="text-xs text-muted-foreground">Avg Latency</span>
              <p className="mono text-lg font-semibold text-foreground">
                {formatDuration(selectedEdge.avg_duration_ns)}
              </p>
            </div>
            <div className="rounded-lg border border-border/60 bg-muted/20 p-2.5">
              <span className="text-xs text-muted-foreground">P95 Latency</span>
              <p className="mono text-lg font-semibold text-foreground">
                {formatDuration(selectedEdge.p95_ns)}
              </p>
            </div>
          </div>
        </Card>
      )}

      <details className="rounded-xl border border-border bg-card p-4 text-sm shadow-xs">
        <summary className="cursor-pointer font-medium text-foreground">
          Dependency Matrix (Tabular View)
        </summary>
        {graph.edges.length === 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">No service dependencies detected in this time range.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border text-muted-foreground">
                <tr>
                  <th className="py-2 font-medium">Source Service</th>
                  <th className="py-2 font-medium">Target Service</th>
                  <th className="py-2 font-medium">Calls</th>
                  <th className="py-2 font-medium">Error Rate</th>
                  <th className="py-2 font-medium">Avg Duration</th>
                  <th className="py-2 font-medium">P95 Latency</th>
                  <th className="py-2 font-medium">Health</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {graph.edges.map((e) => (
                  <tr key={`${e.source}-${e.target}`} className="hover:bg-muted/40 transition-colors">
                    <td className="py-2 font-semibold">
                      <Link
                        className="text-foreground hover:text-blue-500 hover:underline"
                        to={`/services/${encodeURIComponent(e.source)}`}
                      >
                        {e.source}
                      </Link>
                    </td>
                    <td className="py-2 font-semibold">
                      <Link
                        className="text-foreground hover:text-blue-500 hover:underline"
                        to={`/services/${encodeURIComponent(e.target)}`}
                      >
                        {e.target}
                      </Link>
                    </td>
                    <td className="py-2">{e.request_count}</td>
                    <td className="py-2">{formatPercent(e.error_rate)}</td>
                    <td className="mono py-2">{formatDuration(e.avg_duration_ns)}</td>
                    <td className="mono py-2">{formatDuration(e.p95_ns)}</td>
                    <td className="py-2">
                      {e.error_rate > 0.05 ? <Badge tone="error">Degraded</Badge> : <Badge tone="ok">Healthy</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </details>
    </div>
  );
}
