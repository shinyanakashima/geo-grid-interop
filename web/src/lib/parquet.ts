/**
 * Parquet / GeoParquet 出力（指示書 §10.7, §14）。
 *
 * Arrowテーブルの構築（純粋・テスト可能）と、parquet-wasm による
 * Parquetバイト列生成を分離している。ブラウザでは writeParquetFile を
 * 使う（parquet-wasm のWASMを動的importするため初回のみ読み込みが走る）。
 */

import * as arrow from "apache-arrow";
import type { ConversionRecord } from "./convert";
import { geometryToWkb } from "./wkb";

export interface ArrowBuildResult {
  /** Arrow IPC stream バイト列 */
  ipc: Uint8Array;
  /** GeoParquet "geo" メタデータ（geometry列がない場合は null） */
  geoMetadata: string | null;
}

/** 変換結果レコードを Arrow IPC へ変換する */
export function conversionRecordsToArrowIPC(
  records: ConversionRecord[],
  includeGeometry: boolean
): ArrowBuildResult {
  const str = (f: (r: ConversionRecord) => string) =>
    arrow.vectorFromArray(records.map(f), new arrow.Utf8());
  const f64 = (f: (r: ConversionRecord) => number | null) =>
    arrow.vectorFromArray(records.map(f), new arrow.Float64());

  const columns: Record<string, arrow.Vector> = {
    source_system: str((r) => r.sourceSystem),
    source_id: str((r) => r.sourceId),
    source_level: str((r) => String(r.sourceLevel)),
    target_system: str((r) => r.targetSystem),
    target_id: str((r) => r.targetId),
    target_level: str((r) => String(r.targetLevel)),
    intersection_area_m2: f64((r) => r.intersectionAreaM2),
    source_area_m2: f64((r) => r.sourceAreaM2),
    target_area_m2: f64((r) => r.targetAreaM2),
    source_ratio: f64((r) => r.sourceRatio),
    target_ratio: f64((r) => r.targetRatio),
    source_value: f64((r) => r.sourceValue ?? null),
    target_value: f64((r) => r.targetValue ?? null),
    method: str((r) => r.method),
    is_estimated: arrow.vectorFromArray(
      records.map((r) => r.isEstimated),
      new arrow.Bool()
    ),
    converted_at: str((r) => r.convertedAt),
  };

  let geoMetadata: string | null = null;
  if (includeGeometry) {
    columns.geometry = arrow.vectorFromArray(
      records.map((r) => (r.geometry ? geometryToWkb(r.geometry) : null)),
      new arrow.Binary()
    );
    const geometryTypes = [
      ...new Set(records.map((r) => r.geometry?.type).filter(Boolean)),
    ];
    // GeoParquet 1.1（CRS省略時は OGC:CRS84 = WGS84 経度緯度）
    geoMetadata = JSON.stringify({
      version: "1.1.0",
      primary_column: "geometry",
      columns: {
        geometry: {
          encoding: "WKB",
          geometry_types: geometryTypes,
        },
      },
    });
  }

  const table = new arrow.Table(columns);
  return { ipc: arrow.tableToIPC(table, "stream"), geoMetadata };
}

type ParquetWasm = typeof import("parquet-wasm/esm");

let wasmModulePromise: Promise<ParquetWasm> | null = null;

/** parquet-wasm（ESM/WASM）を遅延読み込みして初期化する */
async function loadParquetWasm(): Promise<ParquetWasm> {
  if (!wasmModulePromise) {
    wasmModulePromise = (async () => {
      const mod = await import("parquet-wasm/esm");
      const { default: wasmUrl } = await import(
        // @ts-expect-error Viteの?urlインポート
        "parquet-wasm/esm/parquet_wasm_bg.wasm?url"
      );
      await mod.default({ module_or_path: wasmUrl });
      return mod;
    })();
  }
  return wasmModulePromise;
}

/**
 * Parquet / GeoParquet バイト列を生成する（ブラウザ用）。
 */
export async function writeParquetFile(
  records: ConversionRecord[],
  includeGeometry: boolean
): Promise<Uint8Array> {
  const { ipc, geoMetadata } = conversionRecordsToArrowIPC(
    records,
    includeGeometry
  );
  const wasm = await loadParquetWasm();
  return writeParquetFromIPC(wasm, ipc, geoMetadata);
}

/**
 * IPC→Parquet 変換の本体。Node環境のテストでは parquet-wasm/node を
 * 渡して同じ経路を検証する。
 */
export function writeParquetFromIPC(
  wasm: Pick<ParquetWasm, "Table" | "writeParquet" | "WriterPropertiesBuilder">,
  ipc: Uint8Array,
  geoMetadata: string | null
): Uint8Array {
  const table = wasm.Table.fromIPCStream(ipc);
  let builder = new wasm.WriterPropertiesBuilder();
  if (geoMetadata) {
    builder = builder.setKeyValueMetadata(new Map([["geo", geoMetadata]]));
  }
  return wasm.writeParquet(table, builder.build());
}
