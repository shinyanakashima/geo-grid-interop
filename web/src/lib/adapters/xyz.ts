/**
 * XYZタイル（スリッピーマップタイル）アダプター。独自実装。
 * ID形式: "z/x/y"
 */

import type { GridAdapter, GridCell, Position } from "../types";
import { distanceM, polygonAreaM2 } from "../geo";

export const WEB_MERCATOR_MAX_LAT = 85.0511287798066;

export function lonToTileX(lon: number, z: number): number {
  const n = 2 ** z;
  let x = Math.floor(((lon + 180) / 360) * n);
  if (x < 0) x += n;
  if (x >= n) x -= n;
  return x;
}

export function latToTileY(lat: number, z: number): number {
  const clamped = Math.max(
    -WEB_MERCATOR_MAX_LAT,
    Math.min(WEB_MERCATOR_MAX_LAT, lat)
  );
  const rad = (clamped * Math.PI) / 180;
  const n = 2 ** z;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n
  );
  return Math.max(0, Math.min(n - 1, y));
}

export function tileXToLon(x: number, z: number): number {
  return (x / 2 ** z) * 360 - 180;
}

export function tileYToLat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

export function parseTileId(id: string): { z: number; x: number; y: number } {
  const m = id.trim().match(/^(\d+)[/](\d+)[/](\d+)$/);
  if (!m) throw new Error(`無効なタイルIDです: ${id}`);
  const z = parseInt(m[1], 10);
  const x = parseInt(m[2], 10);
  const y = parseInt(m[3], 10);
  const n = 2 ** z;
  if (x < 0 || x >= n || y < 0 || y >= n) {
    throw new Error(`無効なタイルIDです: ${id}`);
  }
  return { z, x, y };
}

export function tileBounds(
  z: number,
  x: number,
  y: number
): [number, number, number, number] {
  return [
    tileXToLon(x, z),
    tileYToLat(y + 1, z),
    tileXToLon(x + 1, z),
    tileYToLat(y, z),
  ];
}

export function buildTileCell(
  z: number,
  x: number,
  y: number,
  system: "xyz" | "spatial-id" = "xyz",
  f = 0
): GridCell {
  const [minLon, minLat, maxLon, maxLat] = tileBounds(z, x, y);
  const ring: Position[] = [
    [minLon, minLat],
    [maxLon, minLat],
    [maxLon, maxLat],
    [minLon, maxLat],
    [minLon, minLat],
  ];
  const center: [number, number] = [
    (minLon + maxLon) / 2,
    (minLat + maxLat) / 2,
  ];
  const cell: GridCell = {
    system,
    id: system === "xyz" ? `${z}/${x}/${y}` : `/${z}/${f}/${x}/${y}`,
    level: z,
    geometry: { type: "Polygon", coordinates: [ring] },
    center,
    areaM2: polygonAreaM2([ring]),
    widthM: distanceM([minLon, center[1]], [maxLon, center[1]]),
    heightM: distanceM([center[0], minLat], [center[0], maxLat]),
    parentId:
      z > 0
        ? system === "xyz"
          ? `${z - 1}/${x >> 1}/${y >> 1}`
          : `/${z - 1}/${f >> 1}/${x >> 1}/${y >> 1}`
        : undefined,
    childCount: system === "xyz" ? 4 : 8,
  };
  if (system === "spatial-id") {
    // 空間IDの鉛直方向: ズームレベル z の1ボクセルの高さは 2^(25-z) m
    const voxelH = 2 ** (25 - z);
    cell.minHeightM = f * voxelH;
    cell.maxHeightM = (f + 1) * voxelH;
    cell.metadata = { f };
  }
  return cell;
}

export function tilesForBounds(
  bounds: [number, number, number, number],
  z: number
): { x: number; y: number }[] {
  const [minLon, minLat, maxLon, maxLat] = bounds;
  const xMin = lonToTileX(Math.max(minLon, -179.9999999), z);
  const xMax = lonToTileX(Math.min(maxLon, 179.9999999), z);
  const yMin = latToTileY(Math.min(maxLat, WEB_MERCATOR_MAX_LAT), z);
  const yMax = latToTileY(Math.max(minLat, -WEB_MERCATOR_MAX_LAT), z);
  const n = 2 ** z;
  const xs: number[] = [];
  if (xMin <= xMax) {
    for (let x = xMin; x <= xMax; x++) xs.push(x);
  } else {
    // 国際日付変更線をまたぐ範囲
    for (let x = xMin; x < n; x++) xs.push(x);
    for (let x = 0; x <= xMax; x++) xs.push(x);
  }
  const out: { x: number; y: number }[] = [];
  if (xs.length * (yMax - yMin + 1) > 100000) {
    throw new Error("セル数が多すぎます。ズームレベルを下げてください。");
  }
  for (const x of xs) {
    for (let y = yMin; y <= yMax; y++) out.push({ x, y });
  }
  return out;
}

const ZOOM_LEVELS = Array.from({ length: 21 }, (_, z) => ({
  value: z,
  label: `zoom ${z}`,
}));

export const xyzAdapter: GridAdapter = {
  system: "xyz",
  displayName: "XYZタイル",
  levels: ZOOM_LEVELS,
  defaultLevel: 14,

  pointToCell(lon, lat, level) {
    const z = Number(level);
    if (Math.abs(lat) > WEB_MERCATOR_MAX_LAT) {
      throw new Error("XYZタイルは緯度±85.05°を超える範囲に対応していません");
    }
    return buildTileCell(z, lonToTileX(lon, z), latToTileY(lat, z));
  },

  cellToGeometry(id) {
    const { z, x, y } = parseTileId(id);
    return buildTileCell(z, x, y);
  },

  getParent(id) {
    const { z, x, y } = parseTileId(id);
    return z > 0 ? `${z - 1}/${x >> 1}/${y >> 1}` : null;
  },

  getChildren(id) {
    const { z, x, y } = parseTileId(id);
    if (z >= 30) return [];
    const cz = z + 1;
    return [
      `${cz}/${x * 2}/${y * 2}`,
      `${cz}/${x * 2 + 1}/${y * 2}`,
      `${cz}/${x * 2}/${y * 2 + 1}`,
      `${cz}/${x * 2 + 1}/${y * 2 + 1}`,
    ];
  },

  getNeighbors(id) {
    const { z, x, y } = parseTileId(id);
    const n = 2 ** z;
    const out: string[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const ny = y + dy;
        if (ny < 0 || ny >= n) continue;
        const nx = (((x + dx) % n) + n) % n; // 経度方向はラップ
        out.push(`${z}/${nx}/${ny}`);
      }
    }
    return out;
  },

  cellsForBounds(bounds, level) {
    const z = Number(level);
    return tilesForBounds(bounds, z).map(({ x, y }) => buildTileCell(z, x, y));
  },
};
