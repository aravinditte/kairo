import { hashSeed, mulberry32 } from "../../lib/rng";
import type { ScenarioDefinition, Span } from "../../types";
import { buildTrace } from "./traceFactory";

export const SCENARIO_DEFINITIONS: ScenarioDefinition[] = [
  {
    id: "healthy-baseline",
    name: "Healthy Baseline",
    description: "Generates clean, successful traffic across all four services (Checkout, Inventory, Payment, Notifications) to establish an operational baseline.",
    difficulty: "Beginner",
    expected_impact: "0% error rate, low latency (P95 < 80ms) across all services.",
    estimated_duration: "~2s",
    parameters: [
      { key: "workload", label: "Request volume", min: 10, max: 150, default: 50, unit: "req" },
    ],
  },
  {
    id: "slow-inventory",
    name: "Slow Inventory",
    description: "Injects a configurable delay into Inventory responses. Checkout requests take longer, the delayed Inventory span is visible in the waterfall, and latency analytics reflect the affected service.",
    difficulty: "Intermediate",
    expected_impact: "Inventory and Checkout P95 latency spikes by injected delay; 0% error rate.",
    estimated_duration: "~3s",
    parameters: [
      { key: "delay_ms", label: "Added inventory delay", min: 200, max: 5000, default: 1500, unit: "ms" },
      { key: "workload", label: "Request volume", min: 10, max: 100, default: 40, unit: "req" },
    ],
  },
  {
    id: "payment-errors",
    name: "Payment Errors",
    description: "Returns controlled HTTP 5xx responses from Payment for a configurable proportion of requests. Failed spans carry error status, are findable in trace search, and raise system error rate.",
    difficulty: "Intermediate",
    expected_impact: "Payment and Checkout error rate increases; exceptions recorded on spans.",
    estimated_duration: "~2s",
    parameters: [
      { key: "error_rate", label: "Payment error probability", min: 5, max: 100, default: 25, unit: "%" },
      { key: "workload", label: "Request volume", min: 10, max: 100, default: 50, unit: "req" },
    ],
  },
  {
    id: "notification-timeout",
    name: "Notification Timeout",
    description: "Delays the Notification path beyond the checkout client timeout (800 ms). Notification failure is non-fatal for checkout, demonstrating graceful degradation.",
    difficulty: "Advanced",
    expected_impact: "Notification calls time out; Checkout finishes successfully (HTTP 200).",
    estimated_duration: "~3s",
    parameters: [
      { key: "timeout_ms", label: "Notification delay", min: 900, max: 5000, default: 2000, unit: "ms" },
      { key: "workload", label: "Request volume", min: 10, max: 100, default: 40, unit: "req" },
    ],
  },
  {
    id: "traffic-spike",
    name: "Traffic Spike",
    description: "Simulates sudden 5x traffic surge, triggering concurrency contention and elevated queue latency across all downstream microservices.",
    difficulty: "Advanced",
    expected_impact: "Throughput spikes; P95 and P99 latency stretches by 2-4x.",
    estimated_duration: "~4s",
    parameters: [
      { key: "multiplier", label: "Traffic surge multiplier", min: 2, max: 10, default: 5, unit: "x" },
      { key: "workload", label: "Request volume", min: 20, max: 150, default: 80, unit: "req" },
    ],
  },
  {
    id: "cascading-failure",
    name: "Cascading Failure",
    description: "Simulates an inventory stock depletion failure that propagates upstream, exhausting checkout thread pools and aborting payment processing.",
    difficulty: "Expert",
    expected_impact: "High error rates (>60%) across Checkout, Inventory, and Payment; SLO breach.",
    estimated_duration: "~4s",
    parameters: [
      { key: "severity", label: "Failure severity", min: 20, max: 100, default: 75, unit: "%" },
      { key: "workload", label: "Request volume", min: 10, max: 100, default: 50, unit: "req" },
    ],
  },
  {
    id: "recovery",
    name: "Recovery",
    description: "Disables all active faults and generates healthy baseline requests. Confirms that new telemetry returns to green status while preserving historical investigation data.",
    difficulty: "Beginner",
    expected_impact: "Metrics immediately normalize to 0% error rate and baseline latency.",
    estimated_duration: "~2s",
    parameters: [
      { key: "workload", label: "Request volume", min: 10, max: 100, default: 50, unit: "req" },
    ],
  },
  {
    id: "telemetry-issue",
    name: "Telemetry Ingestion Issue",
    description: "Simulates distributed network partitions producing duplicate telemetry batches and unobserved parent spans, demonstrating partial/incomplete trace handling.",
    difficulty: "Intermediate",
    expected_impact: "Incomplete trace warnings surfaced in UI; duplicate span deduplication recorded.",
    estimated_duration: "~2s",
    parameters: [
      { key: "duplicate_rate", label: "Duplicate span probability", min: 10, max: 80, default: 40, unit: "%" },
      { key: "workload", label: "Request volume", min: 10, max: 80, default: 30, unit: "req" },
    ],
  },
];

export function getLocalizedScenario(def: ScenarioDefinition, lang: "en" | "ja"): ScenarioDefinition {
  if (lang !== "ja") return def;
  const jaMap: Record<string, { name: string; description: string; expected_impact: string; difficulty?: string }> = {
    "healthy-baseline": {
      name: "健全ベースライン (Healthy Baseline)",
      description: "Checkout、Inventory、Payment、Notificationsの4サービス全体に正常なトラフィックを生成し、運用ベースラインを確立します。",
      expected_impact: "エラー率0%、全サービスで低レイテンシ (P95 < 80ms)。",
      difficulty: "初級 (Beginner)",
    },
    "slow-inventory": {
      name: "在庫サービス遅延 (Slow Inventory)",
      description: "在庫サービス (Inventory) の応答に設定可能な遅延を注入します。チェックアウトリクエストの所要時間が増加し、ウォーターフォール上に遅延スパンが明示されます。",
      expected_impact: "InventoryおよびCheckoutのP95レイテンシが設定遅延分増加。エラー率は0%。",
      difficulty: "中級 (Intermediate)",
    },
    "payment-errors": {
      name: "決済サービスエラー (Payment Errors)",
      description: "決済サービス (Payment) から一定割合でHTTP 5xxエラーを意図的に返却します。失敗したスパンはエラーステータスを保持し、システム全体のエラー率が上昇します。",
      expected_impact: "PaymentとCheckoutのエラー率が上昇。スパン上に例外イベントが記録されます。",
      difficulty: "中級 (Intermediate)",
    },
    "notification-timeout": {
      name: "通知タイムアウト (Notification Timeout)",
      description: "通知サービス (Notification) の処理をクライアントタイムアウト(800ms)以上に遅延させます。通知の失敗はチェックアウト完了を阻害せず、グレースフル・デグラデーションを実証します。",
      expected_impact: "通知呼出がタイムアウト。Checkout自体は成功(HTTP 200)として完了。",
      difficulty: "上級 (Advanced)",
    },
    "traffic-spike": {
      name: "トラフィックサージ (Traffic Surge)",
      description: "Checkoutおよび下流サービス全体に急激なトラフィックスパイクを注入し、キューイング遅延やP99レイテンシのドリフトを分析します。",
      expected_impact: "全サービスでP95/P99レイテンシが上昇。リクエストスループットが急増。",
      difficulty: "中級 (Intermediate)",
    },
    "cascading-failure": {
      name: "連鎖障害 (Cascading Failure)",
      description: "在庫枯渇による障害が上流へ波及し、チェックアウトのスレッドプールを枯渇させ決済処理を中断させる連鎖障害をシミュレートします。",
      expected_impact: "Checkout、Inventory、Payment全体で高いエラー率(>60%)が発生しSLO違反。",
      difficulty: "エキスパート (Expert)",
    },
    "recovery": {
      name: "正常復旧 (Recovery)",
      description: "注入されているすべての障害を解除し、正常なベースラインリクエストを生成します。過去の調査データを保持したまま、新しいテレメトリが正常状態に戻ることを確認します。",
      expected_impact: "メトリクスが直ちにエラー率0%、通常レイテンシに復帰。",
      difficulty: "初級 (Beginner)",
    },
    "telemetry-issue": {
      name: "テレメトリ欠損・重複 (Telemetry Ingestion Issue)",
      description: "ネットワーク分断によりテレメトリの重複バッチや親スパン未観測が発生する状況をシミュレートし、不完全なトレースのハンドリングを実証します。",
      expected_impact: "UI上に不完全トレース警告が表示され、重複スパンの除外が記録されます。",
      difficulty: "中級 (Intermediate)",
    },
  };
  const localized = jaMap[def.id];
  if (!localized) return def;
  return {
    ...def,
    name: localized.name,
    description: localized.description,
    expected_impact: localized.expected_impact,
  };
}

export function defaultParams(def: ScenarioDefinition): Record<string, number> {
  return Object.fromEntries(def.parameters.map((p) => [p.key, p.default]));
}

/** Deterministic: same (seed, scenario, params, workload, runCounter, baseMs) -> identical trace and span ids. */
export function generateScenarioTraces(args: {
  seed: number;
  scenarioId: string;
  parameters: Record<string, number>;
  workload: number;
  runCounter: number;
  baseMs: number;
  projectId: string;
}): Span[] {
  const key = `${args.seed}:${args.scenarioId}:${JSON.stringify(args.parameters)}:${args.workload}:${args.runCounter}`;
  const rng = mulberry32(hashSeed(key));
  const spans: Span[] = [];
  const workload = Math.max(1, Math.min(200, args.workload || args.parameters.workload || 40));

  for (let i = 0; i < workload; i++) {
    const r = rng();
    let opts: Parameters<typeof buildTrace>[1] = {
      projectId: args.projectId,
      startMs: args.baseMs + i * 2000,
      scenarioId: args.scenarioId,
    };

    if (args.scenarioId === "slow-inventory") {
      opts = { ...opts, inventoryDelayMs: args.parameters.delay_ms ?? 1500 };
    } else if (args.scenarioId === "payment-errors") {
      const errRate = (args.parameters.error_rate ?? 25) / 100;
      opts = { ...opts, paymentError: r < errRate };
    } else if (args.scenarioId === "notification-timeout") {
      const timeoutMs = args.parameters.timeout_ms ?? 2000;
      opts = {
        ...opts,
        notificationTimeout: timeoutMs > 800,
        notificationDelayMs: timeoutMs,
      };
    } else if (args.scenarioId === "traffic-spike") {
      const mult = args.parameters.multiplier ?? 5;
      opts = { ...opts, trafficSpikeMultiplier: mult };
    } else if (args.scenarioId === "cascading-failure") {
      const sev = (args.parameters.severity ?? 75) / 100;
      opts = { ...opts, cascadingFailure: r < sev };
    } else if (args.scenarioId === "telemetry-issue") {
      const dupRate = (args.parameters.duplicate_rate ?? 40) / 100;
      const isIncomplete = r < dupRate;
      opts = { ...opts, incompleteTrace: isIncomplete };
    } else if (args.scenarioId === "healthy-baseline" || args.scenarioId === "recovery") {
      // Clean baseline parameters
      opts = { ...opts };
    }

    const batch = buildTrace(rng, opts);
    spans.push(...batch);

    // If telemetry-issue scenario, simulate duplicate spans
    if (args.scenarioId === "telemetry-issue" && r < 0.3 && batch.length > 0) {
      // push duplicate of first two spans
      spans.push(batch[0]);
      if (batch[1]) spans.push(batch[1]);
    }
  }
  return spans;
}
