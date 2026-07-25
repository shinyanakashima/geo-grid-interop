/**
 * 測地計算ユーティリティ。
 *
 * Webメルカトル上の平面面積を正式なセル面積として扱わない（指示書 §4.3）。
 * 面積は球面近似（GRS80 平均半径）による球面過剰法で計算する。
 * QGIS プラグイン側 (core/geometry.py) と同一アルゴリズム・同一半径を
 * 使用し、Web版とQGIS版の計算結果を一致させる（指示書 §16）。
 */

import type { Position } from "./types";

/** 平均半径 [m]（GRS80: (2a + b) / 3） */
export const EARTH_RADIUS_M = 6371008.7714;

const D2R = Math.PI / 180;

/** 球面上のリング面積 [m^2]（符号なし） */
export function ringAreaM2(ring: Position[]): number {
  if (ring.length < 4) return 0;
  let total = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [lon1, lat1] = ring[i];
    const [lon2, lat2] = ring[i + 1];
    total +=
      (lon2 - lon1) * D2R * (2 + Math.sin(lat1 * D2R) + Math.sin(lat2 * D2R));
  }
  return Math.abs((total * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2);
}

/** ポリゴン（外環 - 内環）の球面面積 [m^2] */
export function polygonAreaM2(coordinates: Position[][]): number {
  let area = ringAreaM2(coordinates[0] ?? []);
  for (let i = 1; i < coordinates.length; i++) {
    area -= ringAreaM2(coordinates[i]);
  }
  return Math.max(area, 0);
}

export function multiPolygonAreaM2(coordinates: Position[][][]): number {
  return coordinates.reduce((sum, poly) => sum + polygonAreaM2(poly), 0);
}

/** ハーバサイン距離 [m] */
export function distanceM(a: Position, b: Position): number {
  const [lon1, lat1] = a;
  const [lon2, lat2] = b;
  const dLat = (lat2 - lat1) * D2R;
  const dLon = (lon2 - lon1) * D2R;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 面積の読みやすい表記 */
export function formatArea(m2: number): string {
  if (!isFinite(m2)) return "-";
  if (m2 >= 1e5) return `${(m2 / 1e6).toFixed(3)} km²`;
  return `${m2.toFixed(1)} m²`;
}

export function formatLength(m: number | undefined): string {
  if (m === undefined || !isFinite(m)) return "-";
  if (m >= 1000) return `${(m / 1000).toFixed(3)} km`;
  return `${m.toFixed(1)} m`;
}

/** 経度を [-180, 180) に正規化 */
export function normalizeLon(lon: number): number {
  let x = ((lon + 180) % 360 + 360) % 360 - 180;
  return x;
}
