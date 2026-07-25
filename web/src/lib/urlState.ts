/**
 * URLハッシュによる表示状態の共有（指示書 §8.10）。
 */

import type { GridSystem } from "./types";

export interface AppState {
  mode: "compare" | "correspond" | "convert";
  lng: number;
  lat: number;
  zoom: number;
  leftSystem: GridSystem;
  leftLevel: string;
  rightSystem: GridSystem;
  rightLevel: string;
  baseSystem: GridSystem;
  baseLevel: string;
  basemap: "pale" | "std";
  splitRatio: number;
  selectedId?: string;
  areaMatch: boolean;
}

export const DEFAULT_STATE: AppState = {
  mode: "compare",
  lng: 143.196,
  lat: 42.923, // 帯広（指示書 §17 テスト地点）
  zoom: 12,
  leftSystem: "jismesh",
  leftLevel: "3",
  rightSystem: "h3",
  rightLevel: "8",
  baseSystem: "jismesh",
  baseLevel: "3",
  basemap: "pale",
  splitRatio: 0.5,
  areaMatch: false,
};

export function readStateFromUrl(): AppState {
  const state = { ...DEFAULT_STATE };
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash) return state;
  const params = new URLSearchParams(hash);
  const num = (key: string, fallback: number) => {
    const v = parseFloat(params.get(key) ?? "");
    return isFinite(v) ? v : fallback;
  };
  const str = <T extends string>(key: string, fallback: T): T =>
    (params.get(key) as T) ?? fallback;
  state.mode = str("mode", state.mode);
  state.lng = num("lng", state.lng);
  state.lat = num("lat", state.lat);
  state.zoom = num("z", state.zoom);
  state.leftSystem = str("ls", state.leftSystem);
  state.leftLevel = str("ll", state.leftLevel);
  state.rightSystem = str("rs", state.rightSystem);
  state.rightLevel = str("rl", state.rightLevel);
  state.baseSystem = str("bs", state.baseSystem);
  state.baseLevel = str("bl", state.baseLevel);
  state.basemap = str("bm", state.basemap);
  state.splitRatio = num("split", state.splitRatio);
  state.selectedId = params.get("sel") ?? undefined;
  state.areaMatch = params.get("am") === "1";
  return state;
}

export function writeStateToUrl(state: AppState): void {
  const params = new URLSearchParams();
  params.set("mode", state.mode);
  params.set("lng", state.lng.toFixed(6));
  params.set("lat", state.lat.toFixed(6));
  params.set("z", state.zoom.toFixed(2));
  params.set("ls", state.leftSystem);
  params.set("ll", state.leftLevel);
  params.set("rs", state.rightSystem);
  params.set("rl", state.rightLevel);
  params.set("bs", state.baseSystem);
  params.set("bl", state.baseLevel);
  params.set("bm", state.basemap);
  params.set("split", state.splitRatio.toFixed(2));
  if (state.selectedId) params.set("sel", state.selectedId);
  if (state.areaMatch) params.set("am", "1");
  window.history.replaceState(null, "", `#${params.toString()}`);
}
