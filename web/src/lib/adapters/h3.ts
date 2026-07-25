/**
 * H3 アダプター（h3-js ラッパー）。
 * レベル = H3 resolution (0-15)。
 */

import {
  cellToBoundary,
  cellToChildren,
  cellToLatLng,
  cellToParent,
  cellsToMultiPolygon,
  getHexagonEdgeLengthAvg,
  getResolution,
  gridDisk,
  isValidCell,
  latLngToCell,
  polygonToCells,
  UNITS,
} from "h3-js";
import type { GridAdapter, GridCell, Position } from "../types";
import { distanceM, polygonAreaM2 } from "../geo";

/** 境界リングを中心経度基準でアンラップ（日付変更線対策） */
function unwrapRing(ring: Position[], centerLon: number): Position[] {
  return ring.map(([lon, lat]) => {
    let x = lon;
    while (x - centerLon > 180) x -= 360;
    while (x - centerLon < -180) x += 360;
    return [x, lat] as Position;
  });
}

function buildCell(id: string): GridCell {
  if (!isValidCell(id)) throw new Error(`無効なH3セルIDです: ${id}`);
  const res = getResolution(id);
  const [lat, lng] = cellToLatLng(id);
  // formatAsGeoJson=true: [lng, lat] 形式・閉じたリング
  const boundary = cellToBoundary(id, true) as Position[];
  const ring = unwrapRing(boundary, lng);
  let edgeSum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    edgeSum += distanceM(ring[i], ring[i + 1]);
  }
  return {
    system: "h3",
    id,
    level: res,
    geometry: { type: "Polygon", coordinates: [ring] },
    center: [lng, lat],
    areaM2: polygonAreaM2([ring]),
    edgeLengthM: edgeSum / (ring.length - 1),
    parentId: res > 0 ? cellToParent(id, res - 1) : undefined,
    childCount: res < 15 ? cellToChildren(id, res + 1).length : 0,
  };
}

const RESOLUTIONS = Array.from({ length: 16 }, (_, r) => ({
  value: r,
  label: `resolution ${r}`,
}));

export const h3Adapter: GridAdapter = {
  system: "h3",
  displayName: "H3",
  levels: RESOLUTIONS,
  defaultLevel: 8,

  pointToCell(lon, lat, level) {
    return buildCell(latLngToCell(lat, lon, Number(level)));
  },

  cellToGeometry(id) {
    return buildCell(id);
  },

  getParent(id) {
    const res = getResolution(id);
    return res > 0 ? cellToParent(id, res - 1) : null;
  },

  getChildren(id) {
    const res = getResolution(id);
    return res < 15 ? cellToChildren(id, res + 1) : [];
  },

  getNeighbors(id) {
    return gridDisk(id, 1).filter((h) => h !== id);
  },

  cellsForBounds(bounds, level) {
    const res = Number(level);
    const [minLon, minLat, maxLon, maxLat] = bounds;
    // polygonToCells はセル中心がポリゴン内のセルのみ返すため、
    // セル辺長の約3倍だけ範囲を拡張して境界セルの欠落を防ぐ。
    const edgeM = getHexagonEdgeLengthAvg(res, UNITS.m);
    const midLat = (minLat + maxLat) / 2;
    const padLat = (edgeM * 3) / 111320;
    const padLon = padLat / Math.max(Math.cos((midLat * Math.PI) / 180), 0.1);
    const lat0 = Math.max(minLat - padLat, -90);
    const lat1 = Math.min(maxLat + padLat, 90);
    const lon0 = minLon - padLon;
    const lon1 = maxLon + padLon;
    // polygonToCells は [lat, lng] 順
    const poly = [
      [
        [lat0, lon0],
        [lat0, lon1],
        [lat1, lon1],
        [lat1, lon0],
        [lat0, lon0],
      ],
    ];
    const ids = polygonToCells(poly, res);
    if (ids.length > 100000) {
      throw new Error("セル数が多すぎます。解像度を下げてください。");
    }
    return ids.map(buildCell);
  },
};

export { cellsToMultiPolygon };
