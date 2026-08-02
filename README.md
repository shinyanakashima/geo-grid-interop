# geo-grid-interop — 空間グリッド比較・変換基盤

地域標準メッシュ（JIS X 0410）を中心に、複数の空間グリッド／空間インデックスを
**比較・可視化・変換**するための相互運用基盤です。

> 地域標準メッシュとして蓄積された日本の統計・オープンデータ資産を、
> H3・S2・Geohash・XYZタイル・空間IDへ接続し、比較・検証・変換できる
> 相互運用基盤を提供する。

詳細な要件は [docs/SPEC.md](docs/SPEC.md)（開発指示書）を参照してください。

## 対象グリッド

| 方式 | Web GIS | QGISプラグイン |
| --- | --- | --- |
| 地域標準メッシュ（JIS X 0410） | ✅ | ✅ |
| H3 | ✅ | ✅（要 `pip install h3`） |
| S2 | ✅ | ✅（要 `pip install s2sphere`） |
| Geohash | ✅ | ✅（純Python実装・依存なし） |
| XYZタイル | ✅ | ✅ |
| 空間ID（ZFXY・水平+鉛直インデックス） | ✅ | ✅ |

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

- **メッシュ比較**: 同期した2つのMapLibre地図によるグリッド比較。
  既定は**スワイプ表示**（1つの地図表示を比較線で区切り、線の左右に別グリッドを
  表示。比較線はドラッグで移動可能）で、**左右並列表示**にも切り替え可能。
  クリック地点のセルID・面積・親セル等の比較表を表示。
  「面積一致」モードは固定対応表ではなく、クリック位置の実セル面積で右側レベルを自動選択。
- **セル対応確認**: 基準セルと他方式セルの交差セル数・完全包含・境界交差・
  面積比（合計と誤差）を計算し、完全包含は薄い塗り、境界交差は破線で表示。
- **グリッド変換**: メッシュコード付きCSVまたはセルIDリストを、重心割当・
  最大重複面積・面積按分・全交差・完全包含のみ・閾値指定で変換。
  面積按分は推計値フラグ付き、整数化（四捨五入／最大剰余法）対応。CSV/GeoJSON出力。
- **空間IDの3D表示**: 高度スライダー（地下対応）で鉛直インデックス（f値）を
  切り替え、3Dボクセル表示（fill-extrusion・半透明・高さ倍率調整付き）で
  XYZタイルとの水平一致と鉛直構造を確認可能。高さ基準は楕円体高。
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

### デプロイ（GitHub Pages + GitHub Actions）

MVPは完全静的サイトのため **GitHub Pages** へ GitHub Actions でデプロイします
（`.github/workflows/deploy.yml`）。`main` へのpushで自動的に
テスト → ビルド → デプロイが実行されます。

有効化はリポジトリの **Settings → Pages → Source を「GitHub Actions」**
にするだけです。**環境変数・シークレットは不要**です（APIキーなし、
地理院タイルは公開URLへ直接アクセス）。

サブパス配信（`https://<owner>.github.io/geo-grid-interop/`）に対応するため
Viteの `base` は相対パス（`./`）とし、ルーティングはURLハッシュのみを
使用しています。

<details>
<summary>Cloudflare Workers（static assets）を使う場合（代替・第2段階向け）</summary>

第2段階のWorkers API・R2・D1・Queues（指示書 §18.3）を導入する際は、
定義済みの `web/wrangler.jsonc` でCloudflare Workersへ移行できます。

- GitHub連携（Workers Builds）: Root directory `web` /
  Build command `npm ci && npm run build` / Deploy command `npx wrangler deploy`
- 手元から: `cd web && npm run deploy`（要 `wrangler login`）

</details>

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
- H3 は `pip install h3`（v4系）、S2 は `pip install s2sphere` が必要です。
  未インストールでも他のグリッドの機能は動作します。

### 配布用zipの作成

```bash
scripts/package_qgis_plugin.sh    # dist/grid_interoperability-<version>.zip
```

`v*` タグをpushするとGitHub Actionsがテスト→zip作成→Releasesへの添付まで
自動で行います（`.github/workflows/release.yml`）。

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
