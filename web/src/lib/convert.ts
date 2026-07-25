/**
 * グリッド変換（モード3、指示書 §10）。
 */

import type { GridCell, GridIntersection, GridSystem } from "./types";
import { getAdapter } from "./adapters";
import { computeCorrespondence, intersectCells } from "./intersect";

export type ConversionMethod =
  | "centroid" // 重心割当
  | "largest-overlap" // 最大重複面積
  | "areal-weighted" // 面積按分
  | "all-intersections" // 全交差セルへ関連付け
  | "within-only" // 完全包含セルのみ
  | "threshold"; // 閾値指定

export type RoundingMethod =
  | "none" // 小数のまま
  | "round" // 四捨五入
  | "largest-remainder"; // 最大剰余法（合計値を維持する整数配分）

export interface ConversionOptions {
  targetSystem: GridSystem;
  targetLevel: number | string;
  method: ConversionMethod;
  /** method === "threshold" のとき: 最低交差率 (0-1) */
  minSourceRatio?: number;
  rounding?: RoundingMethod;
}

export interface ConversionRecord {
  sourceSystem: GridSystem;
  sourceId: string;
  sourceLevel: number | string;
  targetSystem: GridSystem;
  targetId: string;
  targetLevel: number | string;
  intersectionAreaM2: number;
  sourceAreaM2: number;
  targetAreaM2: number;
  sourceRatio: number;
  targetRatio: number;
  /** 元属性値（面積按分対象） */
  sourceValue?: number;
  /** 変換後属性値 */
  targetValue?: number;
  method: ConversionMethod;
  /** 面積按分等による推計値かどうか */
  isEstimated: boolean;
  /** 変換先セルの geometry (GeoJSON) */
  geometry?: GridCell["geometry"];
  convertedAt: string;
}

/** 1つの変換元セルを変換する */
export function convertCell(
  source: GridCell,
  options: ConversionOptions,
  value?: number
): ConversionRecord[] {
  const { targetSystem, targetLevel, method } = options;
  const adapter = getAdapter(targetSystem);
  const convertedAt = new Date().toISOString();

  const toRecord = (
    ix: GridIntersection,
    cell: GridCell,
    targetValue?: number,
    isEstimated = false
  ): ConversionRecord => ({
    sourceSystem: source.system,
    sourceId: source.id,
    sourceLevel: source.level,
    targetSystem,
    targetId: ix.targetId,
    targetLevel,
    intersectionAreaM2: ix.intersectionAreaM2,
    sourceAreaM2: ix.sourceAreaM2,
    targetAreaM2: ix.targetAreaM2,
    sourceRatio: ix.sourceRatio,
    targetRatio: ix.targetRatio,
    sourceValue: value,
    targetValue,
    method,
    isEstimated,
    geometry: cell.geometry,
    convertedAt,
  });

  if (method === "centroid") {
    const cell = adapter.pointToCell(source.center[0], source.center[1], targetLevel);
    const ix = intersectCells(source, cell) ?? {
      sourceSystem: source.system,
      sourceId: source.id,
      targetSystem,
      targetId: cell.id,
      intersectionAreaM2: 0,
      sourceAreaM2: source.areaM2,
      targetAreaM2: cell.areaM2,
      sourceRatio: 0,
      targetRatio: 0,
      relation: "touches" as const,
    };
    return [toRecord(ix, cell, value, false)];
  }

  const corr = computeCorrespondence(source, targetSystem, targetLevel);
  const pairs = corr.intersections.map((ix, i) => ({
    ix,
    cell: corr.targetCells[i],
  }));

  switch (method) {
    case "largest-overlap": {
      const best = pairs.reduce((a, b) =>
        b.ix.intersectionAreaM2 > a.ix.intersectionAreaM2 ? b : a
      );
      return [toRecord(best.ix, best.cell, value, false)];
    }
    case "areal-weighted": {
      const records = pairs.map(({ ix, cell }) =>
        toRecord(
          ix,
          cell,
          value !== undefined ? value * ix.sourceRatio : undefined,
          true
        )
      );
      return records;
    }
    case "all-intersections":
      return pairs.map(({ ix, cell }) => toRecord(ix, cell, value, false));
    case "within-only":
      return pairs
        .filter(
          ({ ix }) => ix.relation === "contains" || ix.relation === "equal"
        )
        .map(({ ix, cell }) => toRecord(ix, cell, value, false));
    case "threshold": {
      const min = options.minSourceRatio ?? 0.01;
      return pairs
        .filter(({ ix }) => ix.sourceRatio >= min)
        .map(({ ix, cell }) => toRecord(ix, cell, value, false));
    }
    default:
      throw new Error(`未対応の変換方法です: ${method}`);
  }
}

/**
 * 整数化（指示書 §10.5）。
 * "largest-remainder" は変換元セル単位で合計値を維持する。
 */
export function applyRounding(
  records: ConversionRecord[],
  rounding: RoundingMethod
): ConversionRecord[] {
  if (rounding === "none") return records;
  if (rounding === "round") {
    return records.map((r) =>
      r.targetValue === undefined
        ? r
        : { ...r, targetValue: Math.round(r.targetValue) }
    );
  }
  // 最大剰余法: 変換元セルごとにグループ化し、合計を維持して整数配分
  const groups = new Map<string, ConversionRecord[]>();
  for (const r of records) {
    const key = `${r.sourceSystem}:${r.sourceId}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
  }
  const out: ConversionRecord[] = [];
  for (const group of groups.values()) {
    const withValue = group.filter((r) => r.targetValue !== undefined);
    if (!withValue.length) {
      out.push(...group);
      continue;
    }
    const total = Math.round(
      withValue.reduce((s, r) => s + (r.targetValue ?? 0), 0)
    );
    const floors = withValue.map((r) => Math.floor(r.targetValue ?? 0));
    let remainder = total - floors.reduce((s, v) => s + v, 0);
    const order = withValue
      .map((r, i) => ({ i, frac: (r.targetValue ?? 0) - floors[i] }))
      .sort((a, b) => b.frac - a.frac);
    const assigned = [...floors];
    for (const { i } of order) {
      if (remainder <= 0) break;
      assigned[i] += 1;
      remainder -= 1;
    }
    withValue.forEach((r, i) => out.push({ ...r, targetValue: assigned[i] }));
    out.push(...group.filter((r) => r.targetValue === undefined));
  }
  return out;
}

/** ConversionRecord[] → CSV 文字列（指示書 §10.6） */
export function recordsToCsv(records: ConversionRecord[]): string {
  const header = [
    "source_system",
    "source_id",
    "source_level",
    "target_system",
    "target_id",
    "target_level",
    "intersection_area_m2",
    "source_area_m2",
    "target_area_m2",
    "source_ratio",
    "target_ratio",
    "source_value",
    "target_value",
    "method",
    "is_estimated",
    "converted_at",
  ];
  const lines = [header.join(",")];
  for (const r of records) {
    lines.push(
      [
        r.sourceSystem,
        r.sourceId,
        r.sourceLevel,
        r.targetSystem,
        r.targetId,
        r.targetLevel,
        r.intersectionAreaM2.toFixed(2),
        r.sourceAreaM2.toFixed(2),
        r.targetAreaM2.toFixed(2),
        r.sourceRatio.toFixed(6),
        r.targetRatio.toFixed(6),
        r.sourceValue ?? "",
        r.targetValue ?? "",
        r.method,
        r.isEstimated,
        r.convertedAt,
      ].join(",")
    );
  }
  return lines.join("\n");
}

/** ConversionRecord[] → GeoJSON FeatureCollection */
export function recordsToGeoJson(records: ConversionRecord[]): string {
  const features = records.map((r) => {
    const { geometry, ...properties } = r;
    return { type: "Feature", geometry: geometry ?? null, properties };
  });
  return JSON.stringify(
    { type: "FeatureCollection", features },
    null,
    2
  );
}
