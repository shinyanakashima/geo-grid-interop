/**
 * Geohash アダプター（ngeohash ラッパー）。
 * ID形式: base32文字列（例 "xn76ur"）。レベル = 文字数 1-12。
 * セルは経緯度矩形。QGIS版 adapters/geohash.py と同一仕様。
 */

import ngeohash from "ngeohash";
import type { GridAdapter, GridCell, Position } from "../types";
import { distanceM, polygonAreaM2 } from "../geo";

export const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

const VALID_RE = /^[0123456789bcdefghjkmnpqrstuvwxyz]{1,12}$/;

function assertValid(id: string): string {
  const hash = id.trim().toLowerCase();
  if (!VALID_RE.test(hash)) {
    throw new Error(`無効なGeohashです: ${id}`);
  }
  return hash;
}

function buildCell(hash: string): GridCell {
  // decode_bbox: [minLat, minLon, maxLat, maxLon]
  const [minLat, minLon, maxLat, maxLon] = ngeohash.decode_bbox(hash);
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
  return {
    system: "geohash",
    id: hash,
    level: hash.length,
    geometry: { type: "Polygon", coordinates: [ring] },
    center,
    areaM2: polygonAreaM2([ring]),
    widthM: distanceM([minLon, center[1]], [maxLon, center[1]]),
    heightM: distanceM([center[0], minLat], [center[0], maxLat]),
    parentId: hash.length > 1 ? hash.slice(0, -1) : undefined,
    childCount: hash.length < 12 ? 32 : 0,
  };
}

const LEVELS = Array.from({ length: 12 }, (_, i) => ({
  value: i + 1,
  label: `length ${i + 1}`,
}));

export const geohashAdapter: GridAdapter = {
  system: "geohash",
  displayName: "Geohash",
  levels: LEVELS,
  defaultLevel: 6,

  pointToCell(lon, lat, level) {
    return buildCell(ngeohash.encode(lat, lon, Number(level)));
  },

  cellToGeometry(id) {
    return buildCell(assertValid(id));
  },

  getParent(id) {
    const hash = assertValid(id);
    return hash.length > 1 ? hash.slice(0, -1) : null;
  },

  getChildren(id) {
    const hash = assertValid(id);
    if (hash.length >= 12) return [];
    return [...BASE32].map((ch) => hash + ch);
  },

  getNeighbors(id) {
    return ngeohash.neighbors(assertValid(id));
  },

  cellsForBounds(bounds, level) {
    const [minLon, minLat, maxLon, maxLat] = bounds;
    const precision = Number(level);
    const lat0 = Math.max(minLat, -90);
    const lat1 = Math.min(maxLat, 90);
    const ranges: [number, number][] =
      minLon <= maxLon
        ? [[minLon, maxLon]]
        : [
            // 国際日付変更線をまたぐ範囲は分割する
            [minLon, 180],
            [-180, maxLon],
          ];
    const out = new Map<string, GridCell>();
    for (const [lon0, lon1] of ranges) {
      const hashes = ngeohash.bboxes(lat0, lon0, lat1, lon1, precision);
      if (out.size + hashes.length > 100000) {
        throw new Error("セル数が多すぎます。レベルを下げてください。");
      }
      for (const h of hashes) {
        if (!out.has(h)) out.set(h, buildCell(h));
      }
    }
    return [...out.values()];
  },
};
