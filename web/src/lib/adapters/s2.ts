/**
 * S2 アダプター（s2js ラッパー）。
 * ID形式: S2セルトークン（16進、例 "60188bfc"）。レベル 0-30。
 *
 * セル辺は大円のため、各辺を SUBDIV 分割して球面上を補間した頂点列で
 * ポリゴンを近似する。QGIS版 adapters/s2.py と同一の分割数・同一の
 * 面積アルゴリズムを使い、計算結果を一致させる（指示書 §16）。
 */

import { s2 } from "s2js";
import type { GridAdapter, GridCell, Position } from "../types";
import { distanceM, polygonAreaM2 } from "../geo";

const { cellid, Cell, LatLng } = s2;

const R2D = 180 / Math.PI;

/** 1辺あたりの分割数（QGIS版と同値にすること） */
export const SUBDIV = 4;

const MAX_LEVEL = 30;

function tokenToId(token: string): bigint {
  const id = cellid.fromToken(token.trim());
  if (!cellid.valid(id)) throw new Error(`無効なS2セルトークンです: ${token}`);
  return id;
}

/** 球面上の2点間を弦補間して正規化（両実装で同一の近似） */
function interpolate(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
  t: number
): [number, number] {
  const x = a.x + (b.x - a.x) * t;
  const y = a.y + (b.y - a.y) * t;
  const z = a.z + (b.z - a.z) * t;
  const n = Math.sqrt(x * x + y * y + z * z);
  const lat = Math.asin(Math.max(-1, Math.min(1, z / n))) * R2D;
  const lng = Math.atan2(y, x) * R2D;
  return [lng, lat];
}

function unwrapRing(ring: Position[], centerLon: number): Position[] {
  return ring.map(([lon, lat]) => {
    let x = lon;
    while (x - centerLon > 180) x -= 360;
    while (x - centerLon < -180) x += 360;
    return [x, lat] as Position;
  });
}

/** セル境界リング（辺を SUBDIV 分割、閉じたリング） */
export function cellRing(id: bigint): Position[] {
  const cell = Cell.fromCellID(id);
  const verts = [0, 1, 2, 3].map((k) => {
    const v = cell.vertex(k) as unknown as {
      vector: { x: number; y: number; z: number };
    };
    return v.vector;
  });
  const ring: Position[] = [];
  for (let k = 0; k < 4; k++) {
    const a = verts[k];
    const b = verts[(k + 1) % 4];
    for (let i = 0; i < SUBDIV; i++) {
      ring.push(interpolate(a, b, i / SUBDIV));
    }
  }
  ring.push(ring[0]);
  const c = cellid.latLng(id) as unknown as { lat: number; lng: number };
  return unwrapRing(ring, c.lng * R2D);
}

function buildCell(id: bigint): GridCell {
  const level = cellid.level(id);
  const c = cellid.latLng(id) as unknown as { lat: number; lng: number };
  const center: [number, number] = [c.lng * R2D, c.lat * R2D];
  const ring = cellRing(id);
  // 4頂点間の測地距離の平均を辺長とする
  let edgeSum = 0;
  for (let k = 0; k < 4; k++) {
    edgeSum += distanceM(ring[k * SUBDIV], ring[((k + 1) % 4) * SUBDIV]);
  }
  return {
    system: "s2",
    id: cellid.toToken(id),
    level,
    geometry: { type: "Polygon", coordinates: [ring] },
    center,
    areaM2: polygonAreaM2([ring]),
    edgeLengthM: edgeSum / 4,
    parentId:
      level > 0 ? cellid.toToken(cellid.parent(id, level - 1)) : undefined,
    childCount: level < MAX_LEVEL ? 4 : 0,
  };
}

function ringBounds(ring: Position[]): [number, number, number, number] {
  let minLon = Infinity,
    minLat = Infinity,
    maxLon = -Infinity,
    maxLat = -Infinity;
  for (const [lon, lat] of ring) {
    if (lon < minLon) minLon = lon;
    if (lat < minLat) minLat = lat;
    if (lon > maxLon) maxLon = lon;
    if (lat > maxLat) maxLat = lat;
  }
  return [minLon, minLat, maxLon, maxLat];
}

function boxesIntersect(
  a: [number, number, number, number],
  b: [number, number, number, number]
): boolean {
  // 経度は±360ずらしても判定（アンラップ済みリング対策）
  const lonOverlap = [-360, 0, 360].some(
    (s) => a[0] + s <= b[2] && a[2] + s >= b[0]
  );
  return lonOverlap && a[1] <= b[3] && a[3] >= b[1];
}

/**
 * 範囲内セルの列挙: 中心セルから辺隣接をBFSで辿り、
 * 境界矩形が範囲と交差するセルを集める（RegionCoverer非依存の共通実装）。
 */
function cellsForBox(
  box: [number, number, number, number],
  level: number,
  collected: Map<string, GridCell>,
  maxCells: number
): void {
  const [minLon, minLat, maxLon, maxLat] = box;
  const seed = cellid.parent(
    cellid.fromLatLng(
      LatLng.fromDegrees((minLat + maxLat) / 2, (minLon + maxLon) / 2)
    ),
    level
  );
  const queue: bigint[] = [seed];
  const visited = new Set<string>([cellid.toToken(seed)]);
  while (queue.length) {
    const id = queue.shift()!;
    const cell = buildCell(id);
    const ring = cell.geometry.coordinates[0] as Position[];
    if (!boxesIntersect(ringBounds(ring), box)) continue;
    collected.set(cell.id, cell);
    if (collected.size > maxCells) {
      throw new Error("セル数が多すぎます。レベルを下げてください。");
    }
    for (const n of cellid.edgeNeighbors(id)) {
      const token = cellid.toToken(n);
      if (!visited.has(token)) {
        visited.add(token);
        queue.push(n);
      }
    }
  }
}

const LEVELS = Array.from({ length: MAX_LEVEL + 1 }, (_, lv) => ({
  value: lv,
  label: `level ${lv}`,
}));

export const s2Adapter: GridAdapter = {
  system: "s2",
  displayName: "S2",
  levels: LEVELS,
  defaultLevel: 13,

  pointToCell(lon, lat, level) {
    const leaf = cellid.fromLatLng(LatLng.fromDegrees(lat, lon));
    return buildCell(cellid.parent(leaf, Number(level)));
  },

  cellToGeometry(id) {
    return buildCell(tokenToId(id));
  },

  getParent(id) {
    const cid = tokenToId(id);
    const level = cellid.level(cid);
    return level > 0 ? cellid.toToken(cellid.parent(cid, level - 1)) : null;
  },

  getChildren(id) {
    const cid = tokenToId(id);
    if (cellid.level(cid) >= MAX_LEVEL) return [];
    return cellid.children(cid).map((c: bigint) => cellid.toToken(c));
  },

  getNeighbors(id) {
    return cellid
      .edgeNeighbors(tokenToId(id))
      .map((c: bigint) => cellid.toToken(c));
  },

  cellsForBounds(bounds, level) {
    const [minLon, minLat, maxLon, maxLat] = bounds;
    const collected = new Map<string, GridCell>();
    const boxes: [number, number, number, number][] =
      minLon <= maxLon
        ? [[minLon, minLat, maxLon, maxLat]]
        : [
            // 国際日付変更線をまたぐ範囲は分割する
            [minLon, minLat, 180, maxLat],
            [-180, minLat, maxLon, maxLat],
          ];
    for (const box of boxes) {
      cellsForBox(box, Number(level), collected, 100000);
    }
    return [...collected.values()];
  },
};
