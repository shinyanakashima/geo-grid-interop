/**
 * グリッドアダプターレジストリ。
 * 特定ライブラリへ依存しすぎないよう、共通インターフェース GridAdapter を
 * 介してのみ各グリッド実装へアクセスする（指示書 §4.2）。
 *
 * S2 / Geohash は第2段階（指示書 §18.3）で追加する。
 */

import type { GridAdapter, GridSystem } from "../types";
import { jismeshAdapter } from "./jismesh";
import { h3Adapter } from "./h3";
import { xyzAdapter } from "./xyz";
import { spatialIdAdapter } from "./spatialid";

const registry = new Map<GridSystem, GridAdapter>([
  ["jismesh", jismeshAdapter],
  ["h3", h3Adapter],
  ["xyz", xyzAdapter],
  ["spatial-id", spatialIdAdapter],
]);

export function getAdapter(system: GridSystem): GridAdapter {
  const adapter = registry.get(system);
  if (!adapter) {
    throw new Error(`グリッド方式 ${system} は未対応です`);
  }
  return adapter;
}

export function availableSystems(): GridAdapter[] {
  return [...registry.values()];
}

export { jismeshAdapter, h3Adapter, xyzAdapter, spatialIdAdapter };
