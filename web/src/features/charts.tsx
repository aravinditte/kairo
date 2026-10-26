import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Bar, BarChart } from "recharts";
import type { MetricBucket } from "../types";
import { formatTime } from "../lib/formatting";
export function bucketRows(series: MetricBucket[]) {
  return series.map((b) => ({ time: formatTime(b.bucket_start), requests: b.request_count, errors: b.error_count, p50: b.p50_ns == null ? null : b.p50_ns / 1e6, p95: b.p95_ns == null ? null : b.p95_ns / 1e6, p99: b.p99_ns == null ? null : b.p99_ns / 1e6 }));
}
const axis = { fontSize: 11 } as const;
export function RequestVolumeChart({ series }: { series: MetricBucket[] }) {
  const rows = bucketRows(series);
  return (<div aria-label="Request volume and errors chart"><ResponsiveContainer width="100%" height={260}><LineChart data={rows}><CartesianGrid strokeDasharray="3 3" opacity={0.3} /><XAxis dataKey="time" tick={axis} /><YAxis tick={axis} label={{ value: "requests", angle: -90, position: "insideLeft", fontSize: 11 }} /><Tooltip /><Legend /><Line type="monotone" dataKey="requests" stroke="#2dd4bf" dot={false} name="Requests" /><Line type="monotone" dataKey="errors" stroke="#f87171" dot={false} name="Errors" /></LineChart></ResponsiveContainer></div>);
}
export function LatencyChart({ series }: { series: MetricBucket[] }) {
  const rows = bucketRows(series);
  return (<div aria-label="Latency percentiles chart, milliseconds"><ResponsiveContainer width="100%" height={260}><LineChart data={rows}><CartesianGrid strokeDasharray="3 3" opacity={0.3} /><XAxis dataKey="time" tick={axis} /><YAxis tick={axis} label={{ value: "ms", angle: -90, position: "insideLeft", fontSize: 11 }} /><Tooltip formatter={(v: unknown) => `${Number(v).toFixed(1)} ms`} /><Legend /><Line type="monotone" dataKey="p50" stroke="#38bdf8" dot={false} name="p50 (ms)" connectNulls /><Line type="monotone" dataKey="p95" stroke="#fbbf24" dot={false} name="p95 (ms)" connectNulls /><Line type="monotone" dataKey="p99" stroke="#f87171" dot={false} name="p99 (ms)" connectNulls /></LineChart></ResponsiveContainer><p className="text-xs text-zinc-500">Latency in milliseconds. Buckets with no server-span samples are gaps, not zero latency.</p></div>);
}
export function ErrorBarChart({ data }: { data: { service: string; error_count: number }[] }) {
  return (<ResponsiveContainer width="100%" height={240}><BarChart data={data}><CartesianGrid strokeDasharray="3 3" opacity={0.3} /><XAxis dataKey="service" tick={axis} /><YAxis tick={axis} label={{ value: "errors", angle: -90, position: "insideLeft", fontSize: 11 }} /><Tooltip /><Bar dataKey="error_count" fill="#f87171" name="Error count" /></BarChart></ResponsiveContainer>);
}
