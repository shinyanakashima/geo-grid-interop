# geo-grid-interop — 空間グリッド比較・変換基盤

地域標準メッシュ（JIS X 0410）を中心に、複数の空間グリッド／空間インデックスを
**比較・可視化・変換**するための相互運用基盤です。

> 地域標準メッシュとして蓄積された日本の統計・オープンデータ資産を、
> H3・S2・Geohash・XYZタイル・空間IDへ接続し、比較・検証・変換できる
> 相互運用基盤を提供する。

詳細な要件は [docs/SPEC.md](docs/SPEC.md)（開発指示書）を参照してください。

## 対象グリッド

| 方式 | Web GIS | QGISプラグイン | 状態 |
| --- | --- | --- | --- |
| 地域標準メッシュ（JIS X 0410） | ✅ | ✅ | MVP |
| H3 | ✅ | ✅（要 `pip install h3`） | MVP |
| XYZタイル | ✅ | ✅ | MVP |
| 空間ID（ZFXY・水平+鉛直インデックス） | ✅ | ✅ | MVP |
| S2 / Geohash | — | — | 第2段階 |

## リポジトリ構成

```
web/                    Web GIS（Vite + React + TypeScript + MapLibre GL JS）
  src/lib/adapters/     グリッドアダプター（共通インターフェース GridAdapter）
  src/lib/              共通データモデル・測地計算・交差計算・変換
  src/workers/          Web Worker（セル生成・交差判定・変換）
  src/components/       画面モード（比較 / 対応確認 / 変換）
  tests/                vitest（アダプター・交差・按分のテスト）
  scripts/              共通テストケース生成
qgis-plugin/
  grid_interoperability/  QGISプラグイン
    adapters/             Python版グリッドアダプター（Web版と同一ロジック）
    core/                 データモデル・測地計算・交差計算・変換
    processing/           Processingアルゴリズム（生成/ID付与/対応表/変換/按分）
    tests/                共通テストケースとの整合性テスト（QGIS不要）
shared/testcases/       Web版・QGIS版共通のテストケースJSON（指示書 §16）
docs/SPEC.md            開発指示書
```

## Web GIS

### 機能（MVP）

- **メッシュ比較**: 2つのMapLibre地図を同期した左右比較（中心・ズーム・回転・
  カーソル位置を同期、幅スライダー付き）。クリック地点のセルID・面積・親セル等の比較表。
  「面積一致」モードは固定対応表ではなく、クリック位置の実セル面積で右側レベルを自動選択。
- **セル対応確認**: 基準セルと他方式セルの交差セル数・完全包含・境界交差・
  面積比（合計と誤差）を計算し、完全包含は薄い塗り、境界交差は破線で表示。
- **グリッド変換**: メッシュコード付きCSVまたはセルIDリストを、重心割当・
  最大重複面積・面積按分・全交差・完全包含のみ・閾値指定で変換。
  面積按分は推計値フラグ付き、整数化（四捨五入／最大剰余法）対応。CSV/GeoJSON出力。
- 背景地図は地理院タイル（淡色・標準）を利用者のブラウザから直接読み込み、
  出典（国土地理院）を表示。透過度・彩度・明るさ・非表示を調整可能。
- 表示状態（モード・座標・グリッド・選択セル等）をURLハッシュで共有。
- セル境界生成・交差計算・変換はWeb Workerで実行（1レイヤー最大5,000セル）。

### 開発

```bash
cd web
npm install
npm run dev        # 開発サーバー
npm test           # vitest
npm run build      # 本番ビルド（dist/）
npm run generate-testcases   # shared/testcases/grid-cells.json を再生成
```

### Cloudflare Pages へのデプロイ

Cloudflare Pages の GitHub 連携で本リポジトリを接続し、以下を設定します。

| 設定 | 値 |
| --- | --- |
| Build command | `cd web && npm ci && npm run build` |
| Build output directory | `web/dist` |

Pull Request ごとの Preview 環境が自動で発行されます。
Workers / R2 / D1 / Queues を用いた大規模変換APIは第2段階（指示書 §18.3）です。

## QGISプラグイン

`qgis-plugin/grid_interoperability` を QGIS のプラグインディレクトリへコピー
（またはシンボリックリンク）して有効化します。

- **ドックウィジェット**: 基準グリッド・レベルを選び、各機能をワンクリックで起動。
- **Processingアルゴリズム**（プロバイダー `gridinterop`）:
  - グリッド生成（範囲指定） — 表示範囲のセルをメモリレイヤーとして生成
  - セルIDを属性として付与 — 代表点／重心／最大重複面積／全交差セル
  - グリッド間対応表を作成 — 交差面積・交差率付き crosswalk テーブル
  - グリッド間変換 — 重心割当・最大重複・完全包含・閾値指定など6方式
  - 属性値を面積按分 — 推計値フラグ・最大剰余法による整数配分対応
- 出力は QGIS 標準の仕組みで GeoPackage / CSV 等へ保存できます。
- H3 を使う場合は QGIS の Python 環境へ `pip install h3`（v4系）が必要です。
  未インストールでも地域標準メッシュ・XYZ・空間IDの機能は動作します。

### テスト（QGIS不要）

```bash
pip install shapely h3 pytest
pytest qgis-plugin
```

## Web版とQGIS版の整合性（指示書 §16）

- 面積計算: 両実装とも球面過剰法（平均半径 6371008.7714 m）で統一。
- 座標の丸め規則: セル境界上の点は EPS（1e-9）付き floor により
  **北東側（値の大きい側）のセルに属する**（半開区間 `[下端, 上端)`）。
- `shared/testcases/grid-cells.json` に帯広・札幌・東京・那覇・赤道付近・
  高緯度・国際日付変更線付近・セル境界上・海上・地下・高高度のテストケースを収録。
  Web版（vitest）とQGIS版（pytest）の両方が同じJSONを参照し、
  同一座標から同じセルID・面積が得られることを検証します。

## 出典・ライセンス

- 背景地図: [地理院タイル](https://maps.gsi.go.jp/development/ichiran.html)（出典: 国土地理院）
- License: Apache License 2.0（[LICENSE](LICENSE)）
