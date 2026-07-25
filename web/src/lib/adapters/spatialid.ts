/**
 * 空間ID（3次元空間情報基盤 / ZFXY）アダプター。
 * ID形式: "/z/f/x/y"（f は鉛直インデックス。MVPでは水平セルとして f=0 を扱う）
 *
 * 水平方向の境界は XYZ タイルと一致する。鉛直方向はズームレベル z における
 * 1ボクセルの高さを 2^(25-z) m とする（国土交通省 空間ID仕様に準拠）。
 */

import type { GridAdapter, GridCell } from "../types";
import {
  buildTileCell,
  latToTileY,
  lonToTileX,
  tilesForBounds,
  WEB_MERCATOR_MAX_LAT,
} from "./xyz";

export function parseSpatialId(id: string): {
  z: number;
  f: number;
  x: number;
  y: number;
} {
  const m = id.trim().match(/^\/?(\d+)\/(-?\d+)\/(\d+)\/(\d+)$/);
  if (!m) throw new Error(`無効な空間IDです: ${id}`);
  const z = parseInt(m[1], 10);
  const f = parseInt(m[2], 10);
  const x = parseInt(m[3], 10);
  const y = parseInt(m[4], 10);
  const n = 2 ** z;
  if (x < 0 || x >= n || y < 0 || y >= n) {
    throw new Error(`無効な空間IDです: ${id}`);
  }
  return { z, f, x, y };
}

export function heightToF(heightM: number, z: number): number {
  return Math.floor(heightM / 2 ** (25 - z));
}

const ZOOM_LEVELS = Array.from({ length: 21 }, (_, z) => ({
  value: z,
  label: `zoom ${z}`,
}));

export const spatialIdAdapter: GridAdapter = {
  system: "spatial-id",
  displayName: "空間ID",
  levels: ZOOM_LEVELS,
  defaultLevel: 14,

  pointToCell(lon, lat, level, heightM = 0) {
    const z = Number(level);
    if (Math.abs(lat) > WEB_MERCATOR_MAX_LAT) {
      throw new Error("空間IDは緯度±85.05°を超える範囲に対応していません");
    }
    const f = heightToF(heightM, z);
    return buildTileCell(z, lonToTileX(lon, z), latToTileY(lat, z), "spatial-id", f);
  },

  cellToGeometry(id) {
    const { z, f, x, y } = parseSpatialId(id);
    return buildTileCell(z, x, y, "spatial-id", f);
  },

  getParent(id) {
    const { z, f, x, y } = parseSpatialId(id);
    return z > 0 ? `/${z - 1}/${f >> 1}/${x >> 1}/${y >> 1}` : null;
  },

  getChildren(id) {
    const { z, f, x, y } = parseSpatialId(id);
    if (z >= 30) return [];
    const cz = z + 1;
    const out: string[] = [];
    for (const cf of [f * 2, f * 2 + 1]) {
      for (const cx of [x * 2, x * 2 + 1]) {
        for (const cy of [y * 2, y * 2 + 1]) {
          out.push(`/${cz}/${cf}/${cx}/${cy}`);
        }
      }
    }
    return out;
  },

  getNeighbors(id) {
    const { z, f, x, y } = parseSpatialId(id);
    const n = 2 ** z;
    const out: string[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const ny = y + dy;
        if (ny < 0 || ny >= n) continue;
        const nx = (((x + dx) % n) + n) % n;
        out.push(`/${z}/${f}/${nx}/${ny}`);
      }
    }
    return out;
  },

  cellsForBounds(bounds, level) {
    const z = Number(level);
    return tilesForBounds(bounds, z).map(({ x, y }) =>
      buildTileCell(z, x, y, "spatial-id", 0)
    );
  },
};

/** GridCell を deck.gl 等での3D押し出し表示に使うための高さ情報 */
export function voxelHeights(cell: GridCell): {
  minHeightM: number;
  maxHeightM: number;
} {
  return {
    minHeightM: cell.minHeightM ?? 0,
    maxHeightM: cell.maxHeightM ?? 0,
  };
}
