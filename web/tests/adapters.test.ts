import { describe, expect, it } from "vitest";
import { jismeshAdapter, toMeshCode, codeToSouthWest } from "../src/lib/adapters/jismesh";
import { xyzAdapter } from "../src/lib/adapters/xyz";
import { spatialIdAdapter } from "../src/lib/adapters/spatialid";
import { h3Adapter } from "../src/lib/adapters/h3";
import { s2Adapter } from "../src/lib/adapters/s2";
import { geohashAdapter } from "../src/lib/adapters/geohash";
import { computeCorrespondence, levelByAreaMatch } from "../src/lib/intersect";
import { convertCell, applyRounding } from "../src/lib/convert";
import { polygonAreaM2 } from "../src/lib/geo";

// 指示書 §17 のテスト地点
const OBIHIRO = { lon: 143.196, lat: 42.923 };
const TOKYO = { lon: 139.767125, lat: 35.681236 }; // 東京駅

describe("jismesh", () => {
  it("東京駅の各レベルコード", () => {
    expect(toMeshCode(TOKYO.lon, TOKYO.lat, "1")).toBe("5339");
    expect(toMeshCode(TOKYO.lon, TOKYO.lat, "2")).toBe("533946");
    expect(toMeshCode(TOKYO.lon, TOKYO.lat, "3")).toBe("53394611");
  });

  it("コード→境界→コードの往復が一致する", () => {
    for (const level of ["1", "2", "3", "half", "quarter", "eighth"] as const) {
      const code = toMeshCode(OBIHIRO.lon, OBIHIRO.lat, level);
      const [lonMin, latMin] = codeToSouthWest(code);
      const cell = jismeshAdapter.cellToGeometry(code);
      expect(toMeshCode(cell.center[0], cell.center[1], level)).toBe(code);
      expect(lonMin).toBeLessThanOrEqual(OBIHIRO.lon);
      expect(latMin).toBeLessThanOrEqual(OBIHIRO.lat);
    }
  });

  it("親子関係が正しい", () => {
    const code = toMeshCode(OBIHIRO.lon, OBIHIRO.lat, "3");
    expect(jismeshAdapter.getParent(code)).toBe(code.slice(0, 6));
    const children = jismeshAdapter.getChildren(code.slice(0, 6));
    expect(children).toHaveLength(100);
    expect(children).toContain(code);
  });

  it("3次メッシュの面積が約1km²", () => {
    const cell = jismeshAdapter.pointToCell(TOKYO.lon, TOKYO.lat, "3");
    expect(cell.areaM2).toBeGreaterThan(0.8e6);
    expect(cell.areaM2).toBeLessThan(1.2e6);
  });

  it("適用範囲外でエラー", () => {
    expect(() => toMeshCode(-70, 40, "3")).toThrow();
    expect(() => toMeshCode(139, -35, "3")).toThrow();
  });

  it("境界ポリゴンが閉じている", () => {
    const cell = jismeshAdapter.pointToCell(OBIHIRO.lon, OBIHIRO.lat, "3");
    const ring = cell.geometry.coordinates[0] as [number, number][];
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });
});

describe("xyz", () => {
  it("既知のタイル座標", () => {
    // 帯広 z14
    const cell = xyzAdapter.pointToCell(OBIHIRO.lon, OBIHIRO.lat, 14);
    const [z, x, y] = cell.id.split("/").map(Number);
    expect(z).toBe(14);
    expect(x).toBe(Math.floor(((OBIHIRO.lon + 180) / 360) * 2 ** 14));
    expect(y).toBeGreaterThan(0);
  });

  it("親子関係", () => {
    const cell = xyzAdapter.pointToCell(TOKYO.lon, TOKYO.lat, 14);
    const parent = xyzAdapter.getParent(cell.id)!;
    expect(xyzAdapter.getChildren(parent)).toContain(cell.id);
  });

  it("経度180度をまたぐ範囲のセル生成", () => {
    const cells = xyzAdapter.cellsForBounds([179.5, 60, -179.5, 61], 8);
    expect(cells.length).toBeGreaterThan(0);
    // すべて有効なタイル
    for (const c of cells) {
      const [z, x] = c.id.split("/").map(Number);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(2 ** z);
    }
  });

  it("高緯度でも面積が正", () => {
    const cell = xyzAdapter.pointToCell(0, 84.9, 10);
    expect(cell.areaM2).toBeGreaterThan(0);
  });
});

describe("spatial-id", () => {
  it("XYZタイルと水平方向が一致する", () => {
    const xyz = xyzAdapter.pointToCell(OBIHIRO.lon, OBIHIRO.lat, 14);
    const sid = spatialIdAdapter.pointToCell(OBIHIRO.lon, OBIHIRO.lat, 14, 0);
    expect(sid.geometry).toEqual(xyz.geometry);
    expect(sid.id).toBe(`/14/0/${xyz.id.split("/")[1]}/${xyz.id.split("/")[2]}`);
  });

  it("高度から鉛直インデックスを計算する", () => {
    // z=14 のボクセル高さは 2^11 = 2048m
    const sid = spatialIdAdapter.pointToCell(OBIHIRO.lon, OBIHIRO.lat, 14, 3000);
    expect(sid.id.startsWith("/14/1/")).toBe(true);
    expect(sid.minHeightM).toBe(2048);
    expect(sid.maxHeightM).toBe(4096);
  });
});

describe("h3", () => {
  it("セルIDの往復", () => {
    const cell = h3Adapter.pointToCell(TOKYO.lon, TOKYO.lat, 8);
    expect(cell.id).toBe("882f5a32d9fffff");
    const rebuilt = h3Adapter.cellToGeometry(cell.id);
    expect(rebuilt.level).toBe(8);
    expect(rebuilt.areaM2).toBeCloseTo(cell.areaM2, 5);
  });

  it("resolution 8 の面積が約0.7km²", () => {
    const cell = h3Adapter.pointToCell(TOKYO.lon, TOKYO.lat, 8);
    expect(cell.areaM2).toBeGreaterThan(0.5e6);
    expect(cell.areaM2).toBeLessThan(1.1e6);
  });

  it("隣接セルは6個（通常セル）", () => {
    const cell = h3Adapter.pointToCell(TOKYO.lon, TOKYO.lat, 8);
    expect(h3Adapter.getNeighbors(cell.id)).toHaveLength(6);
  });
});

describe("s2", () => {
  it("東京駅 level 13 のトークン（s2sphereと一致する既知値）", () => {
    const cell = s2Adapter.pointToCell(TOKYO.lon, TOKYO.lat, 13);
    expect(cell.id).toBe("60188bfc");
    expect(cell.level).toBe(13);
  });

  it("トークンの往復と親子関係", () => {
    const cell = s2Adapter.pointToCell(OBIHIRO.lon, OBIHIRO.lat, 13);
    const rebuilt = s2Adapter.cellToGeometry(cell.id);
    expect(rebuilt.areaM2).toBeCloseTo(cell.areaM2, 5);
    const parent = s2Adapter.getParent(cell.id)!;
    expect(s2Adapter.getChildren(parent)).toContain(cell.id);
    expect(s2Adapter.getNeighbors(cell.id)).toHaveLength(4);
  });

  it("level 13 の面積が約1km²前後", () => {
    const cell = s2Adapter.pointToCell(TOKYO.lon, TOKYO.lat, 13);
    expect(cell.areaM2).toBeGreaterThan(0.5e6);
    expect(cell.areaM2).toBeLessThan(2e6);
  });

  it("境界リングが閉じている", () => {
    const cell = s2Adapter.pointToCell(TOKYO.lon, TOKYO.lat, 13);
    const ring = cell.geometry.coordinates[0] as [number, number][];
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it("cellsForBounds が範囲を被覆する", () => {
    const base = jismeshAdapter.pointToCell(TOKYO.lon, TOKYO.lat, "3");
    const [minLon, minLat] = (base.geometry.coordinates[0] as [number, number][])[0];
    const cells = s2Adapter.cellsForBounds(
      [minLon, minLat, minLon + 1 / 80, minLat + 1 / 120],
      13
    );
    expect(cells.length).toBeGreaterThan(0);
    // クリック地点のセルが含まれる
    const target = s2Adapter.pointToCell(TOKYO.lon, TOKYO.lat, 13);
    expect(cells.map((c) => c.id)).toContain(target.id);
  });
});

describe("geohash", () => {
  it("東京駅 length 6", () => {
    const cell = geohashAdapter.pointToCell(TOKYO.lon, TOKYO.lat, 6);
    expect(cell.id).toBe("xn76ur");
    expect(cell.level).toBe(6);
  });

  it("親子・隣接関係", () => {
    const cell = geohashAdapter.pointToCell(OBIHIRO.lon, OBIHIRO.lat, 6);
    expect(geohashAdapter.getParent(cell.id)).toBe(cell.id.slice(0, 5));
    expect(geohashAdapter.getChildren(cell.id)).toHaveLength(32);
    expect(geohashAdapter.getNeighbors(cell.id)).toHaveLength(8);
  });

  it("無効なIDでエラー", () => {
    expect(() => geohashAdapter.cellToGeometry("ai_lo")).toThrow();
  });

  it("3次メッシュ × Geohash 6 の面積比合計が約100%", () => {
    const base = jismeshAdapter.pointToCell(TOKYO.lon, TOKYO.lat, "3");
    const result = computeCorrespondence(base, "geohash", 6);
    expect(result.ratioSum).toBeGreaterThan(0.999);
    expect(result.ratioSum).toBeLessThan(1.001);
  });
});

describe("intersect / correspondence", () => {
  it("3次メッシュ × H3 res8 の面積比合計が約100%", () => {
    const base = jismeshAdapter.pointToCell(OBIHIRO.lon, OBIHIRO.lat, "3");
    const result = computeCorrespondence(base, "h3", 8);
    expect(result.intersectCount).toBeGreaterThan(1);
    expect(result.ratioSum).toBeGreaterThan(0.999);
    expect(result.ratioSum).toBeLessThan(1.001);
    expect(result.containedCount + result.boundaryCount).toBe(
      result.intersectCount
    );
  });

  it("3次メッシュ × XYZ z14 の面積比合計が約100%", () => {
    const base = jismeshAdapter.pointToCell(TOKYO.lon, TOKYO.lat, "3");
    const result = computeCorrespondence(base, "xyz", 14);
    expect(result.ratioSum).toBeGreaterThan(0.999);
    expect(result.ratioSum).toBeLessThan(1.001);
  });

  it("3次メッシュ × S2 level 13 の面積比合計が約100%", () => {
    const base = jismeshAdapter.pointToCell(TOKYO.lon, TOKYO.lat, "3");
    const result = computeCorrespondence(base, "s2", 13);
    expect(result.intersectCount).toBeGreaterThan(0);
    expect(result.ratioSum).toBeGreaterThan(0.999);
    expect(result.ratioSum).toBeLessThan(1.001);
  });

  it("面積一致モード: 3次メッシュ(≒1km²)にはH3 res8が選ばれる", () => {
    const base = jismeshAdapter.pointToCell(TOKYO.lon, TOKYO.lat, "3");
    const level = levelByAreaMatch("h3", TOKYO.lon, TOKYO.lat, base.areaM2);
    expect(level).toBe(8);
  });
});

describe("convert", () => {
  const base = jismeshAdapter.pointToCell(TOKYO.lon, TOKYO.lat, "3");

  it("面積按分の合計値が保存される", () => {
    const records = convertCell(base, {
      targetSystem: "h3",
      targetLevel: 8,
      method: "areal-weighted",
    }, 120);
    const sum = records.reduce((s, r) => s + (r.targetValue ?? 0), 0);
    expect(sum).toBeCloseTo(120, 3);
    expect(records.every((r) => r.isEstimated)).toBe(true);
  });

  it("最大剰余法で合計値を維持した整数配分", () => {
    const records = convertCell(base, {
      targetSystem: "h3",
      targetLevel: 8,
      method: "areal-weighted",
    }, 120);
    const rounded = applyRounding(records, "largest-remainder");
    const sum = rounded.reduce((s, r) => s + (r.targetValue ?? 0), 0);
    expect(sum).toBe(120);
    expect(rounded.every((r) => Number.isInteger(r.targetValue))).toBe(true);
  });

  it("重心割当は1セルを返す", () => {
    const records = convertCell(base, {
      targetSystem: "xyz",
      targetLevel: 14,
      method: "centroid",
    });
    expect(records).toHaveLength(1);
  });
});

describe("geo", () => {
  it("赤道上の1度×1度の面積", () => {
    const ring: [number, number][] = [
      [0, -0.5],
      [1, -0.5],
      [1, 0.5],
      [0, 0.5],
      [0, -0.5],
    ];
    // 約 12,364 km²
    const area = polygonAreaM2([ring]);
    expect(area / 1e6).toBeGreaterThan(12000);
    expect(area / 1e6).toBeLessThan(12500);
  });
});
