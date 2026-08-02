/**
 * グリッドオーバーレイ付き MapLibre 地図。
 * - moveend 後に debounce してワーカーでセル生成（指示書 §13.3）
 * - 通常セルは枠線のみ（面透過度 0%）、選択セルのみ塗り（指示書 §2.2, §9.7)
 */

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import maplibregl, { Map as MlMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { GridCell, GridSystem } from "../lib/types";
import { callWorker } from "../workers/client";
import {
  BackgroundSettings,
  buildStyle,
  SYSTEM_COLORS,
} from "./style";

export interface GridLayerConfig {
  system: GridSystem;
  level: number | string;
  visible: boolean;
  lineOpacity: number;
  fillOpacity: number;
  showLabels: boolean;
  /** 線幅 [px]（既定 1） */
  lineWidth?: number;
  /** 線色の上書き（未指定なら方式ごとの標準色） */
  lineColor?: string;
  /** 選択セルの親セルを表示（指示書 §8.6） */
  showParent?: boolean;
  /** 選択セルの子セルを表示（指示書 §8.6） */
  showChildren?: boolean;
  /** 空間IDの鉛直位置（楕円体高 [m]、指示書 §11） */
  heightM?: number;
  /** 3Dボクセル表示（空間IDのみ） */
  show3d?: boolean;
  /** 3D表示の高さ倍率 */
  heightScale?: number;
}

export interface GridMapHandle {
  map: MlMap | null;
}

export const MAX_CELLS_PER_LAYER = 5000;

interface Props {
  bg: BackgroundSettings;
  layer: GridLayerConfig;
  selectedCell?: GridCell | null;
  parentCell?: GridCell | null;
  childCells?: GridCell[];
  /** 追加の描画セル（対応確認モードの交差セルなど） */
  overlayCells?: { cell: GridCell; kind: "within" | "boundary"; color: string }[];
  initialView: { lng: number; lat: number; zoom: number };
  onClick?: (lng: number, lat: number) => void;
  onMove?: (map: MlMap) => void;
  onError?: (message: string | null) => void;
  cursor?: { lng: number; lat: number } | null;
  onCursor?: (lng: number, lat: number) => void;
}

const EMPTY_FC: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

function cellsToFC(cells: GridCell[], colors?: string[]) {
  return {
    type: "FeatureCollection" as const,
    features: cells.map((c, i) => ({
      type: "Feature" as const,
      geometry: c.geometry,
      properties: {
        id: c.id,
        color: colors?.[i] ?? "#000000",
        minH: c.minHeightM ?? 0,
        maxH: c.maxHeightM ?? 0,
      },
    })),
  };
}

export const GridMap = forwardRef<GridMapHandle, Props>(function GridMap(
  {
    bg,
    layer,
    selectedCell,
    parentCell,
    childCells,
    overlayCells,
    initialView,
    onClick,
    onMove,
    onError,
    cursor,
    onCursor,
  },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const generationRef = useRef(0);
  const cursorMarkerRef = useRef<maplibregl.Marker | null>(null);
  const prev3dRef = useRef(false);

  useImperativeHandle(ref, () => ({ get map() { return mapRef.current; } }), []);

  // 地図の初期化
  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: buildStyle(bg),
      center: [initialView.lng, initialView.lat],
      zoom: initialView.zoom,
      attributionControl: { compact: false },
    });
    map.addControl(new maplibregl.NavigationControl(), "top-right");
    map.on("load", () => {
      addGridLayers(map);
      setMapReady(true);
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function addGridLayers(map: MlMap) {
    for (const src of [
      "grid",
      "selected",
      "hover",
      "parent",
      "children",
      "overlay-within",
      "overlay-boundary",
    ]) {
      if (!map.getSource(src)) {
        map.addSource(src, { type: "geojson", data: EMPTY_FC });
      }
    }
    map.addLayer({
      id: "grid-fill",
      type: "fill",
      source: "grid",
      paint: { "fill-color": "#000000", "fill-opacity": 0 },
    });
    // 空間IDの3Dボクセル表示（指示書 §11。fill-extrusionで押し出す）
    map.addLayer({
      id: "grid-extrude",
      type: "fill-extrusion",
      source: "grid",
      layout: { visibility: "none" },
      paint: {
        "fill-extrusion-color": "#000000",
        "fill-extrusion-opacity": 0.35,
        "fill-extrusion-base": 0,
        "fill-extrusion-height": 0,
      },
    });
    map.addLayer({
      id: "overlay-within-fill",
      type: "fill",
      source: "overlay-within",
      paint: { "fill-color": ["get", "color"], "fill-opacity": 0.18 },
    });
    map.addLayer({
      id: "overlay-within-line",
      type: "line",
      source: "overlay-within",
      paint: { "line-color": ["get", "color"], "line-width": 1 },
    });
    map.addLayer({
      id: "overlay-boundary-line",
      type: "line",
      source: "overlay-boundary",
      paint: {
        "line-color": ["get", "color"],
        "line-width": 1.6,
        "line-dasharray": [2, 2],
      },
    });
    map.addLayer({
      id: "grid-line",
      type: "line",
      source: "grid",
      paint: { "line-color": "#000000", "line-width": 1, "line-opacity": 0.95 },
    });
    // 選択セルの子セル（細線）と親セル（破線太線）
    map.addLayer({
      id: "children-line",
      type: "line",
      source: "children",
      paint: { "line-color": "#000000", "line-width": 0.7, "line-opacity": 0.8 },
    });
    map.addLayer({
      id: "parent-line",
      type: "line",
      source: "parent",
      paint: {
        "line-color": "#000000",
        "line-width": 2,
        "line-dasharray": [4, 2],
      },
    });
    // マウスオーバー中のセルを一時強調（指示書 §9.7）
    map.addLayer({
      id: "hover-fill",
      type: "fill",
      source: "hover",
      paint: { "fill-color": "#000000", "fill-opacity": 0.08 },
    });
    map.addLayer({
      id: "hover-line",
      type: "line",
      source: "hover",
      paint: { "line-color": "#000000", "line-width": 2.5 },
    });
    map.addLayer({
      id: "selected-fill",
      type: "fill",
      source: "selected",
      paint: { "fill-color": "#000000", "fill-opacity": 0.2 },
    });
    map.addLayer({
      id: "selected-line",
      type: "line",
      source: "selected",
      paint: { "line-color": "#000000", "line-width": 3 },
    });
    map.addLayer({
      id: "grid-label",
      type: "symbol",
      source: "selected",
      layout: {
        "text-field": ["get", "id"],
        "text-size": 12,
        "text-font": ["Noto Sans Regular"],
        "text-allow-overlap": true,
      },
      paint: {
        "text-color": "#333333",
        "text-halo-color": "#ffffff",
        "text-halo-width": 1.5,
      },
    });
  }

  // 背景地図設定の反映
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const src = map.getSource("basemap") as maplibregl.RasterTileSource;
    // タイルURL変更はスタイル再設定が必要
    const currentUrl = (src as unknown as { tiles?: string[] })?.tiles?.[0];
    if (currentUrl && !currentUrl.includes(`/xyz/${bg.basemap}/`)) {
      const center = map.getCenter();
      const zoom = map.getZoom();
      map.setStyle(buildStyle(bg));
      map.once("styledata", () => {
        addGridLayers(map);
        map.jumpTo({ center, zoom });
        refreshCells();
      });
      return;
    }
    map.setLayoutProperty("basemap", "visibility", bg.visible ? "visible" : "none");
    map.setPaintProperty("basemap", "raster-opacity", bg.opacity);
    map.setPaintProperty("basemap", "raster-saturation", bg.saturation);
    map.setPaintProperty("basemap", "raster-brightness-max", bg.brightness);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bg, mapReady]);

  // グリッドセルの再生成
  function refreshCells() {
    const map = mapRef.current;
    if (!map || !map.getSource("grid")) return;
    if (!layer.visible) {
      (map.getSource("grid") as maplibregl.GeoJSONSource).setData(EMPTY_FC);
      return;
    }
    const b = map.getBounds();
    const bounds: [number, number, number, number] = [
      b.getWest(),
      b.getSouth(),
      b.getEast(),
      b.getNorth(),
    ];
    const generation = ++generationRef.current;
    callWorker<GridCell[]>({
      type: "cells",
      system: layer.system,
      level: layer.level,
      bounds,
      maxCells: MAX_CELLS_PER_LAYER,
      heightM: layer.heightM ?? 0,
    })
      .then((cells) => {
        if (generation !== generationRef.current) return; // 古い結果は破棄
        const src = mapRef.current?.getSource("grid") as
          | maplibregl.GeoJSONSource
          | undefined;
        src?.setData(cellsToFC(cells));
        onError?.(null);
      })
      .catch((e: Error) => {
        if (generation !== generationRef.current) return;
        const src = mapRef.current?.getSource("grid") as
          | maplibregl.GeoJSONSource
          | undefined;
        src?.setData(EMPTY_FC);
        onError?.(e.message);
      });
  }

  const scheduleRefresh = () => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(refreshCells, 200);
  };

  // moveend / レイヤー設定変更で再生成
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    scheduleRefresh();
    const handler = () => scheduleRefresh();
    map.on("moveend", handler);
    return () => {
      map.off("moveend", handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layer.system, layer.level, layer.visible, layer.heightM, mapReady]);

  // スタイル系設定の反映
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !map.getLayer("grid-line")) return;
    const color = layer.lineColor ?? SYSTEM_COLORS[layer.system];
    const width = layer.lineWidth ?? 1;
    map.setPaintProperty("grid-line", "line-color", color);
    map.setPaintProperty("grid-line", "line-width", width);
    map.setPaintProperty("grid-line", "line-opacity", layer.lineOpacity);
    map.setPaintProperty("grid-fill", "fill-color", color);
    map.setPaintProperty("grid-fill", "fill-opacity", layer.fillOpacity);
    map.setPaintProperty("selected-fill", "fill-color", color);
    map.setPaintProperty("selected-line", "line-color", color);
    map.setPaintProperty("selected-line", "line-width", width + 2);
    map.setPaintProperty("hover-fill", "fill-color", color);
    map.setPaintProperty("hover-line", "line-color", color);
    map.setPaintProperty("hover-line", "line-width", width + 1.5);
    map.setPaintProperty("parent-line", "line-color", color);
    map.setPaintProperty("parent-line", "line-width", width + 1);
    map.setPaintProperty("children-line", "line-color", color);
    // 3Dボクセル表示（空間IDのみ有効）
    const is3d = !!layer.show3d && layer.system === "spatial-id";
    const scale = layer.heightScale ?? 1;
    map.setLayoutProperty(
      "grid-extrude",
      "visibility",
      is3d ? "visible" : "none"
    );
    if (is3d) {
      map.setPaintProperty("grid-extrude", "fill-extrusion-color", color);
      // 地下ボクセル（負の高度）は0mへクランプして表示する
      map.setPaintProperty("grid-extrude", "fill-extrusion-base", [
        "max",
        0,
        ["*", ["get", "minH"], scale],
      ]);
      map.setPaintProperty("grid-extrude", "fill-extrusion-height", [
        "max",
        0,
        ["*", ["get", "maxH"], scale],
      ]);
    }
    if (is3d !== prev3dRef.current) {
      prev3dRef.current = is3d;
      map.easeTo({ pitch: is3d ? 55 : 0, duration: 600 });
    }
    map.setLayoutProperty(
      "grid-label",
      "visibility",
      layer.showLabels ? "visible" : "none"
    );
  }, [layer, mapReady]);

  // 選択セルの反映
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !map.getSource("selected")) return;
    (map.getSource("selected") as maplibregl.GeoJSONSource).setData(
      selectedCell ? cellsToFC([selectedCell]) : EMPTY_FC
    );
  }, [selectedCell, mapReady]);

  // 親セル・子セルの反映（指示書 §8.6）
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !map.getSource("parent")) return;
    (map.getSource("parent") as maplibregl.GeoJSONSource).setData(
      parentCell ? cellsToFC([parentCell]) : EMPTY_FC
    );
    (map.getSource("children") as maplibregl.GeoJSONSource).setData(
      childCells?.length ? cellsToFC(childCells) : EMPTY_FC
    );
  }, [parentCell, childCells, mapReady]);

  // 対応確認モードの交差セル描画
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !map.getSource("overlay-within")) return;
    const within = (overlayCells ?? []).filter((o) => o.kind === "within");
    const boundary = (overlayCells ?? []).filter((o) => o.kind === "boundary");
    (map.getSource("overlay-within") as maplibregl.GeoJSONSource).setData(
      cellsToFC(
        within.map((o) => o.cell),
        within.map((o) => o.color)
      )
    );
    (map.getSource("overlay-boundary") as maplibregl.GeoJSONSource).setData(
      cellsToFC(
        boundary.map((o) => o.cell),
        boundary.map((o) => o.color)
      )
    );
  }, [overlayCells, mapReady]);

  // クリック・移動・カーソルイベント
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const clickHandler = (e: maplibregl.MapMouseEvent) =>
      onClick?.(e.lngLat.lng, e.lngLat.lat);
    const moveHandler = () => onMove?.(map);
    const setHover = (feature: GeoJSON.Feature | null) => {
      const src = map.getSource("hover") as maplibregl.GeoJSONSource | undefined;
      src?.setData(
        feature ? { type: "FeatureCollection", features: [feature] } : EMPTY_FC
      );
    };
    const mouseHandler = (e: maplibregl.MapMouseEvent) => {
      onCursor?.(e.lngLat.lng, e.lngLat.lat);
      if (!map.getLayer("grid-fill")) return;
      const features = map.queryRenderedFeatures(e.point, {
        layers: ["grid-fill"],
      });
      setHover(features[0] ?? null);
    };
    const leaveHandler = () => setHover(null);
    map.on("click", clickHandler);
    map.on("move", moveHandler);
    map.on("mousemove", mouseHandler);
    map.getCanvas().addEventListener("mouseleave", leaveHandler);
    return () => {
      map.off("click", clickHandler);
      map.off("move", moveHandler);
      map.off("mousemove", mouseHandler);
      map.getCanvas()?.removeEventListener("mouseleave", leaveHandler);
    };
  }, [onClick, onMove, onCursor, mapReady]);

  // 相手地図のカーソル位置表示（指示書 §8.4）
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (cursor) {
      if (!cursorMarkerRef.current) {
        const el = document.createElement("div");
        el.className = "cursor-marker";
        cursorMarkerRef.current = new maplibregl.Marker({ element: el })
          .setLngLat([cursor.lng, cursor.lat])
          .addTo(map);
      } else {
        cursorMarkerRef.current.setLngLat([cursor.lng, cursor.lat]);
      }
    } else if (cursorMarkerRef.current) {
      cursorMarkerRef.current.remove();
      cursorMarkerRef.current = null;
    }
  }, [cursor, mapReady]);

  return <div ref={containerRef} className="map-container" />;
});
