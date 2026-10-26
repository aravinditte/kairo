import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Language = "en" | "ja";

export interface Translations {
  nav: {
    overview: string;
    traces: string;
    services: string;
    dependencies: string;
    metrics: string;
    failureLab: string;
    alerts: string;
    settings: string;
    observability: string;
    tagline: string;
  };
  header: {
    project: string;
    projectDemo: string;
    env: string;
    envDemo: string;
    range: string;
    updated: string;
    simulatedData: string;
    liveBackend: string;
    toggleSidebar: string;
    language: string;
  };
  overview: {
    title: string;
    subtitle: string;
    runScenario: string;
    requestRate: string;
    errorRate: string;
    p95Latency: string;
    p99Latency: string;
    failedRequests: string;
    servicesAffected: string;
    requestTraffic: string;
    latencyPercentiles: string;
    serviceDependencyMap: string;
    serviceHealth: string;
    recentErrors: string;
    recentTraces: string;
    noErrors: string;
    healthy: string;
    degraded: string;
    failed: string;
    noData: string;
    insufficientData: string;
    viewAllTraces: string;
    viewAllServices: string;
    inspect: string;
    totalRequests: string;
    successRate: string;
    callVolume: string;
  };
  failureLab: {
    title: string;
    subtitle: string;
    scenarioLibrary: string;
    configuration: string;
    systemState: string;
    runScenario: string;
    running: string;
    cancelScenario: string;
    resetBaseline: string;
    tabConsole: string;
    tabFindings: string;
    tabWaterfall: string;
    difficulty: string;
    impact: string;
    duration: string;
    parameters: string;
    diagnosticConclusion: string;
    rootCause: string;
    affectedService: string;
    failureOperation: string;
    observedSymptom: string;
    metric: string;
    baseline: string;
    active: string;
    delta: string;
    clearConsole: string;
    downloadLog: string;
    scenarioStatus: string;
    activeRun: string;
    idle: string;
    completed: string;
    cancelled: string;
    requestsInjected: string;
    failuresObserved: string;
    timeElapsed: string;
  };
  traces: {
    title: string;
    subtitle: string;
    searchPlaceholder: string;
    filterStatus: string;
    filterService: string;
    filterOperation: string;
    all: string;
    errorsOnly: string;
    healthyOnly: string;
    traceId: string;
    rootOperation: string;
    duration: string;
    spans: string;
    timestamp: string;
    scenarioBadge: string;
    noTraces: string;
    minDuration: string;
  };
  services: {
    title: string;
    subtitle: string;
    simulateFault: string;
    operations: string;
    inboundCalls: string;
    outboundCalls: string;
    avgLatency: string;
    requestCount: string;
    healthStatus: string;
  };
  dependencies: {
    title: string;
    subtitle: string;
    inferredNote: string;
    topologyTitle: string;
    caller: string;
    callee: string;
  };
  metrics: {
    title: string;
    subtitle: string;
    filtersTitle: string;
    filterService: string;
    filterOperation: string;
    resolution: string;
    allServices: string;
    allOperations: string;
    throughput: string;
    errorRate: string;
    p95Latency: string;
    p99Latency: string;
    requestVolume: string;
    errorVolume: string;
    latencyTrends: string;
  };
  alerts: {
    title: string;
    subtitle: string;
    activeRules: string;
    configureThresholds: string;
    manageThresholds: string;
    recentBreaches: string;
    noBreaches: string;
    rule: string;
    service: string;
    observedValue: string;
    threshold: string;
    severity: string;
    timestamp: string;
  };
  settings: {
    title: string;
    subtitle: string;
    projectConfig: string;
    projectName: string;
    saveProject: string;
    thresholds: string;
    p95Threshold: string;
    errorRateThreshold: string;
    rateThreshold: string;
    saveThresholds: string;
    apiCredentials: string;
    apiKey: string;
    adminToken: string;
    dataRetention: string;
    savedSuccess: string;
  };
  common: {
    loading: string;
    error: string;
    save: string;
    cancel: string;
    reset: string;
    close: string;
    copy: string;
    copied: string;
    status: string;
    sec: string;
    ms: string;
    reqSec: string;
  };
}

export const translations: Record<Language, Translations> = {
  en: {
    nav: {
      overview: "Overview",
      traces: "Traces",
      services: "Services",
      dependencies: "Dependencies",
      metrics: "Metrics",
      failureLab: "Failure Lab",
      alerts: "Alerts",
      settings: "Settings",
      observability: "Observability",
      tagline: "Observe • Understand • Move Forward",
    },
    header: {
      project: "Project:",
      projectDemo: "Kairo Demo Project",
      env: "Env:",
      envDemo: "Kairo Demo",
      range: "Range:",
      updated: "Updated",
      simulatedData: "SIMULATED DATA",
      liveBackend: "LIVE BACKEND",
      toggleSidebar: "Toggle Sidebar",
      language: "Language",
    },
    overview: {
      title: "System Overview",
      subtitle: "Distributed application health and request performance",
      runScenario: "Run Demo Scenario",
      requestRate: "Request Rate",
      errorRate: "Error Rate",
      p95Latency: "P95 Latency",
      p99Latency: "P99 Latency",
      failedRequests: "Failed Requests",
      servicesAffected: "Services Affected",
      requestTraffic: "Request Traffic",
      latencyPercentiles: "Latency Percentiles",
      serviceDependencyMap: "Service Dependency Map",
      serviceHealth: "Service Health",
      recentErrors: "Recent Errors",
      recentTraces: "Recent Traces",
      noErrors: "No recent error spans recorded in this time window.",
      healthy: "Healthy",
      degraded: "Degraded",
      failed: "Failed",
      noData: "No Data",
      insufficientData: "Insufficient observations",
      viewAllTraces: "View All Traces",
      viewAllServices: "View All Services",
      inspect: "Inspect",
      totalRequests: "Total Requests",
      successRate: "Success Rate",
      callVolume: "Call Volume",
    },
    failureLab: {
      title: "Failure Lab",
      subtitle: "Interactive fault injection, resilience validation, and live root-cause diagnosis",
      scenarioLibrary: "Scenario Library",
      configuration: "Scenario Configuration",
      systemState: "Live System State",
      runScenario: "Run Scenario",
      running: "Running Scenario...",
      cancelScenario: "Cancel Scenario",
      resetBaseline: "Reset Baseline",
      tabConsole: "Simulator Console",
      tabFindings: "Before & After Findings",
      tabWaterfall: "Trace Waterfall",
      difficulty: "Difficulty",
      impact: "Expected Impact",
      duration: "Duration",
      parameters: "Parameters",
      diagnosticConclusion: "Diagnostic Conclusion",
      rootCause: "Root Cause Analysis",
      affectedService: "Affected Service",
      failureOperation: "Failed Operation",
      observedSymptom: "Observed Symptom",
      metric: "Metric",
      baseline: "Baseline",
      active: "Active Run",
      delta: "Delta",
      clearConsole: "Clear Output",
      downloadLog: "Download Log",
      scenarioStatus: "Scenario Status",
      activeRun: "Active Run",
      idle: "IDLE",
      completed: "COMPLETED",
      cancelled: "CANCELLED",
      requestsInjected: "Requests Injected",
      failuresObserved: "Failures Observed",
      timeElapsed: "Time Elapsed",
    },
    traces: {
      title: "Trace Explorer",
      subtitle: "Search, inspect, and analyze distributed request executions",
      searchPlaceholder: "Search by Trace ID...",
      filterStatus: "Status",
      filterService: "Service",
      filterOperation: "Operation",
      all: "All",
      errorsOnly: "Errors Only",
      healthyOnly: "Healthy Only",
      traceId: "Trace ID",
      rootOperation: "Root Operation",
      duration: "Duration",
      spans: "Spans",
      timestamp: "Timestamp",
      scenarioBadge: "Generated By Scenario",
      noTraces: "No traces found matching filter criteria.",
      minDuration: "Min Duration",
    },
    services: {
      title: "Services",
      subtitle: "Observed service health, operation latencies, and dependencies",
      simulateFault: "Simulate a fault in this service",
      operations: "Endpoints & Operations",
      inboundCalls: "Inbound Calls",
      outboundCalls: "Outbound Calls",
      avgLatency: "Avg Latency",
      requestCount: "Request Count",
      healthStatus: "Health Status",
    },
    dependencies: {
      title: "Service Dependencies",
      subtitle: "Inferred caller-callee topology from distributed span parent-child relationships",
      inferredNote: "Edges are inferred from observed traces only (cross-service parent-child spans).",
      topologyTitle: "Service Architecture Topology",
      caller: "Caller",
      callee: "Callee",
    },
    metrics: {
      title: "RED Metrics Analytics",
      subtitle: "Request Rate, Error Rate, and Duration percentiles computed from normalized server spans (span_kind = 2).",
      filtersTitle: "Dimension Filters & Resolution",
      filterService: "Filter Service",
      filterOperation: "Filter Operation",
      resolution: "Bucket Interval",
      allServices: "All Services",
      allOperations: "All Operations",
      throughput: "Avg Throughput",
      errorRate: "Overall Error Rate",
      p95Latency: "Current P95",
      p99Latency: "Current P99",
      requestVolume: "Request Volume & Rates",
      errorVolume: "Error Breakdown & Failure Volume",
      latencyTrends: "Latency Percentile Trends",
    },
    alerts: {
      title: "Alerts & Threshold Violations",
      subtitle: "In-product SLO monitoring and breach records. Evaluations occur automatically during telemetry ingestion and analysis.",
      activeRules: "Active Threshold Rules:",
      configureThresholds: "Configure Thresholds",
      manageThresholds: "Manage Thresholds",
      recentBreaches: "Recent Threshold Breach Events",
      noBreaches: "No threshold breaches recorded. The system is operating within defined bounds.",
      rule: "Rule",
      service: "Service",
      observedValue: "Observed Value",
      threshold: "Threshold",
      severity: "Severity",
      timestamp: "Timestamp",
    },
    settings: {
      title: "Settings & Configuration",
      subtitle: "Manage project boundaries, SLO threshold values, authentication tokens, and storage retention policies.",
      projectConfig: "Project Configuration",
      projectName: "Project Name",
      saveProject: "Save Project",
      thresholds: "Threshold & SLO Rules",
      p95Threshold: "P95 Latency Threshold (ms)",
      errorRateThreshold: "Error Rate Threshold (%)",
      rateThreshold: "Request Rate Lower Bound (req/s)",
      saveThresholds: "Save Thresholds",
      apiCredentials: "API Credentials & Ingestion Keys",
      apiKey: "Project API Key (x-api-key)",
      adminToken: "Admin Token (Authorization: Bearer)",
      dataRetention: "Data Retention & Storage",
      savedSuccess: "Settings updated successfully.",
    },
    common: {
      loading: "Loading telemetry...",
      error: "Error loading telemetry",
      save: "Save",
      cancel: "Cancel",
      reset: "Reset",
      close: "Close",
      copy: "Copy",
      copied: "Copied!",
      status: "Status",
      sec: "s",
      ms: "ms",
      reqSec: "req/s",
    },
  },
  ja: {
    nav: {
      overview: "概要",
      traces: "トレース",
      services: "サービス",
      dependencies: "依存関係",
      metrics: "メトリクス",
      failureLab: "障害ラボ",
      alerts: "アラート",
      settings: "設定",
      observability: "可観測性",
      tagline: "観測 • 理解 • 前進",
    },
    header: {
      project: "プロジェクト:",
      projectDemo: "Kairo デモプロジェクト",
      env: "環境:",
      envDemo: "Kairo デモ",
      range: "期間:",
      updated: "更新",
      simulatedData: "シミュレーションデータ",
      liveBackend: "ライブバックエンド",
      toggleSidebar: "サイドバー切替",
      language: "言語",
    },
    overview: {
      title: "システム概要",
      subtitle: "分散アプリケーションの健全性とリクエストパフォーマンス",
      runScenario: "デモシナリオ実行",
      requestRate: "リクエストレート",
      errorRate: "エラー率",
      p95Latency: "P95 レイテンシ",
      p99Latency: "P99 レイテンシ",
      failedRequests: "失敗リクエスト",
      servicesAffected: "影響サービス",
      requestTraffic: "リクエストトラフィック",
      latencyPercentiles: "レイテンシパーセンタイル",
      serviceDependencyMap: "サービス依存関係マップ",
      serviceHealth: "サービス健全性",
      recentErrors: "最近のエラー",
      recentTraces: "最近のトレース",
      noErrors: "この期間内に記録されたエラースパンはありません。",
      healthy: "健全",
      degraded: "低下",
      failed: "障害",
      noData: "データなし",
      insufficientData: "観測データ不足",
      viewAllTraces: "すべてのトレースを表示",
      viewAllServices: "すべてのサービスを表示",
      inspect: "詳細表示",
      totalRequests: "総リクエスト数",
      successRate: "成功率",
      callVolume: "呼出総数",
    },
    failureLab: {
      title: "障害ラボ (Failure Lab)",
      subtitle: "対話型の障害注入・耐障害性検証・リアルタイム根本原因分析",
      scenarioLibrary: "シナリオ一覧",
      configuration: "パラメータ設定",
      systemState: "リアルタイムシステム状態",
      runScenario: "シナリオを実行",
      running: "シナリオ実行中...",
      cancelScenario: "実行を中断",
      resetBaseline: "ベースラインにリセット",
      tabConsole: "シミュレータコンソール",
      tabFindings: "障害影響分析（前後比較）",
      tabWaterfall: "トレースウォーターフォール",
      difficulty: "難易度",
      impact: "想定される影響",
      duration: "所要時間",
      parameters: "パラメータ",
      diagnosticConclusion: "診断結果の総括",
      rootCause: "根本原因分析 (RCA)",
      affectedService: "影響を受けたサービス",
      failureOperation: "障害発生操作",
      observedSymptom: "観測された症状",
      metric: "指標",
      baseline: "ベースライン",
      active: "障害実行中",
      delta: "変化幅",
      clearConsole: "出力クリア",
      downloadLog: "ログ保存",
      scenarioStatus: "シナリオステータス",
      activeRun: "実行中のシナリオ",
      idle: "待機中 (IDLE)",
      completed: "完了 (COMPLETED)",
      cancelled: "中断 (CANCELLED)",
      requestsInjected: "注入リクエスト数",
      failuresObserved: "観測エラー数",
      timeElapsed: "経過時間",
    },
    traces: {
      title: "トレースエクスプローラ",
      subtitle: "分散リクエスト実行の検索、詳細検査、およびフロー分析",
      searchPlaceholder: "トレースIDで検索...",
      filterStatus: "ステータス",
      filterService: "サービス",
      filterOperation: "操作",
      all: "すべて",
      errorsOnly: "エラーのみ",
      healthyOnly: "正常のみ",
      traceId: "トレースID",
      rootOperation: "ルート操作",
      duration: "所要時間",
      spans: "スパン数",
      timestamp: "タイムスタンプ",
      scenarioBadge: "シナリオにより生成",
      noTraces: "条件に一致するトレースは見つかりませんでした。",
      minDuration: "最小所要時間",
    },
    services: {
      title: "サービス一覧",
      subtitle: "観測されたサービスの健全性、操作レイテンシ、依存関係",
      simulateFault: "このサービスに障害を注入",
      operations: "エンドポイント・操作",
      inboundCalls: "受信呼出 (Inbound)",
      outboundCalls: "送信呼出 (Outbound)",
      avgLatency: "平均レイテンシ",
      requestCount: "リクエスト数",
      healthStatus: "健全性ステータス",
    },
    dependencies: {
      title: "サービス依存関係マップ",
      subtitle: "分散スパンの親子関係から推測された呼び出しトポロジー",
      inferredNote: "エッジは観測されたトレース（サービス間の親子スパン）から推測されたものです。",
      topologyTitle: "サービスアーキテクチャ・トポロジー",
      caller: "呼出元 (Caller)",
      callee: "呼出先 (Callee)",
    },
    metrics: {
      title: "REDメトリクス分析",
      subtitle: "正規化されたサーバースパン (span_kind = 2) から算出されたリクエストレート、エラー率、レイテンシ推移",
      filtersTitle: "ディメンションフィルタと集計解像度",
      filterService: "サービスで絞り込み",
      filterOperation: "操作で絞り込み",
      resolution: "集計バケット間隔",
      allServices: "すべてのサービス",
      allOperations: "すべての操作",
      throughput: "平均スループット",
      errorRate: "全体エラー率",
      p95Latency: "現在のP95",
      p99Latency: "現在のP99",
      requestVolume: "リクエスト総量と流量",
      errorVolume: "エラー内訳と失敗量",
      latencyTrends: "レイテンシパーセンタイルの推移",
    },
    alerts: {
      title: "アラートと閾値違反",
      subtitle: "SLO監視および閾値違反の履歴。テレメトリ収集と分析時に自動的に評価されます。",
      activeRules: "有効な閾値ルール:",
      configureThresholds: "閾値を設定",
      manageThresholds: "閾値の管理へ",
      recentBreaches: "最近の閾値違反イベント",
      noBreaches: "記録された閾値違反はありません。システムは規定の範囲内で健全に稼働しています。",
      rule: "ルール",
      service: "サービス",
      observedValue: "実測値",
      threshold: "閾値",
      severity: "重大度",
      timestamp: "発生日時",
    },
    settings: {
      title: "設定と構成",
      subtitle: "プロジェクト構成、SLO閾値、認証トークン、およびデータ保持ポリシーを管理します。",
      projectConfig: "プロジェクト設定",
      projectName: "プロジェクト名",
      saveProject: "プロジェクトを保存",
      thresholds: "閾値・SLOルール",
      p95Threshold: "P95レイテンシ閾値 (ms)",
      errorRateThreshold: "エラー率閾値 (%)",
      rateThreshold: "リクエストレート下限値 (req/s)",
      saveThresholds: "閾値を保存",
      apiCredentials: "API認証情報と取り込みキー",
      apiKey: "プロジェクトAPIキー (x-api-key)",
      adminToken: "管理者トークン (Authorization: Bearer)",
      dataRetention: "データ保持とストレージ",
      savedSuccess: "設定が正常に保存されました。",
    },
    common: {
      loading: "テレメトリを読み込み中...",
      error: "テレメトリの取得に失敗しました",
      save: "保存",
      cancel: "キャンセル",
      reset: "リセット",
      close: "閉じる",
      copy: "コピー",
      copied: "コピー完了!",
      status: "ステータス",
      sec: "秒",
      ms: "ミリ秒",
      reqSec: "回/秒",
    },
  },
};

interface I18nContextValue {
  lang: Language;
  setLang: (lang: Language) => void;
  t: Translations;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(() => {
    const saved = localStorage.getItem("kairo_lang") as Language;
    if (saved === "en" || saved === "ja") return saved;
    return "en";
  });

  const setLang = (nextLang: Language) => {
    localStorage.setItem("kairo_lang", nextLang);
    setLangState(nextLang);
  };

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const value: I18nContextValue = {
    lang,
    setLang,
    t: translations[lang],
  };

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within an I18nProvider");
  }
  return context;
}
