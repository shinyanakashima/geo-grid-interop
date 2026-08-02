import { describe, expect, it } from "vitest";
import { tableFromIPC } from "apache-arrow";
// Node用ビルド（同期初期化）。ブラウザではESM+WASMを動的読み込みする
import * as wasmNode from "parquet-wasm/node";
import {
  conversionRecordsToArrowIPC,
  writeParquetFromIPC,
} from "../src/lib/parquet";
import { geometryToWkb } from "../src/lib/wkb";
import { convertCell } from "../src/lib/convert";
import { jismeshAdapter } from "../src/lib/adapters/jismesh";

const TOKYO = { lon: 139.767125, lat: 35.681236 };

function makeRecords() {
  const base = jismeshAdapter.pointToCell(TOKYO.lon, TOKYO.lat, "3");
  return convertCell(
    base,
    { targetSystem: "xyz", targetLevel: 14, method: "areal-weighted" },
    120
  );
}

describe("wkb", () => {
  it("Polygonのエンコード", () => {
    const wkb = geometryToWkb({
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 0],
        ],
      ],
    });
    const view = new DataView(wkb.buffer);
    expect(view.getUint8(0)).toBe(1); // little-endian
    expect(view.getUint32(1, true)).toBe(3); // Polygon
    expect(view.getUint32(5, true)).toBe(1); // リング数
    expect(view.getUint32(9, true)).toBe(4); // 頂点数
    expect(view.getFloat64(13 + 16, true)).toBe(1); // 2点目のx
    expect(wkb.length).toBe(9 + 4 + 4 * 16);
  });
});

describe("parquet", () => {
  it("属性のみParquetの往復", () => {
    const records = makeRecords();
    const { ipc, geoMetadata } = conversionRecordsToArrowIPC(records, false);
    expect(geoMetadata).toBeNull();
    const bytes = writeParquetFromIPC(wasmNode, ipc, geoMetadata);
    // PAR1 マジックナンバー
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("PAR1");
    const back = tableFromIPC(wasmNode.readParquet(bytes).intoIPCStream());
    expect(back.numRows).toBe(records.length);
    const names = back.schema.fields.map((f) => f.name);
    expect(names).toContain("source_id");
    expect(names).toContain("target_ratio");
    expect(names).not.toContain("geometry");
    // 按分値の合計が保存されている
    const values = back.getChild("target_value")!.toArray() as Float64Array;
    const sum = values.reduce((s, v) => s + v, 0);
    expect(sum).toBeCloseTo(120, 3);
  });

  it("GeoParquet（WKBジオメトリ付き）の往復とgeoメタデータ", () => {
    const records = makeRecords();
    const { ipc, geoMetadata } = conversionRecordsToArrowIPC(records, true);
    expect(geoMetadata).not.toBeNull();
    const meta = JSON.parse(geoMetadata!);
    expect(meta.version).toBe("1.1.0");
    expect(meta.primary_column).toBe("geometry");
    expect(meta.columns.geometry.encoding).toBe("WKB");

    const bytes = writeParquetFromIPC(wasmNode, ipc, geoMetadata);
    const back = tableFromIPC(wasmNode.readParquet(bytes).intoIPCStream());
    expect(back.numRows).toBe(records.length);
    const geom = back.getChild("geometry")!;
    const first = geom.get(0) as Uint8Array;
    // WKB Polygonであること
    const view = new DataView(first.buffer, first.byteOffset);
    expect(view.getUint8(0)).toBe(1);
    expect(view.getUint32(1, true)).toBe(3);
  });
});
