import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Bar,
  BarChart,
} from "recharts";
import type { MetricBucket } from "../types";
import { formatTime } from "../lib/formatting";

export function bucketRows(series: MetricBucket[], intervalSeconds = 300) {
  return series.map((b) => {
    const total = b.request_count;
    const errors = b.error_count;
    const successes = Math.max(0, total - errors);
    const secs = Math.max(1, intervalSeconds);
    return {
      time: formatTime(b.bucket_start),
      timestamp: b.bucket_start,
      requests: total,
      errors: errors,
      successes: successes,
      rate: Number((total / secs).toFixed(2)),
      successRate: Number((successes / secs).toFixed(2)),
      errorRate: Number((errors / secs).toFixed(2)),
      p50: b.p50_ns == null ? null : Number((b.p50_ns / 1e6).toFixed(1)),
      p95: b.p95_ns == null ? null : Number((b.p95_ns / 1e6).toFixed(1)),
      p99: b.p99_ns == null ? null : Number((b.p99_ns / 1e6).toFixed(1)),
    };
  });
}

const axisTick = { fontSize: 11, fill: "#A7B0BE" } as const;

function CustomTooltip({
  active,
  payload,
  label,
  unit = "",
}: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
  unit?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-[#27354A] bg-[#1A2332] p-2.5 text-xs text-[#F7F6F3] shadow-lg">
      <div className="mb-1.5 font-medium text-[#A7B0BE]">{label}</div>
      <div className="space-y-1">
        {payload.map((item, idx) => (
          <div key={idx} className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-1.5">
              <span className="size-2 rounded-full" style={{ backgroundColor: item.color }} />
              <span className="text-[#A7B0BE]">{item.name}:</span>
            </div>
            <span className="font-mono font-medium text-[#F7F6F3]">
              {typeof item.value === "number" ? item.value.toLocaleString() : item.value}
              {unit}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function RequestTrafficChart({
  series,
  intervalSeconds = 300,
}: {
  series: MetricBucket[];
  intervalSeconds?: number;
}) {
  const rows = bucketRows(series, intervalSeconds);
  return (
    <div aria-label="Request traffic rate chart (req/s)" className="w-full">
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={rows} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#27354A" opacity={0.6} />
          <XAxis dataKey="time" tick={axisTick} stroke="#27354A" />
          <YAxis tick={axisTick} stroke="#27354A" unit=" /s" />
          <Tooltip content={<CustomTooltip unit=" req/s" />} />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
          <Line
            type="monotone"
            dataKey="rate"
            stroke="#F472B6"
            strokeWidth={2}
            dot={false}
            name="Total Req/s"
          />
          <Line
            type="monotone"
            dataKey="successRate"
            stroke="#22C55E"
            strokeWidth={2}
            dot={false}
            name="Success Req/s"
          />
          <Line
            type="monotone"
            dataKey="errorRate"
            stroke="#FF6B6B"
            strokeWidth={2}
            dot={false}
            name="Failed Req/s"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function RequestVolumeChart({ series }: { series: MetricBucket[] }) {
  return <RequestTrafficChart series={series} />;
}

export function LatencyChart({ series }: { series: MetricBucket[] }) {
  const rows = bucketRows(series);
  return (
    <div aria-label="Latency percentiles chart, milliseconds" className="w-full">
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={rows} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#27354A" opacity={0.6} />
          <XAxis dataKey="time" tick={axisTick} stroke="#27354A" />
          <YAxis tick={axisTick} stroke="#27354A" unit=" ms" />
          <Tooltip
            content={<CustomTooltip unit=" ms" />}
          />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
          <Line
            type="monotone"
            dataKey="p50"
            stroke="#38BDF8"
            strokeWidth={2}
            dot={false}
            name="P50 (ms)"
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="p95"
            stroke="#F472B6"
            strokeWidth={2}
            dot={false}
            name="P95 (ms)"
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="p99"
            stroke="#FF6B6B"
            strokeWidth={2}
            dot={false}
            name="P99 (ms)"
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
      <p className="mt-2 text-xs text-[#A7B0BE]">
        Latency measured in milliseconds. Buckets without server-span samples represent gaps, not zero latency.
      </p>
    </div>
  );
}

export function ErrorBarChart({ data }: { data: { service: string; error_count: number }[] }) {
  return (
    <div className="w-full">
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#27354A" opacity={0.6} />
          <XAxis dataKey="service" tick={axisTick} stroke="#27354A" />
          <YAxis tick={axisTick} stroke="#27354A" />
          <Tooltip content={<CustomTooltip unit=" errors" />} />
          <Bar
            dataKey="error_count"
            fill="#FF6B6B"
            radius={[4, 4, 0, 0]}
            name="Error count"
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
