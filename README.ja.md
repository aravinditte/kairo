# KAIRO (回路)

<div align="center">
  <img src="web/public/kairo-app-icon.png" width="112" height="112" alt="Kairo App Icon" />
  <h3>分散可観測性 & 障害調査プラットフォーム</h3>
  <p><strong>すべての経路を見通し、すべての障害を捉える。</strong><br />
  <em>See every path. Find every fault.</em></p>
  <p>
    <a href="README.md"><strong>English / 英語README</strong></a> &bull;
    <a href="#-目次"><strong>日本語目次</strong></a>
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

## 目次

- [1. プロジェクト概要](#1-プロジェクト概要)
- [2. 設計思想と基本原則](#2-設計思想と基本原則)
- [3. システムアーキテクチャ](#3-システムアーキテクチャ)
- [4. 主要機能](#4-主要機能)
- [5. 障害ラボ (Failure Lab) の検証シナリオ](#5-障害ラボ-failure-lab-の検証シナリオ)
- [6. クイックスタートガイド](#6-クイックスタートガイド)
- [7. 設定と環境変数](#7-設定と環境変数)
- [8. テストおよび検証方法](#8-テストおよび検証方法)
- [9. ディレクトリ構成](#9-ディレクトリ構成)
- [10. ライセンス](#10-ライセンス)

---

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

## 5. 障害ラボ (Failure Lab) の検証シナリオ

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

## 9. ディレクトリ構成

```text
kairo/
├── cmd/
│   └── kairo-api/             # Kairo API エントリポイント & テレメトリ収集サーバー
├── internal/
│   ├── alerts/                # SLO閾値判定ロジック
│   ├── auth/                  # APIキー & 管理者Bearerトークン認証
│   ├── config/                # 環境変数コンフィグレーション
│   ├── demosvc/               # デモマイクロサービスフレームワーク & トレーシング
│   ├── httpserver/            # HTTPハンドラー、ルーター、ミドルウェア
│   ├── metrics/               # REDメトリクス集計ロジック
│   ├── model/                 # 共有データモデル構造体
│   ├── otlp/                  # OTLP Protobuf/JSONパーサー & スパン正規化
│   ├── retention/             # データクリーンアップ・保持期間管理ワーカー
│   ├── scenarios/             # バックエンド障害シナリオ実行ランナー
│   └── storage/               # PostgreSQL & インメモリストア実装
├── migrations/                # PostgreSQL用組み込みSQLマイグレーション
├── services/                  # デモ用4マイクロサービス (Checkout, Inventory, Payment, Notifications)
├── tests/
│   ├── integration/           # PostgreSQLエンドツーエンド統合テスト
│   └── load/                  # 負荷ベンチマークハーネス
├── scripts/
│   ├── run-local.ps1          # Windows PowerShell用ワンクリック起動スクリプト
│   └── run-local.sh           # Unix Bash用ワンクリック起動スクリプト
├── deploy/
│   └── docker-compose.yml     # 本番用マルチコンテナCompose定義
├── web/                       # React 18 + TypeScript + Vite フロントエンド
│   ├── public/                # ファビコン、円相 (Ensō) ロゴ、ブランドアセット
│   ├── src/
│   │   ├── app/               # プロバイダー、React Query、ルーティング
│   │   ├── features/          # ウォーターフォール、トポロジー、グラフ、コンソール
│   │   ├── layouts/           # サイドバー & 日英切替スイッチ付きレイアウト
│   │   ├── lib/i18n/          # 型安全な日本語・英語翻訳ディクショナリ
│   │   └── pages/             # 概要、トレース、サービス、依存関係、メトリクス、障害ラボ
│   └── package.json
└── docs/                      # 技術仕様書 & アーキテクチャ決定記録 (ADR)
```

---

## 10. ライセンス

本プロジェクトは **MITライセンス** のもとで公開されています。詳細は [LICENSE](LICENSE) ファイルをご覧ください。
