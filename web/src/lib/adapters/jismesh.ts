/**
 * 地域標準メッシュ（JIS X 0410）アダプター。
 *
 * レベル体系:
 *   "1"       1次メッシュ（約80km）  緯度 2/3°   × 経度 1°
 *   "2"       2次メッシュ（約10km）  緯度 1/12°  × 経度 1/8°
 *   "3"       3次メッシュ（約1km）   緯度 1/120° × 経度 1/80°
 *   "half"    2分の1メッシュ（約500m）
 *   "quarter" 4分の1メッシュ（約250m）
 *   "eighth"  8分の1メッシュ（約125m）
 *
 * QGIS プラグイン側 adapters/jismesh.py と同一ロジック（指示書 §16）。
 */

import type { GridAdapter, GridCell, Position } from "../types";
import { distanceM, polygonAreaM2 } from "../geo";

export type JismeshLevel = "1" | "2" | "3" | "half" | "quarter" | "eighth";

interface LevelSpec {
  latSpan: number;
  lonSpan: number;
  codeLength: number;
}

export const JISMESH_LEVELS: Record<JismeshLevel, LevelSpec> = {
  "1": { latSpan: 2 / 3, lonSpan: 1, codeLength: 4 },
  "2": { latSpan: 1 / 12, lonSpan: 1 / 8, codeLength: 6 },
  "3": { latSpan: 1 / 120, lonSpan: 1 / 80, codeLength: 8 },
  half: { latSpan: 1 / 240, lonSpan: 1 / 160, codeLength: 9 },
  quarter: { latSpan: 1 / 480, lonSpan: 1 / 320, codeLength: 10 },
  eighth: { latSpan: 1 / 960, lonSpan: 1 / 640, codeLength: 11 },
};

const LEVEL_ORDER: JismeshLevel[] = ["1", "2", "3", "half", "quarter", "eighth"];

/** 浮動小数点の桁落ちでセル境界上の点が隣セルに落ちるのを防ぐ許容量 */
const EPS = 1e-9;

function assertInRange(lon: number, lat: number): void {
  if (lat < 0 || lat >= 66.66 || lon < 100 || lon >= 180) {
    throw new Error(
      `地域標準メッシュの適用範囲外です (lon=${lon}, lat=${lat})`
    );
  }
}

export function levelOfCode(code: string): JismeshLevel {
  const found = LEVEL_ORDER.find(
    (lv) => JISMESH_LEVELS[lv].codeLength === code.length
  );
  if (!found || !/^\d+$/.test(code)) {
    throw new Error(`無効なメッシュコードです: ${code}`);
  }
  return found;
}

/** 経緯度からメッシュコードを計算する */
export function toMeshCode(
  lon: number,
  lat: number,
  level: JismeshLevel
): string {
  assertInRange(lon, lat);
  const p = Math.floor(lat * 1.5 + EPS);
  const u = Math.floor(lon + EPS) - 100;
  let code = `${String(p).padStart(2, "0")}${String(u).padStart(2, "0")}`;
  if (level === "1") return code;

  const q = Math.floor(lat * 12 + EPS) % 8;
  const v = Math.floor(lon * 8 + EPS) % 8;
  code += `${q}${v}`;
  if (level === "2") return code;

  const r = Math.floor(lat * 120 + EPS) % 10;
  const w = Math.floor(lon * 80 + EPS) % 10;
  code += `${r}${w}`;
  if (level === "3") return code;

  const depth = { half: 1, quarter: 2, eighth: 3 }[level];
  let latMul = 240;
  let lonMul = 160;
  for (let i = 0; i < depth; i++) {
    const latBit = Math.floor(lat * latMul + EPS) % 2;
    const lonBit = Math.floor(lon * lonMul + EPS) % 2;
    code += String(latBit * 2 + lonBit + 1);
    latMul *= 2;
    lonMul *= 2;
  }
  return code;
}

/** メッシュコードから南西端 [lonMin, latMin] を計算する */
export function codeToSouthWest(code: string): [number, number] {
  const level = levelOfCode(code);
  let latMin = parseInt(code.slice(0, 2), 10) / 1.5;
  let lonMin = parseInt(code.slice(2, 4), 10) + 100;
  if (level === "1") return [lonMin, latMin];

  latMin += parseInt(code[4], 10) / 12;
  lonMin += parseInt(code[5], 10) / 8;
  if (level === "2") return [lonMin, latMin];

  latMin += parseInt(code[6], 10) / 120;
  lonMin += parseInt(code[7], 10) / 80;
  if (level === "3") return [lonMin, latMin];

  let latSpan = 1 / 240;
  let lonSpan = 1 / 160;
  for (let i = 8; i < code.length; i++) {
    const d = parseInt(code[i], 10) - 1;
    if (d < 0 || d > 3) throw new Error(`無効なメッシュコードです: ${code}`);
    latMin += (d >> 1) * latSpan;
    lonMin += (d & 1) * lonSpan;
    latSpan /= 2;
    lonSpan /= 2;
  }
  return [lonMin, latMin];
}

function buildCell(code: string): GridCell {
  const level = levelOfCode(code);
  const { latSpan, lonSpan } = JISMESH_LEVELS[level];
  const [lonMin, latMin] = codeToSouthWest(code);
  const lonMax = lonMin + lonSpan;
  const latMax = latMin + latSpan;
  const ring: Position[] = [
    [lonMin, latMin],
    [lonMax, latMin],
    [lonMax, latMax],
    [lonMin, latMax],
    [lonMin, latMin],
  ];
  const center: [number, number] = [
    lonMin + lonSpan / 2,
    latMin + latSpan / 2,
  ];
  const widthM = distanceM([lonMin, center[1]], [lonMax, center[1]]);
  const heightM = distanceM([center[0], latMin], [center[0], latMax]);
  const idx = LEVEL_ORDER.indexOf(level);
  return {
    system: "jismesh",
    id: code,
    level,
    geometry: { type: "Polygon", coordinates: [ring] },
    center,
    areaM2: polygonAreaM2([ring]),
    widthM,
    heightM,
    parentId: idx > 0 ? parentOf(code) : undefined,
    childCount: level === "1" ? 64 : level === "2" ? 100 : level === "eighth" ? 0 : 4,
  };
}

function parentOf(code: string): string {
  const level = levelOfCode(code);
  const idx = LEVEL_ORDER.indexOf(level);
  if (idx === 0) throw new Error("1次メッシュに親はありません");
  const parentLevel = LEVEL_ORDER[idx - 1];
  return code.slice(0, JISMESH_LEVELS[parentLevel].codeLength);
}

function childrenOf(code: string): string[] {
  const level = levelOfCode(code);
  const idx = LEVEL_ORDER.indexOf(level);
  if (idx === LEVEL_ORDER.length - 1) return [];
  const childLevel = LEVEL_ORDER[idx + 1];
  const out: string[] = [];
  if (level === "1") {
    for (let q = 0; q < 8; q++)
      for (let v = 0; v < 8; v++) out.push(`${code}${q}${v}`);
  } else if (level === "2") {
    for (let r = 0; r < 10; r++)
      for (let w = 0; w < 10; w++) out.push(`${code}${r}${w}`);
  } else {
    for (let d = 1; d <= 4; d++) out.push(`${code}${d}`);
  }
  void childLevel;
  return out;
}

function neighborsOf(code: string): string[] {
  const level = levelOfCode(code);
  const { latSpan, lonSpan } = JISMESH_LEVELS[level];
  const [lonMin, latMin] = codeToSouthWest(code);
  const cLon = lonMin + lonSpan / 2;
  const cLat = latMin + latSpan / 2;
  const out: string[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      try {
        out.push(toMeshCode(cLon + dx * lonSpan, cLat + dy * latSpan, level));
      } catch {
        // 適用範囲外は無視
      }
    }
  }
  return out;
}

export const jismeshAdapter: GridAdapter = {
  system: "jismesh",
  displayName: "地域標準メッシュ",
  levels: [
    { value: "1", label: "1次メッシュ（約80km）" },
    { value: "2", label: "2次メッシュ（約10km）" },
    { value: "3", label: "3次メッシュ（約1km）" },
    { value: "half", label: "2分の1メッシュ（約500m）" },
    { value: "quarter", label: "4分の1メッシュ（約250m）" },
    { value: "eighth", label: "8分の1メッシュ（約125m）" },
  ],
  defaultLevel: "3",

  pointToCell(lon, lat, level) {
    return buildCell(toMeshCode(lon, lat, level as JismeshLevel));
  },

  cellToGeometry(id) {
    return buildCell(id);
  },

  getParent(id) {
    return levelOfCode(id) === "1" ? null : parentOf(id);
  },

  getChildren(id) {
    return childrenOf(id);
  },

  getNeighbors(id) {
    return neighborsOf(id);
  },

  cellsForBounds(bounds, level) {
    const [minLon, minLat, maxLon, maxLat] = bounds;
    const { latSpan, lonSpan } = JISMESH_LEVELS[level as JismeshLevel];
    const lat0 = Math.max(minLat, 0);
    const lat1 = Math.min(maxLat, 66.66 - latSpan / 2);
    const lon0 = Math.max(minLon, 100);
    const lon1 = Math.min(maxLon, 180 - lonSpan / 2);
    if (lat0 > lat1 || lon0 > lon1) return [];
    const cells: GridCell[] = [];
    const iMin = Math.floor(lat0 / latSpan + EPS);
    const iMax = Math.floor(lat1 / latSpan + EPS);
    const jMin = Math.floor(lon0 / lonSpan + EPS);
    const jMax = Math.floor(lon1 / lonSpan + EPS);
    if ((iMax - iMin + 1) * (jMax - jMin + 1) > 100000) {
      throw new Error("セル数が多すぎます。レベルを下げてください。");
    }
    for (let i = iMin; i <= iMax; i++) {
      for (let j = jMin; j <= jMax; j++) {
        const lat = (i + 0.5) * latSpan;
        const lon = (j + 0.5) * lonSpan;
        cells.push(
          buildCell(toMeshCode(lon, lat, level as JismeshLevel))
        );
      }
    }
    return cells;
  },
};
