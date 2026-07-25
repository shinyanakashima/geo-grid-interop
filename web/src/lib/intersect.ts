/**
 * グリッド間の交差・包含関係計算（指示書 §9, §12.2）。
 */

import polygonClipping from "polygon-clipping";
import type {
  GridCell,
  GridIntersection,
  GridSystem,
  Position,
  SpatialRelation,
} from "./types";
import { getAdapter } from "./adapters";
import { multiPolygonAreaM2 } from "./geo";

type Ring = Position[];
type Poly = Ring[];
type MultiPoly = Poly[];

function toMultiPoly(cell: GridCell): MultiPoly {
  return cell.geometry.type === "Polygon"
    ? [cell.geometry.coordinates as Poly]
    : (cell.geometry.coordinates as MultiPoly);
}

/** 交差面積の相対誤差がこの範囲なら包含・一致とみなす */
const RATIO_EPS = 1e-6;

export function classifyRelation(
  intersectionArea: number,
  sourceArea: number,
  targetArea: number
): SpatialRelation {
  if (intersectionArea <= 0) return "touches";
  const srcRatio = intersectionArea / sourceArea;
  const tgtRatio = intersectionArea / targetArea;
  if (srcRatio >= 1 - RATIO_EPS && tgtRatio >= 1 - RATIO_EPS) return "equal";
  if (tgtRatio >= 1 - RATIO_EPS) return "contains"; // source が target を包含
  if (srcRatio >= 1 - RATIO_EPS) return "within"; // source が target に包含
  return "overlaps";
}

export function intersectCells(
  source: GridCell,
  target: GridCell
): GridIntersection | null {
  const result = polygonClipping.intersection(
    toMultiPoly(source) as never,
    toMultiPoly(target) as never
  ) as unknown as MultiPoly;
  const area = result.length ? multiPolygonAreaM2(result) : 0;
  if (area <= 0) return null;
  return {
    sourceSystem: source.system,
    sourceId: source.id,
    targetSystem: target.system,
    targetId: target.id,
    intersectionAreaM2: area,
    sourceAreaM2: source.areaM2,
    targetAreaM2: target.areaM2,
    sourceRatio: area / source.areaM2,
    targetRatio: area / target.areaM2,
    relation: classifyRelation(area, source.areaM2, target.areaM2),
  };
}

function cellBounds(cell: GridCell): [number, number, number, number] {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const poly of toMultiPoly(cell)) {
    for (const [lon, lat] of poly[0]) {
      if (lon < minLon) minLon = lon;
      if (lat < minLat) minLat = lat;
      if (lon > maxLon) maxLon = lon;
      if (lat > maxLat) maxLat = lat;
    }
  }
  return [minLon, minLat, maxLon, maxLat];
}

export interface CorrespondenceResult {
  targetSystem: GridSystem;
  targetLevel: number | string;
  intersections: GridIntersection[];
  targetCells: GridCell[];
  /** 交差セル数 */
  intersectCount: number;
  /** 基準セルに完全包含されるセル数 */
  containedCount: number;
  /** 境界交差セル数 */
  boundaryCount: number;
  /** 基準セルに対する面積比の合計（≒1 が理想） */
  ratioSum: number;
  /** 100% からの計算誤差 */
  ratioError: number;
}

/**
 * 基準セルと交差する targetSystem/level のセルをすべて求め、
 * 包含・交差の統計を計算する（モード2: セル対応確認）。
 */
export function computeCorrespondence(
  base: GridCell,
  targetSystem: GridSystem,
  targetLevel: number | string,
  maxCells = 10000
): CorrespondenceResult {
  const adapter = getAdapter(targetSystem);
  const candidates = adapter.cellsForBounds(cellBounds(base), targetLevel);
  if (candidates.length > maxCells) {
    throw new Error(
      `交差計算対象が ${candidates.length} セルあり上限 ${maxCells} を超えます。レベルを下げてください。`
    );
  }
  const intersections: GridIntersection[] = [];
  const targetCells: GridCell[] = [];
  for (const cell of candidates) {
    const ix = intersectCells(base, cell);
    if (ix) {
      intersections.push(ix);
      targetCells.push(cell);
    }
  }
  const containedCount = intersections.filter(
    (i) => i.relation === "contains" || i.relation === "equal"
  ).length;
  const ratioSum = intersections.reduce((s, i) => s + i.sourceRatio, 0);
  return {
    targetSystem,
    targetLevel,
    intersections,
    targetCells,
    intersectCount: intersections.length,
    containedCount,
    boundaryCount: intersections.length - containedCount,
    ratioSum,
    ratioError: Math.abs(1 - ratioSum),
  };
}

/**
 * 面積一致モード（指示書 §8.7）:
 * 指定地点における基準セル面積に最も近いセル面積を持つレベルを選ぶ。
 * 固定対応表ではなく、クリック位置の実セル面積で判定する。
 */
export function levelByAreaMatch(
  targetSystem: GridSystem,
  lon: number,
  lat: number,
  referenceAreaM2: number
): number | string {
  const adapter = getAdapter(targetSystem);
  let best: number | string = adapter.defaultLevel;
  let bestDiff = Infinity;
  for (const { value } of adapter.levels) {
    let cell: GridCell;
    try {
      cell = adapter.pointToCell(lon, lat, value);
    } catch {
      continue;
    }
    const diff = Math.abs(Math.log(cell.areaM2 / referenceAreaM2));
    if (diff < bestDiff) {
      bestDiff = diff;
      best = value;
    }
  }
  return best;
}
