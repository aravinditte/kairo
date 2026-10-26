import React, { useState, useEffect, useRef } from "react";
import { Terminal, Download, Trash2, ArrowDown, Play, CheckCircle2, AlertTriangle, XCircle, Info, CornerDownLeft } from "lucide-react";
import type { ConsoleLogEntry, DependencyEdge, ScenarioDefinition, ScenarioRun, ServiceSummary, Span, TraceSummary } from "../../types";
import type { KairoDataProvider } from "../../lib/data-source/DataProvider";
import { SCENARIO_DEFINITIONS } from "../../data/factories/scenarioFactory";
import { formatDuration, formatPercent } from "../../lib/formatting";
import { useI18n } from "../../lib/i18n";

interface SimulatorConsoleProps {
  provider: KairoDataProvider;
  activeScenarioId: string;
  onSelectScenario: (id: string) => void;
  onScenarioExecuted: (run: ScenarioRun) => void;
  onRefresh: () => void;
  mode: "demo" | "api";
}

export default function SimulatorConsole({
  provider,
  activeScenarioId,
  onSelectScenario,
  onScenarioExecuted,
  onRefresh,
  mode,
}: SimulatorConsoleProps) {
  const [logs, setLogs] = useState<ConsoleLogEntry[]>(() => {
    return provider.getConsoleLogs ? provider.getConsoleLogs() : [];
  });
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const [autoScroll, setAutoScroll] = useState(true);
  const [status, setStatus] = useState<"IDLE" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED">("IDLE");
  const { lang, t } = useI18n();
  const outputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync logs periodically or upon actions
  useEffect(() => {
    const timer = setInterval(() => {
      if (provider.getConsoleLogs) {
        const current = provider.getConsoleLogs();
        setLogs(current);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [provider]);

  useEffect(() => {
    if (autoScroll && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const addLog = (severity: ConsoleLogEntry["severity"], subsystem: string, message: string) => {
    const entry: ConsoleLogEntry = {
      id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
      severity,
      subsystem,
      message,
    };
    if (provider.addConsoleLog) {
      provider.addConsoleLog({ severity, subsystem, message });
    }
    setLogs((prev) => [...prev, entry]);
  };

  const handleClear = () => {
    if (provider.clearConsoleLogs) {
      provider.clearConsoleLogs();
    }
    setLogs([]);
  };

  const handleDownload = () => {
    const text = logs
      .map((l) => `[${l.timestamp.slice(11, 23)}] ${l.severity.padEnd(7)} ${l.subsystem.padEnd(10)} ${l.message}`)
      .join("\n");
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `kairo-simulator-${Date.now()}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const executeCommand = async (rawCmd: string) => {
    const trimmed = rawCmd.trim();
    if (!trimmed) return;

    // Record in history
    setHistory((prev) => [...prev, trimmed]);
    setHistoryIndex(-1);

    // Echo command
    addLog("INFO", "input", `> ${trimmed}`);

    const parts = trimmed.split(/\s+/);
    const command = parts[0].toLowerCase();
    const args = parts.slice(1);

    try {
      switch (command) {
        case "help": {
          addLog("INFO", "help", "KAIRO SIMULATOR COMMAND MANUAL:");
          addLog("INFO", "help", "  status                           Inspect active simulation state & metrics");
          addLog("INFO", "help", "  scenarios                        List all 8 available scenario recipes");
          addLog("INFO", "help", "  run <scenario-id> [options]      Execute a fault scenario (e.g. run slow-inventory --delay-ms 1500 --requests 50)");
          addLog("INFO", "help", "  metrics [--service <name>]       Query RED metrics for active time window");
          addLog("INFO", "help", "  traces [--status <error|ok>]     List matching traces from telemetry pool");
          addLog("INFO", "help", "  trace <trace-id>                 Inspect full span tree for a given trace");
          addLog("INFO", "help", "  services                         Display discovered services & health state");
          addLog("INFO", "help", "  recover                          Deactivate faults and generate healthy baseline");
          addLog("INFO", "help", "  stop                             Cancel currently running scenario execution");
          addLog("INFO", "help", "  reset                            Reset simulation data to pristine baseline");
          addLog("INFO", "help", "  clear                            Clear visible console output");
          addLog("INFO", "help", "  history                          Show command execution history");
          break;
        }

        case "status": {
          const now = new Date();
          const start = new Date(now.getTime() - 3600000).toISOString();
          const metrics = await provider.getMetrics({ start, end: now.toISOString() });
          addLog("INFO", "status", `Environment: Kairo Demo | Execution Mode: ${mode === "demo" ? "Frontend Simulation" : "Local Backend"}`);
          addLog("INFO", "status", `Scenario Status: ${status} | Active Target: ${activeScenarioId}`);
          addLog("INFO", "status", `Observed Requests: ${metrics.request_count} | Error Rate: ${formatPercent(metrics.error_rate)} | P95 Latency: ${formatDuration(metrics.p95_ns)}`);
          break;
        }

        case "scenarios": {
          addLog("INFO", "scenarios", "AVAILABLE FAULT SCENARIO DEFINITIONS:");
          SCENARIO_DEFINITIONS.forEach((s) => {
            addLog("INFO", "scenarios", `  ${s.id.padEnd(22)} [${s.difficulty || "Standard"}] ${s.name} - ${s.description.slice(0, 70)}...`);
          });
          break;
        }

        case "run": {
          if (!args[0]) {
            addLog("ERROR", "command", "Missing scenario identifier. Usage: run <scenario-id> [--requests <n>] [--seed <n>]");
            addLog("INFO", "hint", "Run 'scenarios' to see all available scenario IDs.");
            return;
          }

          const scenarioId = args[0].toLowerCase();
          const def = SCENARIO_DEFINITIONS.find((s) => s.id === scenarioId);
          if (!def) {
            addLog("ERROR", "command", `Unknown scenario identifier: "${scenarioId}".`);
            addLog("INFO", "hint", "Run 'scenarios' to list supported scenario IDs.");
            return;
          }

          // Parse flags: e.g. --delay-ms 1500 --requests 50 --error-rate 0.20
          const params: Record<string, number> = {};
          let workload = 40;

          for (let i = 1; i < args.length; i++) {
            const arg = args[i];
            if (arg.startsWith("--") && i + 1 < args.length) {
              const key = arg.slice(2).replace(/-/g, "_");
              const val = parseFloat(args[i + 1]);
              if (!isNaN(val)) {
                if (key === "requests" || key === "workload") {
                  workload = Math.max(1, Math.min(200, Math.floor(val)));
                } else if (key === "error_rate" && val <= 1 && val > 0) {
                  params[key] = val * 100; // normalize 0.20 to 20%
                } else {
                  params[key] = val;
                }
              }
              i++;
            }
          }

          onSelectScenario(scenarioId);
          setStatus("RUNNING");
          addLog("INFO", "runner", `Dispatching scenario "${def.name}" with workload ${workload}...`);

          try {
            const run = await provider.runScenario({
              scenario_id: scenarioId,
              parameters: params,
              workload,
            });
            setStatus("COMPLETED");
            onScenarioExecuted(run);
            onRefresh();
          } catch (err) {
            setStatus("FAILED");
            addLog("ERROR", "runner", `Scenario execution failed: ${err instanceof Error ? err.message : String(err)}`);
          }
          break;
        }

        case "recover": {
          addLog("INFO", "recovery", "Initiating system recovery. Removing injected faults...");
          onSelectScenario("recovery");
          setStatus("RUNNING");
          try {
            const run = await provider.runScenario({
              scenario_id: "recovery",
              parameters: {},
              workload: 40,
            });
            setStatus("COMPLETED");
            addLog("SUCCESS", "recovery", "System successfully recovered. Baseline operational metrics restored.");
            onScenarioExecuted(run);
            onRefresh();
          } catch (err) {
            setStatus("FAILED");
            addLog("ERROR", "recovery", `Recovery failed: ${err instanceof Error ? err.message : String(err)}`);
          }
          break;
        }

        case "stop": {
          if (provider.cancelScenario) {
            await provider.cancelScenario("current");
          }
          setStatus("CANCELLED");
          addLog("WARN", "simulator", "Scenario execution stopped by user.");
          break;
        }

        case "reset": {
          if (provider.resetDemoData) {
            provider.resetDemoData(false);
          }
          setStatus("IDLE");
          addLog("INFO", "simulator", "Active simulation transient state reset to baseline.");
          onRefresh();
          break;
        }

        case "clear": {
          handleClear();
          break;
        }

        case "history": {
          addLog("INFO", "history", "SESSION COMMAND HISTORY:");
          history.forEach((h, idx) => {
            addLog("INFO", "history", `  ${idx + 1}. ${h}`);
          });
          break;
        }

        case "services": {
          const now = new Date();
          const start = new Date(now.getTime() - 3600000).toISOString();
          const svcs = await provider.getServices({ start, end: now.toISOString() });
          addLog("INFO", "services", "DISCOVERED SERVICE TOPOLOGY:");
          svcs.forEach((s: ServiceSummary) => {
            addLog(
              s.threshold_status === "breach" ? "ERROR" : "INFO",
              "services",
              `  ${s.service_name.padEnd(16)} | Status: ${s.threshold_status.toUpperCase().padEnd(7)} | Req: ${s.request_count.toString().padEnd(5)} | Err: ${formatPercent(s.error_rate).padEnd(6)} | P95: ${formatDuration(s.p95_ns)}`
            );
          });
          break;
        }

        case "service": {
          if (!args[0]) {
            addLog("ERROR", "command", "Missing service name. Usage: service <service-name>");
            return;
          }
          const svcName = args[0].toLowerCase();
          const now = new Date();
          const start = new Date(now.getTime() - 3600000).toISOString();
          const detail = await provider.getService(svcName, { start, end: now.toISOString() });
          if (!detail) {
            addLog("ERROR", "service", `Service "${svcName}" not found in current telemetry window.`);
            return;
          }
          addLog("INFO", "service", `SERVICE PROFILE: ${detail.summary.service_name.toUpperCase()}`);
          addLog("INFO", "service", `  Requests: ${detail.summary.request_count} | Errors: ${detail.summary.error_count} (${formatPercent(detail.summary.error_rate)})`);
          addLog("INFO", "service", `  P50: ${formatDuration(detail.summary.p50_ns)} | P95: ${formatDuration(detail.summary.p95_ns)} | P99: ${formatDuration(detail.summary.p99_ns)}`);
          addLog("INFO", "service", `  Incoming Dependencies: ${detail.incoming.map((d: DependencyEdge) => d.source).join(", ") || "None (Root Entry)"}`);
          addLog("INFO", "service", `  Outgoing Dependencies: ${detail.outgoing.map((d: DependencyEdge) => `${d.target} (${formatDuration(d.p95_ns)})`).join(", ") || "None (Leaf Service)"}`);
          break;
        }

        case "metrics": {
          const now = new Date();
          let minutes = 60;
          let filterService: string | undefined = undefined;

          for (let i = 0; i < args.length; i++) {
            if (args[i] === "--service" && args[i + 1]) {
              filterService = args[i + 1];
              i++;
            } else if (args[i] === "--window" && args[i + 1]) {
              const w = args[i + 1].toLowerCase();
              if (w === "5m") minutes = 5;
              else if (w === "15m") minutes = 15;
              else if (w === "1h") minutes = 60;
              else if (w === "6h") minutes = 360;
              else if (w === "24h") minutes = 1440;
              i++;
            }
          }

          const start = new Date(now.getTime() - minutes * 60000).toISOString();
          const red = await provider.getMetrics({
            start,
            end: now.toISOString(),
            service: filterService,
          });

          addLog("INFO", "metrics", `RED METRICS SNAPSHOT (${minutes}m window${filterService ? `, service: ${filterService}` : ""}):`);
          addLog("INFO", "metrics", `  Rate: ${red.request_rate_per_sec.toFixed(2)} req/s | Total Requests: ${red.request_count}`);
          addLog("INFO", "metrics", `  Errors: ${red.error_count} (${formatPercent(red.error_rate)})`);
          addLog("INFO", "metrics", `  Latency: P50 = ${formatDuration(red.p50_ns)} | P95 = ${formatDuration(red.p95_ns)} | P99 = ${formatDuration(red.p99_ns)}`);
          break;
        }

        case "traces": {
          let statusFilter: "error" | "ok" | "" = "";
          let limit = 5;
          let svcFilter: string | undefined = undefined;

          for (let i = 0; i < args.length; i++) {
            if (args[i] === "--status" && (args[i + 1] === "error" || args[i + 1] === "ok")) {
              statusFilter = args[i + 1] as "error" | "ok";
              i++;
            } else if (args[i] === "--limit" && args[i + 1]) {
              limit = Math.min(20, Math.max(1, parseInt(args[i + 1], 10) || 5));
              i++;
            } else if (args[i] === "--service" && args[i + 1]) {
              svcFilter = args[i + 1];
              i++;
            }
          }

          const now = new Date();
          const start = new Date(now.getTime() - 3600000).toISOString();
          const result = await provider.searchTraces({
            start,
            end: now.toISOString(),
            status: statusFilter,
            service: svcFilter,
            limit,
          });

          addLog("INFO", "traces", `SEARCH RESULTS (${result.items.length} of ${result.total} traces):`);
          result.items.forEach((t: TraceSummary) => {
            const statusTag = t.has_error ? "ERROR" : "OK";
            addLog(
              t.has_error ? "ERROR" : "INFO",
              "traces",
              `  [${t.trace_id.slice(0, 12)}...] ${statusTag.padEnd(5)} | ${t.root_service} -> ${t.root_operation} | ${formatDuration(t.duration_ns)} | ${t.span_count} spans`
            );
          });
          break;
        }

        case "trace": {
          if (!args[0]) {
            addLog("ERROR", "command", "Missing trace ID. Usage: trace <trace-id>");
            return;
          }
          const traceId = args[0];
          const trace = await provider.getTrace(traceId);
          if (!trace) {
            addLog("ERROR", "trace", `Trace ID "${traceId}" not found in current project.`);
            return;
          }
          addLog("INFO", "trace", `TRACE INSPECTOR: ${trace.trace_id}`);
          addLog("INFO", "trace", `  Root: ${trace.root_service} (${trace.root_operation}) | Elapsed: ${formatDuration(trace.duration_ns)}`);
          addLog("INFO", "trace", `  Status: ${trace.has_error ? "ERROR" : "OK"} | Spans: ${trace.spans.length} | Services: ${trace.services.join(", ")}`);
          trace.spans.slice(0, 6).forEach((s: Span) => {
            addLog(
              s.status_code === "error" ? "ERROR" : "DEBUG",
              "span",
              `    ${s.span_id.slice(0, 8)} | ${s.service_name.padEnd(14)} | ${s.operation_name.padEnd(26)} | ${formatDuration(s.duration_ns)}`
            );
          });
          if (trace.spans.length > 6) {
            addLog("DEBUG", "span", `    ... and ${trace.spans.length - 6} more spans (open trace detail to inspect all)`);
          }
          break;
        }

        default: {
          addLog("ERROR", "command", `Unknown command: "${command}". Type "help" to view supported commands.`);
          break;
        }
      }
    } catch (err) {
      addLog("ERROR", "system", `Execution error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      executeCommand(input);
      setInput("");
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (history.length === 0) return;
      const nextIdx = historyIndex === -1 ? history.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(nextIdx);
      setInput(history[nextIdx] || "");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndex === -1) return;
      const nextIdx = historyIndex + 1;
      if (nextIdx >= history.length) {
        setHistoryIndex(-1);
        setInput("");
      } else {
        setHistoryIndex(nextIdx);
        setInput(history[nextIdx] || "");
      }
    }
  };

  const getSeverityStyle = (severity: ConsoleLogEntry["severity"]) => {
    switch (severity) {
      case "ERROR":
        return "text-[#FF6B6B] font-semibold";
      case "WARN":
        return "text-amber-400 font-medium";
      case "SUCCESS":
        return "text-[#22C55E] font-semibold";
      case "DEBUG":
        return "text-[#38BDF8] font-normal";
      case "INFO":
      default:
        return "text-[#F472B6] font-normal";
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-[#27354A] bg-[#0B0F1A] shadow-md">
      {/* Console Top Toolbar */}
      <div className="flex flex-wrap items-center justify-between border-b border-[#27354A] bg-[#131A26] px-4 py-2 text-xs">
        <div className="flex items-center gap-2.5">
          <Terminal className="size-4 text-[#F472B6]" />
          <span className="font-mono font-bold tracking-wider text-[#F7F6F3]">KAIRO SIMULATOR CONSOLE</span>
          <span className="rounded bg-[#1A2332] px-2 py-0.5 font-mono text-[10px] text-[#A7B0BE] border border-[#27354A]">
            Kairo Demo
          </span>
          <span
            className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase ${
              status === "RUNNING"
                ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                : status === "COMPLETED"
                ? "bg-[#22C55E]/20 text-[#22C55E] border border-[#22C55E]/30"
                : status === "FAILED"
                ? "bg-[#FF6B6B]/20 text-[#FF6B6B] border border-[#FF6B6B]/30"
                : "bg-[#1A2332] text-[#A7B0BE] border border-[#27354A]"
            }`}
          >
            {status}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11px] text-[#A7B0BE] cursor-pointer hover:text-[#F7F6F3]">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="size-3 rounded border-[#27354A] bg-[#1A2332] text-[#F472B6] focus:ring-[#F472B6]"
            />
            <span>{lang === "ja" ? "自動スクロール" : "Auto-scroll"}</span>
          </label>
          <div className="h-3 w-px bg-[#27354A]" />
          <button
            type="button"
            onClick={handleClear}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] text-[#A7B0BE] hover:bg-[#1A2332] hover:text-[#F7F6F3] transition-colors"
            title="Clear console output"
          >
            <Trash2 className="size-3" />
            <span>{t.failureLab.clearConsole}</span>
          </button>
          <button
            type="button"
            onClick={handleDownload}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] text-[#A7B0BE] hover:bg-[#1A2332] hover:text-[#F7F6F3] transition-colors"
            title="Download simulator log"
          >
            <Download className="size-3" />
            <span>{t.failureLab.downloadLog}</span>
          </button>
        </div>
      </div>

      {/* Terminal Log Output Window */}
      <div
        ref={outputRef}
        className="flex-1 overflow-y-auto p-4 font-mono text-xs leading-relaxed text-[#F7F6F3] select-text min-h-[220px] max-h-[340px]"
      >
        {logs.length === 0 ? (
          <div className="py-6 text-center text-[#A7B0BE]">
            Console output is empty. Type <span className="text-[#F472B6]">help</span> or run a scenario to inspect telemetry progress.
          </div>
        ) : (
          logs.map((log) => {
            const timeStr = log.timestamp ? log.timestamp.slice(11, 23) : "00:00:00.000";
            return (
              <div key={log.id} className="flex items-start gap-2 hover:bg-[#1A2332]/50 py-0.5 px-1 rounded transition-colors">
                <span className="text-[#A7B0BE]/60 select-none">[{timeStr}]</span>
                <span className={`w-14 shrink-0 text-left ${getSeverityStyle(log.severity)}`}>
                  {log.severity}
                </span>
                <span className="w-20 shrink-0 text-[#A7B0BE] font-medium text-left">
                  {log.subsystem}
                </span>
                <span className="flex-1 whitespace-pre-wrap break-all text-[#F7F6F3]">
                  {log.message}
                </span>
              </div>
            );
          })
        )}
      </div>

      {/* Command Input Prompt */}
      <div className="flex items-center gap-2 border-t border-[#27354A] bg-[#131A26] px-4 py-2.5 font-mono text-xs">
        <span className="font-bold text-[#F472B6] select-none">kairo&gt;</span>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a command (e.g. 'status', 'scenarios', 'run slow-inventory', 'help')..."
          className="flex-1 bg-transparent text-[#F7F6F3] placeholder:text-[#A7B0BE]/50 focus:outline-hidden"
          spellCheck={false}
          autoComplete="off"
        />
        <button
          type="button"
          onClick={() => {
            executeCommand(input);
            setInput("");
            inputRef.current?.focus();
          }}
          className="inline-flex items-center gap-1 rounded bg-[#F472B6]/15 border border-[#F472B6]/30 px-2.5 py-1 text-[11px] font-semibold text-[#F472B6] hover:bg-[#F472B6]/25 transition-colors"
        >
          <span>Run</span>
          <CornerDownLeft className="size-3" />
        </button>
      </div>
    </div>
  );
}
