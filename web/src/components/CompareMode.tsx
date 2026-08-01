/**
 * モード1: メッシュ比較（指示書 §8）。
 * 2つの MapLibre インスタンスを同期し、左右で別グリッドを表示する。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Map as MlMap } from "maplibre-gl";
import { GridMap, GridMapHandle, GridLayerConfig } from "../map/GridMap";
import { BackgroundSettings, SYSTEM_COLORS } from "../map/style";
import { GridSelector } from "./GridSelector";
import { CellInfoTable } from "./CellInfoTable";
import { getAdapter } from "../lib/adapters";
import { levelByAreaMatch } from "../lib/intersect";
import type { GridCell } from "../lib/types";
import type { AppState } from "../lib/urlState";
import { cellsToGeoJson, downloadText } from "../lib/download";
import { formatArea } from "../lib/geo";

interface Props {
  bg: BackgroundSettings;
  urlState: AppState;
  onViewChange: (lng: number, lat: number, zoom: number) => void;
  onStateChange: (patch: Partial<AppState>) => void;
}

export function CompareMode({ bg, urlState, onViewChange, onStateChange }: Props) {
  const leftRef = useRef<GridMapHandle>(null);
  const rightRef = useRef<GridMapHandle>(null);
  const syncLockRef = useRef(false);

  const [leftConfig, setLeftConfig] = useState<GridLayerConfig>({
    system: urlState.leftSystem,
    level: urlState.leftLevel,
    visible: true,
    lineOpacity: 0.95,
    fillOpacity: 0,
    showLabels: true,
  });
  const [rightConfig, setRightConfig] = useState<GridLayerConfig>({
    system: urlState.rightSystem,
    level:
      urlState.rightSystem === "h3" || urlState.rightSystem === "xyz" ||
      urlState.rightSystem === "spatial-id"
        ? Number(urlState.rightLevel)
        : urlState.rightLevel,
    visible: true,
    lineOpacity: 0.95,
    fillOpacity: 0,
    showLabels: true,
  });
  const [areaMatch, setAreaMatch] = useState(urlState.areaMatch);
  const [viewMode, setViewMode] = useState<"swipe" | "side">(urlState.view);
  const isSwipe = viewMode === "swipe";
  const [split, setSplit] = useState(urlState.splitRatio);
  const [leftCell, setLeftCell] = useState<GridCell | null>(null);
  const [rightCell, setRightCell] = useState<GridCell | null>(null);
  const [clickPoint, setClickPoint] = useState<[number, number] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cursorL, setCursorL] = useState<{ lng: number; lat: number } | null>(null);
  const [cursorR, setCursorR] = useState<{ lng: number; lat: number } | null>(null);

  // 地図同期（指示書 §8.3, §8.4）: 同期ロックで無限ループを防ぐ
  const syncFrom = useCallback((src: MlMap, dstRef: React.RefObject<GridMapHandle>) => {
    if (syncLockRef.current) return;
    const dst = dstRef.current?.map;
    if (!dst) return;
    syncLockRef.current = true;
    dst.jumpTo({
      center: src.getCenter(),
      zoom: src.getZoom(),
      bearing: src.getBearing(),
      pitch: src.getPitch(),
    });
    syncLockRef.current = false;
    const c = src.getCenter();
    onViewChange(c.lng, c.lat, src.getZoom());
  }, [onViewChange]);

  const handleClick = useCallback(
    (lng: number, lat: number) => {
      setClickPoint([lng, lat]);
      let lCell: GridCell | null = null;
      try {
        lCell = getAdapter(leftConfig.system).pointToCell(lng, lat, leftConfig.level);
        setLeftCell(lCell);
        setError(null);
      } catch (e) {
        setLeftCell(null);
        setError(e instanceof Error ? e.message : String(e));
      }
      try {
        let rightLevel = rightConfig.level;
        if (areaMatch && lCell) {
          // 面積一致: クリック位置の実セル面積で最適レベルを選択（指示書 §8.7）
          rightLevel = levelByAreaMatch(rightConfig.system, lng, lat, lCell.areaM2);
          if (rightLevel !== rightConfig.level) {
            setRightConfig((c) => ({ ...c, level: rightLevel }));
          }
        }
        setRightCell(
          getAdapter(rightConfig.system).pointToCell(lng, lat, rightLevel)
        );
      } catch (e) {
        setRightCell(null);
        setError(e instanceof Error ? e.message : String(e));
      }
      onStateChange({ selectedId: undefined });
    },
    [leftConfig, rightConfig, areaMatch, onStateChange]
  );

  // URL状態へ反映
  useEffect(() => {
    onStateChange({
      leftSystem: leftConfig.system,
      leftLevel: String(leftConfig.level),
      rightSystem: rightConfig.system,
      rightLevel: String(rightConfig.level),
      areaMatch,
      splitRatio: split,
      view: viewMode,
    });
  }, [leftConfig.system, leftConfig.level, rightConfig.system, rightConfig.level, areaMatch, split, viewMode, onStateChange]);

  // 中央スライダーのドラッグ（指示書 §8.5）
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const ratio = Math.min(0.85, Math.max(0.15, (e.clientX - rect.left) / rect.width));
      setSplit(ratio);
    };
    const onUp = () => {
      if (draggingRef.current) {
        draggingRef.current = false;
        leftRef.current?.map?.resize();
        rightRef.current?.map?.resize();
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  // 左右並列モードでは幅変更に、スワイプ⇔並列切替では常にリサイズが必要。
  // スワイプ中は地図サイズが変わらないためリサイズ不要（clip-pathのみ更新）。
  useEffect(() => {
    if (!isSwipe) {
      leftRef.current?.map?.resize();
      rightRef.current?.map?.resize();
    }
  }, [split, isSwipe]);

  useEffect(() => {
    leftRef.current?.map?.resize();
    rightRef.current?.map?.resize();
  }, [viewMode]);

  const exportCsv = () => {
    const cells = [leftCell, rightCell].filter(Boolean) as GridCell[];
    if (!cells.length) return;
    const header =
      "system,id,level,area_m2,center_lon,center_lat,parent_id,child_count";
    const rows = cells.map((c) =>
      [
        c.system,
        c.id,
        c.level,
        c.areaM2.toFixed(2),
        c.center[0].toFixed(8),
        c.center[1].toFixed(8),
        c.parentId ?? "",
        c.childCount ?? "",
      ].join(",")
    );
    downloadText("selected-cells.csv", [header, ...rows].join("\n"), "text/csv");
  };

  const exportGeoJson = () => {
    const cells = [leftCell, rightCell].filter(Boolean) as GridCell[];
    if (!cells.length) return;
    downloadText(
      "selected-cells.geojson",
      cellsToGeoJson(cells as never),
      "application/geo+json"
    );
  };

  return (
    <div className="compare-mode">
      <div className="toolbar">
        <GridSelector label="左" config={leftConfig} onChange={setLeftConfig} />
        <GridSelector
          label="右"
          config={rightConfig}
          onChange={setRightConfig}
          levelDisabled={areaMatch}
        />
        <label className="row" title="左セルの面積に最も近い右グリッドのレベルを自動選択します">
          <input
            type="checkbox"
            checked={areaMatch}
            onChange={(e) => setAreaMatch(e.target.checked)}
          />
          面積一致
        </label>
        <div className="view-toggle" role="group" aria-label="比較方式">
          <button
            className={isSwipe ? "tab active" : "tab"}
            onClick={() => setViewMode("swipe")}
            title="1つの地図を比較線で区切って左右のグリッドを表示"
          >
            スワイプ
          </button>
          <button
            className={!isSwipe ? "tab active" : "tab"}
            onClick={() => setViewMode("side")}
            title="2つの地図を並べて同期表示"
          >
            左右並列
          </button>
        </div>
        <div className="toolbar-actions">
          <button onClick={exportCsv} disabled={!leftCell && !rightCell}>
            CSV出力
          </button>
          <button onClick={exportGeoJson} disabled={!leftCell && !rightCell}>
            GeoJSON出力
          </button>
        </div>
      </div>
      {error && <div className="error-bar">{error}</div>}
      <div
        className={isSwipe ? "swipe-container" : "split-container"}
        ref={containerRef}
      >
        <div
          className="map-pane"
          style={
            isSwipe
              ? {
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  clipPath: `inset(0 ${(1 - split) * 100}% 0 0)`,
                }
              : { width: `${split * 100}%` }
          }
        >
          <GridMap
            ref={leftRef}
            bg={bg}
            layer={leftConfig}
            selectedCell={leftCell}
            initialView={{ lng: urlState.lng, lat: urlState.lat, zoom: urlState.zoom }}
            onClick={handleClick}
            onMove={(m) => syncFrom(m, rightRef)}
            onError={setError}
            cursor={isSwipe ? null : cursorR}
            onCursor={(lng, lat) => setCursorL({ lng, lat })}
          />
          {leftCell && (
            <div className="map-badge">
              <span
                className="dot"
                style={{ background: SYSTEM_COLORS[leftCell.system] }}
              />
              {leftCell.id}（{formatArea(leftCell.areaM2)}）
            </div>
          )}
        </div>
        <div
          className={isSwipe ? "swipe-handle" : "split-handle"}
          style={isSwipe ? { left: `calc(${split * 100}% - 2px)` } : undefined}
          onMouseDown={() => {
            draggingRef.current = true;
          }}
          title="ドラッグして比較位置を変更"
        />
        <div
          className="map-pane"
          style={
            isSwipe
              ? {
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  clipPath: `inset(0 0 0 ${split * 100}%)`,
                }
              : { width: `${(1 - split) * 100}%` }
          }
        >
          <GridMap
            ref={rightRef}
            bg={bg}
            layer={rightConfig}
            selectedCell={rightCell}
            initialView={{ lng: urlState.lng, lat: urlState.lat, zoom: urlState.zoom }}
            onClick={handleClick}
            onMove={(m) => syncFrom(m, leftRef)}
            onError={setError}
            cursor={isSwipe ? null : cursorL}
            onCursor={(lng, lat) => setCursorR({ lng, lat })}
          />
          {rightCell && (
            <div className={isSwipe ? "map-badge badge-right" : "map-badge"}>
              <span
                className="dot"
                style={{ background: SYSTEM_COLORS[rightCell.system] }}
              />
              {rightCell.id}（{formatArea(rightCell.areaM2)}）
            </div>
          )}
        </div>
      </div>
      <div className="bottom-panel">
        <CellInfoTable left={leftCell} right={rightCell} clickPoint={clickPoint} />
      </div>
    </div>
  );
}
