/**
 * 地理院タイルを背景とする MapLibre スタイル（指示書 §6）。
 * 地理院タイルへは利用者のブラウザから直接アクセスし、R2等へ複製しない。
 */

import type { StyleSpecification } from "maplibre-gl";
import type { GridSystem } from "../lib/types";

export type BasemapId = "pale" | "std";

export const BASEMAPS: Record<BasemapId, { label: string; url: string }> = {
  pale: {
    label: "淡色地図",
    url: "https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png",
  },
  std: {
    label: "標準地図",
    url: "https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png",
  },
};

export const GSI_ATTRIBUTION =
  '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院</a>';

export interface BackgroundSettings {
  basemap: BasemapId;
  /** 0-1（1で不透過） */
  opacity: number;
  /** -1〜1（-1でグレースケール） */
  saturation: number;
  /** 0-1 */
  brightness: number;
  visible: boolean;
}

export const DEFAULT_BACKGROUND: BackgroundSettings = {
  basemap: "pale",
  opacity: 0.75,
  saturation: -0.5,
  brightness: 1,
  visible: true,
};

export function buildStyle(bg: BackgroundSettings): StyleSpecification {
  return {
    version: 8,
    glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
    sources: {
      basemap: {
        type: "raster",
        tiles: [BASEMAPS[bg.basemap].url],
        tileSize: 256,
        maxzoom: 18,
        attribution: GSI_ATTRIBUTION,
      },
    },
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": "#ffffff" },
      },
      {
        id: "basemap",
        type: "raster",
        source: "basemap",
        layout: { visibility: bg.visible ? "visible" : "none" },
        paint: {
          "raster-opacity": bg.opacity,
          "raster-saturation": bg.saturation,
          "raster-brightness-max": bg.brightness,
        },
      },
    ],
  };
}

/** グリッド方式ごとの一貫した色（指示書 §19.1） */
export const SYSTEM_COLORS: Record<GridSystem, string> = {
  jismesh: "#d81b60",
  h3: "#1e88e5",
  s2: "#fb8c00",
  geohash: "#00897b",
  xyz: "#43a047",
  "spatial-id": "#8e24aa",
};
