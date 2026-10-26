import { useMemo, useState } from "react";
import { Background, Controls, ReactFlow, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Link } from "react-router-dom";
import type { DependencyEdge, DependencyGraph as Graph } from "../../types";
import { formatDuration, formatPercent } from "../../lib/formatting";
import { Card } from "../../components/ui";

export default function DependencyGraphView({ graph, height = 380, onNavigate }: { graph: Graph; height?: number; onNavigate?: (service: string) => void }) {
  const [selectedEdge, setSelectedEdge] = useState<DependencyEdge | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const { nodes, edges } = useMemo(() => {
    const names = graph.nodes.map((n) => n.service_name);
    const ns: Node[] = names.map((name, i) => ({ id: name, position: { x: (i % 2) * 320, y: Math.floor(i / 2) * 170 }, data: { label: name }, style: { border: selectedNode === name ? "2px solid #2dd4bf" : "1px solid #52525b", borderRadius: 10, padding: 10, background: graph.nodes.find((n) => n.service_name === name)?.threshold_status === "breach" ? "#451a1a" : "#18181b", color: "#fafafa", fontWeight: 600 } }));
    const es: Edge[] = graph.edges.map((e) => ({ id: `${e.source}->${e.target}`, source: e.source, target: e.target, label: `${e.request_count} req, ${formatPercent(e.error_rate)} err`, animated: e.error_rate > 0.05, style: { stroke: e.error_rate > 0.05 ? "#f87171" : "#2dd4bf" } }));
    return { nodes: ns, edges: es };
  }, [graph, selectedNode]);
  return (
    <div>
      <div style={{ height }} className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
        <ReactFlow nodes={nodes} edges={edges} fitView onNodeClick={(_, n) => { setSelectedNode(n.id); onNavigate?.(n.id); }} onEdgeClick={(_, e) => setSelectedEdge(graph.edges.find((x) => `${x.source}->${x.target}` === e.id) ?? null)}>
          <Background /><Controls />
        </ReactFlow>
      </div>
      <p className="mt-2 text-xs text-zinc-500">Legend: teal edge = error rate at or below 5%; red animated edge = error rate above 5%; dark red node = threshold breach. {graph.inferred_note}</p>
      {selectedNode && <p className="mt-2 text-sm">Selected service: <Link className="text-teal-700 hover:underline dark:text-teal-300" to={`/services/${encodeURIComponent(selectedNode)}`}>{selectedNode}</Link></p>}
      {selectedEdge && (<Card title={`Dependency: ${selectedEdge.source} -> ${selectedEdge.target}`}><dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4"><div><dt className="text-xs text-zinc-500">Requests</dt><dd>{selectedEdge.request_count}</dd></div><div><dt className="text-xs text-zinc-500">Errors</dt><dd>{selectedEdge.error_count} ({formatPercent(selectedEdge.error_rate)})</dd></div><div><dt className="text-xs text-zinc-500">Avg latency</dt><dd>{formatDuration(selectedEdge.avg_duration_ns)}</dd></div><div><dt className="text-xs text-zinc-500">P95 latency</dt><dd>{formatDuration(selectedEdge.p95_ns)}</dd></div></dl></Card>)}
      <details className="mt-3"><summary className="cursor-pointer text-sm font-medium">List view (accessible fallback)</summary>
        {graph.edges.length === 0 ? <p className="mt-2 text-sm text-zinc-500">No dependencies observed in this window.</p> : (
        <table className="mt-2 w-full text-left text-sm"><thead><tr className="text-zinc-500"><th className="py-1">From</th><th>To</th><th>Requests</th><th>Error rate</th><th>Avg</th><th>P95</th></tr></thead><tbody>{graph.edges.map((e) => (<tr key={`${e.source}-${e.target}`} className="border-t border-zinc-100 dark:border-zinc-800"><td><Link className="text-teal-700 hover:underline dark:text-teal-300" to={`/services/${encodeURIComponent(e.source)}`}>{e.source}</Link></td><td><Link className="text-teal-700 hover:underline dark:text-teal-300" to={`/services/${encodeURIComponent(e.target)}`}>{e.target}</Link></td><td>{e.request_count}</td><td>{formatPercent(e.error_rate)}</td><td>{formatDuration(e.avg_duration_ns)}</td><td>{formatDuration(e.p95_ns)}</td></tr>))}</tbody></table>)}
      </details>
    </div>
  );
}
