# KAIRO (回路)

<div align="center">
  <img src="web/public/kairo-app-icon.png" width="112" height="112" alt="Kairo App Icon" />
  <h3>Distributed Observability & Failure Investigation Platform</h3>
  <p><strong>See every path. Find every fault.</strong><br />
  <em>すべての経路を見通し、すべての障害を捉える。</em></p>
  <p>
    <a href="#-english"><strong>English</strong></a> &bull;
    <a href="#-japanese-日本語"><strong>日本語</strong></a> &bull;
    <a href="README.ja.md">Dedicated Japanese README (日本語個別ファイル)</a>
  </p>
  <p>
    <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT License" />
    <img src="https://img.shields.io/badge/Go-1.23+-00ADD8.svg?logo=go&logoColor=white" alt="Go 1.23+" />
    <img src="https://img.shields.io/badge/OpenTelemetry-Native-F54A00.svg?logo=opentelemetry&logoColor=white" alt="OpenTelemetry Native" />
    <img src="https://img.shields.io/badge/React-18-61DAFB.svg?logo=react&logoColor=black" alt="React 18" />
    <img src="https://img.shields.io/badge/TypeScript-5.5-3178C6.svg?logo=typescript&logoColor=white" alt="TypeScript 5.5" />
    <img src="https://img.shields.io/badge/Budget-$0%20%2F%20₹0-success.svg" alt="Zero Cost" />
  </p>
</div>

---

## Navigation / 目次

- [English](#-english)
  - [1. Overview](#1-overview)
  - [2. Engineering Principles](#2-engineering-principles)
  - [3. Architecture](#3-architecture)
  - [4. Key Capabilities](#4-key-capabilities)
  - [5. Failure Lab Scenarios](#5-failure-lab-scenarios)
  - [6. Quick Start Guide](#6-quick-start-guide)
  - [7. Configuration Reference](#7-configuration-reference)
  - [8. Verification & Test Suite](#8-verification--test-suite)
- [日本語 (Japanese)](#-japanese-日本語)
  - [1. プロジェクト概要](#1-プロジェクト概要)
  - [2. 設計思想と基本原則](#2-設計思想と基本原則)
  - [3. システムアーキテクチャ](#3-システムアーキテクチャ)
  - [4. 主要機能](#4-主要機能)
  - [5. 障害ラボの検証シナリオ](#5-障害ラボの検証シナリオ)
  - [6. クイックスタートガイド](#6-クイックスタートガイド)
  - [7. 設定と環境変数](#7-設定と環境変数)
  - [8. テストおよび検証方法](#8-テストおよび検証方法)

---

# [English]

## 1. Overview

**Kairo (回路)** is an open-source, OpenTelemetry-native distributed observability and failure investigation platform. It provides end-to-end request tracing, automated service dependency topology mapping, RED metric analytics (Rate, Error, Duration), and an interactive **Failure Lab** designed to inject, observe, and diagnose microservice failures.

Unlike traditional monitoring tools that merely render detached metrics charts, Kairo connects observed symptoms directly to the responsible trace, service, operation, and span.

### Core Questions Kairo Answers
- Which microservices participate in a distributed request execution?
- Exactly where and why did a request fail?
- What is the critical path and which operation consumes the most latency?
- How do downstream failures (e.g. database locks or third-party outages) cascade upstream?
- Can a suspected production failure be safely reproduced, inspected, and verified under identical workloads?

---

## 2. Engineering Principles

1. **Open Standards First:** Native OTLP/HTTP ingestion supporting W3C TraceContext propagation. No proprietary vendor agents or lock-in schemas.
2. **Backend-First Rigor:** Robust Go engine with PostgreSQL durable storage, transactional idempotency for duplicate spans, row-level tenant isolation, and bounded query memory.
3. **Explainable Diagnostics:** Evidence-backed analysis linking symptom metrics to raw span waterfalls and error attributes. No opaque black-box conclusions.
4. **Reproducible Failure Lab:** Predictable, repeatable failure injection scenarios with parameterized workloads and real-time streaming output.
5. **Honest Demonstration Mode:** Clear visual differentiation between `LIVE BACKEND` telemetry and deterministic `SIMULATED DATA`.
6. **Zero Paid Dependencies:** Fully functional deployment requiring zero paid APIs, cloud subscriptions, or commercial licenses ($0 / ₹0 budget).

---

## 3. Architecture

```mermaid
flowchart TD
    subgraph LayerA["Layer A — Instrumented Applications"]
        Checkout["Checkout Service (:8081)"]
        Inventory["Inventory Service (:8082)"]
        Payment["Payment Service (:8083)"]
        Notification["Notification Service (:8084)"]
        Checkout -->|HTTP / OTLP Context| Inventory
        Checkout -->|HTTP / OTLP Context| Payment
        Checkout -->|HTTP / OTLP Context| Notification
    end

    subgraph LayerB["Layer B — Ingestion & Engine (Go)"]
        OTLPEndpoint["OTLP/HTTP Handler (POST /v1/traces)"]
        Normalizer["Span Normalizer & Deduplicator"]
        Runner["Failure Lab Scenario Runner"]
        OTLPEndpoint --> Normalizer
    end

    subgraph LayerC["Layer C — Storage Layer"]
        PG[("PostgreSQL 16 (Durable Store)")]
        Mem[("In-Memory Store (Demo Fallback)")]
    end

    subgraph LayerD["Layer D — Query & Analytics API"]
        QueryAPI["Kairo API (:8080)"]
        REDCalc["RED Engine (P50/P95/P99)"]
        Alerts["SLO Threshold Evaluator"]
    end

    subgraph LayerE["Layer E — Web Presentation (React + TypeScript)"]
        UI["Kairo Dashboard (:5173 / :8080)"]
        Waterfall["Trace Waterfall Visualizer"]
        Topology["Service Dependency Map"]
        Console["Simulator Terminal Console"]
    end

    Checkout -->|OTLP/HTTP Protobuf/JSON| OTLPEndpoint
    Inventory -->|OTLP/HTTP Protobuf/JSON| OTLPEndpoint
    Payment -->|OTLP/HTTP Protobuf/JSON| OTLPEndpoint
    Notification -->|OTLP/HTTP Protobuf/JSON| OTLPEndpoint

    Normalizer --> PG
    Normalizer --> Mem
    Runner --> Checkout

    PG --> QueryAPI
    Mem --> QueryAPI
    QueryAPI --> REDCalc
    QueryAPI --> Alerts

    QueryAPI --> UI
    UI --> Waterfall
    UI --> Topology
    UI --> Console
```

---

## 4. Key Capabilities

### A. Distributed Trace Waterfall Visualizer
- Millisecond-precise timeline alignment of root and child spans across microservices.
- Critical path highlighting, span status (OK, Error, Unset), and nested parent-child hierarchy.
- Detailed span drawer displaying duration, HTTP status codes, error events, stack traces, and OpenTelemetry attributes.
- Detection of incomplete traces and missing parent spans.

### B. Dynamic Service Dependency Graph
- Caller-to-callee topology derived directly from observed distributed traces.
- Edge inspection revealing call volumes, error rates, and average latencies.
- Health badges reflecting active SLO violations.

### C. RED Metrics Analytics
- Standard RED metrics (Request Rate, Error Rate, Duration percentiles: P50, P95, P99).
- Metrics calculated exclusively from normalized server spans (`span_kind = 2`).
- Flexible resolution bucket intervals (1m, 5m, 15m, 1h).
- Identification of slowest operations and service-level error distributions.

### D. Interactive Failure Lab
- Parameterized fault injection engine with instant execution and reset controls.
- Integrated streaming terminal console with ANSI syntax highlighting, autoscroll, and log export.
- Side-by-side **Before & After** differential analysis of throughput, latency, and error rates.
- Root Cause Analysis (RCA) diagnostic conclusions derived from trace evidence.

### E. In-Product SLO Thresholds & Alerts
- Configurable project-level thresholds for P95 latency and error rate percentages.
- Automatic sliding-window evaluations during telemetry processing.
- Direct drill-down links from alert breaches to offending traces.

### F. Bilingual Localization (ENG / 日本語)
- Dynamic one-click toggle pill `[ ENG | 日本語 ]` in the top navigation bar.
- Comprehensive Japanese translation across all views, controls, metrics, and scenario descriptions.
- Zero layout shifting with browser `localStorage` persistence.

---

## 5. Failure Lab Scenarios

| Scenario ID | Name | Injected Fault | Expected Observability Impact | Difficulty |
| :--- | :--- | :--- | :--- | :--- |
| `healthy-baseline` | **Healthy Baseline** | None (nominal traffic) | 0% error rate, low latency (P95 < 80ms) across all services. | Beginner |
| `slow-inventory` | **Slow Inventory** | Configurable delay (200ms–5000ms) on Inventory | Inventory & Checkout P95 latency spikes; 0% error rate. | Intermediate |
| `payment-errors` | **Payment Errors** | HTTP 5xx responses (5%–100% probability) | Payment and Checkout error rate surges; error events on spans. | Intermediate |
| `notification-timeout` | **Notification Timeout** | Delay (>800ms) exceeding client timeout | Notification times out; Checkout gracefully completes (HTTP 200). | Advanced |
| `traffic-spike` | **Traffic Surge** | 2x–10x sudden request surge | Queue contention; P95/P99 latency stretches by 2x–4x. | Advanced |
| `cascading-failure` | **Cascading Failure** | Upstream stock failure exhaustion | High error rates (>60%) across Checkout, Inventory, and Payment. | Expert |
| `recovery` | **System Recovery** | Clears all faults, emits healthy traffic | Metrics immediately return to green status; preserves history. | Beginner |
| `telemetry-issue` | **Telemetry Ingestion Issue** | Network partition & duplicate batches | Surfaces unobserved parent warnings; verifies deduplication. | Intermediate |

---

## 6. Quick Start Guide

### Prerequisites
- **For Docker:** Docker Engine 24+ & Docker Compose v2.
- **For Native Local:** Go 1.23+, Node.js 20+, and npm 10+.

### Option A — Automated One-Click Local Stack (Recommended)

Run all services (API, 4 demo services, and frontend) simultaneously:

**Windows (PowerShell):**
```powershell
powershell -ExecutionPolicy Bypass -File ./scripts/run-local.ps1
```

**Linux / macOS:**
```bash
chmod +x ./scripts/run-local.sh
./scripts/run-local.sh
```

**Access Points:**
- Frontend Web UI (Dev Server): `http://localhost:5173`
- Kairo API & Production SPA: `http://localhost:8080` (Health: `http://localhost:8080/healthz`)
- Microservices: Checkout (`:8081`), Inventory (`:8082`), Payment (`:8083`), Notifications (`:8084`)

---

### Option B — Docker Compose (Full Stack with PostgreSQL)

```bash
# Start all containers in the background
docker compose up --build -d

# Check service logs
docker compose logs -f kairo-api

# Teardown
docker compose down

# Teardown and delete persistent PostgreSQL volume
docker compose down -v
```

---

### Option C — Standalone In-Memory Mode (No Docker / No Database)

In-memory storage allows instant local exploration without PostgreSQL:

```bash
# Terminal 1: In-memory Kairo API
KAIRO_DEMO_MODE=true KAIRO_SEED_DEMO=true go run ./cmd/kairo-api

# Terminals 2-5: Microservices
KAIRO_API_KEY=kairo-dev-key PORT=8082 go run ./services/inventory
KAIRO_API_KEY=kairo-dev-key PORT=8083 go run ./services/payment
KAIRO_API_KEY=kairo-dev-key PORT=8084 go run ./services/notifications
KAIRO_API_KEY=kairo-dev-key PORT=8081 go run ./services/checkout

# Terminal 6: Web Dashboard
cd web
npm install
VITE_DATA_MODE=api VITE_API_BASE_URL=http://localhost:8080 npm run dev
```

---

### Option D — Frontend-Only Demo Mode (Zero Backend Required)

Runs entirely inside the browser using deterministic client-side telemetry generators:

```bash
cd web
npm install
npm run dev
```

Navigate to `http://localhost:5173`. The system explicitly marks all telemetry with a `SIMULATED DATA` badge.

---

## 7. Configuration Reference

### Backend (`kairo-api`)
| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `KAIRO_ENV` | `development` | Deployment environment (`development` or `production`). |
| `KAIRO_HTTP_ADDR` | `:8080` | Bind address and port for the API server. |
| `KAIRO_DATABASE_URL` | *(empty)* | PostgreSQL connection URI. If omitted, falls back to in-memory store. |
| `KAIRO_ADMIN_TOKEN` | `kairo-dev-admin` | Bearer token for tenant/project administration. |
| `KAIRO_DEMO_MODE` | `false` | Enables scenario trigger endpoints on demo microservices. |
| `KAIRO_SEED_DEMO` | `false` | Automatically provisions the default demo project and API key. |
| `KAIRO_MAX_OTLP_BODY_BYTES` | `4194304` (4MB) | Maximum allowed payload size for OTLP ingestion. |
| `KAIRO_MAX_SPANS_PER_BATCH` | `1000` | Maximum span count processed in a single batch. |
| `KAIRO_QUERY_TIMEOUT` | `10s` | Maximum database query execution duration. |
| `KAIRO_DEFAULT_RETENTION_DAYS` | `7` | Default trace data retention period. |

### Frontend (`web/`)
| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `VITE_DATA_MODE` | `demo` | Data provider mode (`demo` for browser simulation, `api` for live backend). |
| `VITE_API_BASE_URL` | `http://localhost:8080` | Root URL for the Kairo API backend. |
| `VITE_DEMO_SCENARIO_SEED` | `42` | Seed integer for reproducible synthetic trace generation. |

---

## 8. Verification & Test Suite

Kairo adheres to strict test verification across both backend and frontend:

```bash
# 1. Backend Unit & HTTP Tests
go test -v -race ./...

# 2. Database Integration Tests (Requires PostgreSQL)
KAIRO_TEST_DATABASE_URL="postgres://kairo:kairo@localhost:5432/kairo?sslmode=disable" go test -v ./tests/integration/

# 3. Frontend Typecheck, Unit Tests & Production Build
npm --prefix web run typecheck
npm --prefix web test
npm --prefix web run build

# 4. Ingestion Load Benchmark Harness
go run ./tests/load -addr http://localhost:8080 -api-key kairo-dev-key -spans 50000 -workers 8
```

> [!NOTE]
> All benchmark results and hardware specs are documented in [`docs/benchmarks.md`](docs/benchmarks.md). No arbitrary numbers are published without reproducible measurements.

---

# [日本語 (Japanese)]

## 1. プロジェクト概要

**Kairo (回路)** は、OpenTelemetryにネイティブ対応したオープンソースの分散可観測性（Distributed Observability）および障害調査プラットフォームです。

マイクロサービス環境におけるリクエストの分散トレース収集、サービス依存関係トポロジーマップの自動生成、REDメトリクス（リクエストレート、エラー率、レイテンシ）の集計・可視化、そして障害を意図的に注入して影響を追跡・調査できる**障害ラボ (Failure Lab)** を提供します。

従来の監視ツールのように集計されたグラフを単に眺めるだけでなく、観測されたパフォーマンス低下やエラーという「症状」を、根本原因となるトレース、サービス、操作、および個別のスパンへと直接結びつけて調査できます。

### Kairoが解決する問い
- 1つのリクエストにどのマイクロサービスが参加し、どのような順序で呼び出されているか？
- リクエストは具体的にどのサービス、どの処理で失敗したのか？
- クリティカルパス（最長遅延経路）はどこにあり、どの処理が時間を消費しているか？
- データベースのロックや外部APIの遅延が、上流サービスへどのように連鎖波及するか？
- 本番で発生した複雑な障害を、同一のワークロード条件下で安全かつ確実に再現・検証できるか？

---

## 2. 設計思想と基本原則

1. **オープンスタンダードの徹底:** 独自エージェントや囲い込み仕様を排除し、業界標準のOTLP/HTTPおよびW3C TraceContextコンテキスト伝播をネイティブ採用。
2. **バックエンド最優先のエンジニアリング:** Go言語による堅牢な実装とPostgreSQLによる耐久ストレージ。重複スパンに対するべき等な取り込み処理、プロジェクト単位の行レベルテナント分離、メモリ制限付きクエリ。
3. **説明可能な障害診断:** 不透明なAIによる推測に頼らず、生のトレースウォーターフォールやスパン属性・例外イベントを根拠とする再現性の高い診断。
4. **再現可能な障害ラボ (Failure Lab):** パラメータ調整が可能な障害注入シナリオを提供し、何度でも同一条件で挙動を検証可能。
5. **誠実なデモモード (Honest Demo):** 本物のバックエンドデータ (`LIVE BACKEND`) とブラウザ上の決定論的シミュレーションデータ (`SIMULATED DATA`) をUI上で明確に識別。
6. **ゼロコスト運用の実現:** 高価なクラウドサービスや有料APIを一切必要とせず、完全無料でローカルおよび公開デモを運用可能（開発・運用予算 $0 / ₹0）。

---

## 3. システムアーキテクチャ

システムは5つの論理レイヤーで構成されています。

```mermaid
flowchart TD
    subgraph LayerA["レイヤーA — 計装済みマイクロサービス群"]
        Checkout["Checkout（注文決済サービス :8081）"]
        Inventory["Inventory（在庫引当サービス :8082）"]
        Payment["Payment（決済ゲートウェイ :8083）"]
        Notification["Notification（通知配信サービス :8084）"]
        Checkout -->|HTTP / W3C TraceContext| Inventory
        Checkout -->|HTTP / W3C TraceContext| Payment
        Checkout -->|HTTP / W3C TraceContext| Notification
    end

    subgraph LayerB["レイヤーB — テレメトリ収集エンジン (Go)"]
        OTLPEndpoint["OTLP/HTTP 受信エンドポイント (POST /v1/traces)"]
        Normalizer["スパン正規化・べき等重複排除処理"]
        Runner["障害シナリオ実行ランナー"]
        OTLPEndpoint --> Normalizer
    end

    subgraph LayerC["レイヤーC — データストレージ層"]
        PG[("PostgreSQL 16 (高信頼永続化ストレージ)")]
        Mem[("インメモリストア (デモ用オンメモリ)")]
    end

    subgraph LayerD["レイヤーD — クエリ・分析API"]
        QueryAPI["Kairo REST API (:8080)"]
        REDCalc["REDメトリクス集計 (P50/P95/P99)"]
        Alerts["SLO閾値判定エンジン"]
    end

    subgraph LayerE["レイヤーE — Webフロントエンド (React + TypeScript)"]
        UI["Kairo ダッシュボード (:5173 / :8080)"]
        Waterfall["トレースウォーターフォール表示"]
        Topology["サービス依存関係マップ"]
        Console["シミュレータコンソール"]
    end

    Checkout -->|OTLP/HTTP Protobuf/JSON| OTLPEndpoint
    Inventory -->|OTLP/HTTP Protobuf/JSON| OTLPEndpoint
    Payment -->|OTLP/HTTP Protobuf/JSON| OTLPEndpoint
    Notification -->|OTLP/HTTP Protobuf/JSON| OTLPEndpoint

    Normalizer --> PG
    Normalizer --> Mem
    Runner --> Checkout

    PG --> QueryAPI
    Mem --> QueryAPI
    QueryAPI --> REDCalc
    QueryAPI --> Alerts

    QueryAPI --> UI
    UI --> Waterfall
    UI --> Topology
    UI --> Console
```

---

## 4. 主要機能

### A. トレースエクスプローラ & ウォーターフォール分析
- マイクロサービスを跨ぐルートスパンおよび子スパンをミリ秒精度で時系列整列。
- クリティカルパスの強調表示、スパンステータス（OK、Error、Unset）、階層関係を直感的に把握。
- スパン詳細ドロワーにより、HTTPステータスコード、エラー例外スタックトレース、属性タグを即座に確認。
- 親スパン未観測やネットワーク分断による不完全トレースの自動検知。

### B. サービス依存関係トポロジーマップ
- 受信した分散トレースから呼出元（Caller）と呼出先（Callee）の関係を自動推測。
- エッジのクリックにより、呼出頻度、エラー発生率、平均レイテンシを可視化。
- SLO閾値違反が発生しているノードに対する警告表示。

### C. REDメトリクス分析 (Rate, Error, Duration)
- 正規化されたサーバースパン（`span_kind = 2`）から正確なリクエストレート、エラー率、レイテンシパーセンタイル（P50、P95、P99）を算出。
- 1分、5分、15分、1時間の解像度バケット切替。
- 最も低速なエンドポイント上位リストおよびサービス別エラー発生内訳の表示。

### D. 対話型障害ラボ (Failure Lab)
- パラメータ調整可能な8種類の障害シナリオを即時実行・リセット可能。
- ANSIシンタックスカラー対応のリアルタイムストリーミングコンソール（自動スクロール、ログダウンロード対応）。
- スループット、P95レイテンシ、エラー率の**障害前後比較マトリクス (Before & After)**。
- トレース証拠から導出された客観的な**根本原因分析 (RCA) 診断結論**の自動提示。

### E. SLO閾値監視とアラート
- プロジェクトごとにP95レイテンシ上限およびエラー率許容値を設定可能。
- スライディングウィンドウによる自動評価と違反履歴の記録。
- 違反レコードから直接対象期間のトレースへドリルダウン可能。

### F. 日英バイリンガル切替 (ENG / 日本語)
- トップバー右上に配置された `[ ENG | 日本語 ]` スイッチにより、画面遷移なしで瞬時に言語を切替。
- ナビゲーション、KPIカード、障害ラボの全8シナリオ、設定画面に至るまで自然な日本語に対応。
- ブラウザの `localStorage` に選択言語を保持。

---

## 5. 障害ラボの検証シナリオ

| シナリオID | シナリオ名 | 注入する障害内容 | 期待される可観測性の影響 | 難易度 |
| :--- | :--- | :--- | :--- | :--- |
| `healthy-baseline` | **健全ベースライン** | なし（通常トラフィック） | エラー率0%、全サービスで低レイテンシ (P95 < 80ms)。 | 初級 |
| `slow-inventory` | **在庫サービス遅延** | 在庫引当に設定遅延 (200ms〜5000ms) を注入 | InventoryおよびCheckoutのP95が増加。エラー率は0%。 | 中級 |
| `payment-errors` | **決済サービスエラー** | 決済APIからHTTP 5xxを一定割合で返却 | PaymentおよびCheckoutのエラー率が上昇。例外イベント記録。 | 中級 |
| `notification-timeout` | **通知タイムアウト** | 通知処理をタイムアウト値 (800ms) 以上遅延 | 通知呼出はタイムアウトするが、注文自体は正常完了 (HTTP 200)。 | 上級 |
| `traffic-spike` | **トラフィック急増** | 2倍〜10倍のリクエスト急増を注入 | スループット急増に伴いキューイング遅延発生、P95/P99が延伸。 | 上級 |
| `cascading-failure` | **連鎖障害** | 在庫枯渇が上流スレッドを枯渇させ決済中断 | Checkout、Inventory、Payment全体で深刻なエラー (>60%)。 | エキスパート |
| `recovery` | **正常復旧** | 全障害を解除し、正常トラフィックを生成 | メトリクスが即座にグリーン復帰。過去の調査ログは保持。 | 初級 |
| `telemetry-issue` | **テレメトリ欠損・重複** | ネットワーク分断による重複バッチ送信 | UI上に不完全トレース警告を表示。重複スパン排除の動作検証。 | 中級 |

---

## 6. クイックスタートガイド

### 必要要件
- **Docker環境:** Docker 24+ および Docker Compose v2
- **ローカル直接実行環境:** Go 1.23+、Node.js 20+、npm 10+

### 方法A — ワンクリック統合起動スクリプト（推奨）

API、全4マイクロサービス、フロントエンドを一括で起動します。

**Windows (PowerShell):**
```powershell
powershell -ExecutionPolicy Bypass -File ./scripts/run-local.ps1
```

**Linux / macOS:**
```bash
chmod +x ./scripts/run-local.sh
./scripts/run-local.sh
```

**アクセス先:**
- フロントエンドUI (Vite): `http://localhost:5173`
- Kairo API & 本番SPA: `http://localhost:8080` (ヘルスチェック: `http://localhost:8080/healthz`)
- マイクロサービス: Checkout (`:8081`), Inventory (`:8082`), Payment (`:8083`), Notifications (`:8084`)

---

### 方法B — Docker Compose による完全起動（PostgreSQL永続化）

```bash
# 全コンテナをビルドしてバックグラウンド起動
docker compose up --build -d

# ログの確認
docker compose logs -f kairo-api

# コンテナの停止
docker compose down

# コンテナ停止とデータベースボリュームの完全削除
docker compose down -v
```

---

### 方法C — インメモリモード（Docker・DB不要の手動起動）

PostgreSQLを立ち上げず、メモリ内ストアで高速に動作確認が可能です。

```bash
# ターミナル 1: Kairo API (インメモリストア)
KAIRO_DEMO_MODE=true KAIRO_SEED_DEMO=true go run ./cmd/kairo-api

# ターミナル 2〜5: 4つのデモマイクロサービス
KAIRO_API_KEY=kairo-dev-key PORT=8082 go run ./services/inventory
KAIRO_API_KEY=kairo-dev-key PORT=8083 go run ./services/payment
KAIRO_API_KEY=kairo-dev-key PORT=8084 go run ./services/notifications
KAIRO_API_KEY=kairo-dev-key PORT=8081 go run ./services/checkout

# ターミナル 6: Webフロントエンド
cd web
npm install
VITE_DATA_MODE=api VITE_API_BASE_URL=http://localhost:8080 npm run dev
```

---

### 方法D — フロントエンド単体デモモード（バックエンド不要）

ブラウザ完結の決定論的シミュレーションエンジンで動作します。

```bash
cd web
npm install
npm run dev
```

ブラウザで `http://localhost:5173` を開きます。すべてのデータはブラウザ内で生成され、画面上に `SIMULATED DATA` と明示されます。

---

## 7. 設定と環境変数

### バックエンド (`kairo-api`)
| 環境変数名 | デフォルト値 | 説明 |
| :--- | :--- | :--- |
| `KAIRO_ENV` | `development` | 実行環境（`development` または `production`）。 |
| `KAIRO_HTTP_ADDR` | `:8080` | APIサーバーのバインドIPアドレスおよびポート。 |
| `KAIRO_DATABASE_URL` | *(空)* | PostgreSQL接続URL。空の場合はインメモリストアを使用。 |
| `KAIRO_ADMIN_TOKEN` | `kairo-dev-admin` | プロジェクト管理用の管理者Bearerトークン。 |
| `KAIRO_DEMO_MODE` | `false` | マイクロサービスに対する障害注入トリガーを有効化。 |
| `KAIRO_SEED_DEMO` | `false` | 起動時にデフォルトのデモプロジェクトとAPIキーを自動生成。 |
| `KAIRO_MAX_OTLP_BODY_BYTES` | `4194304` (4MB) | 受信するOTLPリクエストの最大バイト数。 |
| `KAIRO_MAX_SPANS_PER_BATCH` | `1000` | 1リクエスト内で処理する最大スパン数。 |
| `KAIRO_QUERY_TIMEOUT` | `10s` | データベースクエリのタイムアウト上限。 |
| `KAIRO_DEFAULT_RETENTION_DAYS` | `7` | トレースデータのデフォルト保持期間（日数）。 |

### フロントエンド (`web/`)
| 環境変数名 | デフォルト値 | 説明 |
| :--- | :--- | :--- |
| `VITE_DATA_MODE` | `demo` | データ取得プロバイダ（`demo`: ブラウザ内模擬データ、`api`: 実際のAPI接続）。 |
| `VITE_API_BASE_URL` | `http://localhost:8080` | Kairo APIのベースURL。 |
| `VITE_DEMO_SCENARIO_SEED` | `42` | シミュレーションデータ生成に使用する乱数シード値。 |

---

## 8. テストおよび検証方法

バックエンドおよびフロントエンドの品質を担保するため、厳格なテストスイートを備えています。

```bash
# 1. バックエンド単体テスト & HTTP統合テスト
go test -v -race ./...

# 2. PostgreSQL結合テスト (要PostgreSQL起動)
KAIRO_TEST_DATABASE_URL="postgres://kairo:kairo@localhost:5432/kairo?sslmode=disable" go test -v ./tests/integration/

# 3. フロントエンドの型検査・単体テスト・本番ビルド
npm --prefix web run typecheck
npm --prefix web test
npm --prefix web run build

# 4. 高負荷ベンチマークハーネス
go run ./tests/load -addr http://localhost:8080 -api-key kairo-dev-key -spans 50000 -workers 8
```

> [!NOTE]
> 性能測定値および実測ハードウェア環境の詳細は [`docs/benchmarks.md`](docs/benchmarks.md) に記録されています。

---

## Directory Structure / ディレクトリ構成

```text
kairo/
├── cmd/
│   └── kairo-api/             # Kairo API entrypoint & ingestion server
├── internal/
│   ├── alerts/                # SLO threshold evaluation rules
│   ├── auth/                  # API key & admin token authentication
│   ├── config/                # Environment variable configuration
│   ├── demosvc/               # Mock microservices framework & tracing
│   ├── httpserver/            # HTTP handlers, router & middleware
│   ├── metrics/               # RED metrics aggregation logic
│   ├── model/                 # Shared data domain structs
│   ├── otlp/                  # OTLP protobuf/JSON parser & normalizer
│   ├── retention/             # Data pruning & retention worker
│   ├── scenarios/             # Backend fault injection runner
│   └── storage/               # PostgreSQL & in-memory store implementations
├── migrations/                # Embedded SQL migrations for PostgreSQL
├── services/                  # Demo microservices (Checkout, Inventory, Payment, Notifications)
├── tests/
│   ├── integration/           # PostgreSQL end-to-end integration tests
│   └── load/                  # Benchmarking harness
├── scripts/
│   ├── run-local.ps1          # One-click Windows PowerShell launcher
│   └── run-local.sh           # One-click Unix Bash launcher
├── deploy/
│   └── docker-compose.yml     # Production-grade multi-container compose
├── web/                       # React 18 + TypeScript + Vite frontend
│   ├── public/                # Favicons, Ensō logo & brand assets
│   ├── src/
│   │   ├── app/               # Providers, query client, routing
│   │   ├── features/          # Waterfall visualizer, dependency graph, charts, console
│   │   ├── layouts/           # AppLayout with sidebar & bilingual toggle
│   │   ├── lib/i18n/          # Type-safe English & Japanese dictionary
│   │   └── pages/             # Overview, Traces, Services, Dependencies, Metrics, Failure Lab
│   └── package.json
└── docs/                      # Technical specifications & architecture decision records (ADRs)
```

---

## License / ライセンス

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

本プロジェクトは **MITライセンス** のもとで公開されています。詳細は [LICENSE](LICENSE) ファイルをご覧ください。
