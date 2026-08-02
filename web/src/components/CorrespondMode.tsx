/**
 * モード2: セル対応確認（指示書 §9）。
 * 基準セルと他方式セルとの包含・交差関係を表示する。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GridMap, GridMapHandle, GridLayerConfig } from "../map/GridMap";
import { BackgroundSettings, SYSTEM_COLORS } from "../map/style";
import { getAdapter, availableSystems } from "../lib/adapters";
import type { GridCell, GridSystem } from "../lib/types";
import type { CorrespondenceResult } from "../lib/intersect";
import { callWorker } from "../workers/client";
import type { AppState } from "../lib/urlState";
import { downloadText } from "../lib/download";
import { formatArea } from "../lib/geo";

type RelationFilter = "all" | "within" | "boundary";

interface TargetConfig {
  system: GridSystem;
  level: number | string;
  enabled: boolean;
  /** 表示する関係の絞り込み（指示書 §9.6） */
  filter: RelationFilter;
}

interface Props {
  bg: BackgroundSettings;
  urlState: AppState;
  onViewChange: (lng: number, lat: number, zoom: number) => void;
  onStateChange: (patch: Partial<AppState>) => void;
}

export function CorrespondMode({ bg, urlState, onViewChange, onStateChange }: Props) {
  const [baseConfig, setBaseConfig] = useState<GridLayerConfig>({
    system: urlState.baseSystem,
    level: urlState.baseLevel,
    visible: true,
    lineOpacity: 0.95,
    fillOpacity: 0,
    showLabels: true,
  });
  const [targets, setTargets] = useState<TargetConfig[]>(
    availableSystems()
      .filter((a) => a.system !== urlState.baseSystem)
      .map((a) => ({
        system: a.system,
        level: a.defaultLevel,
        enabled: a.system === "h3",
        filter: "all" as RelationFilter,
      }))
  );
  const [baseCell, setBaseCell] = useState<GridCell | null>(null);
  const [results, setResults] = useState<CorrespondenceResult[]>([]);
  const [idInput, setIdInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mapRef = useRef<GridMapHandle>(null);
  const [geoQuery, setGeoQuery] = useState("");
  const [geoResults, setGeoResults] = useState<
    { title: string; lng: number; lat: number }[]
  >([]);
  const [geoBusy, setGeoBusy] = useState(false);

  const runCorrespondence = useCallback(
    (cell: GridCell, currentTargets: TargetConfig[]) => {
      const enabled = currentTargets.filter((t) => t.enabled);
      if (!enabled.length) {
        setResults([]);
        return;
      }
      setBusy(true);
      callWorker<{ base: GridCell; results: CorrespondenceResult[] }>({
        type: "correspondence",
        baseSystem: cell.system,
        baseId: cell.id,
        targets: enabled.map((t) => ({ system: t.system, level: t.level })),
      })
        .then((res) => {
          setResults(res.results);
          setError(null);
        })
        .catch((e: Error) => setError(e.message))
        .finally(() => setBusy(false));
    },
    []
  );

  const selectCell = useCallback(
    (cell: GridCell) => {
      setBaseCell(cell);
      onStateChange({ selectedId: cell.id, baseSystem: cell.system });
      runCorrespondence(cell, targets);
    },
    [targets, runCorrespondence, onStateChange]
  );

  const handleClick = useCallback(
    (lng: number, lat: number) => {
      try {
        const cell = getAdapter(baseConfig.system).pointToCell(
          lng,
          lat,
          baseConfig.level
        );
        setError(null);
        selectCell(cell);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [baseConfig, selectCell]
  );

  /** 指定地点の基準セルを選択して地図を移動する */
  const selectAtPoint = useCallback(
    (lng: number, lat: number) => {
      try {
        const cell = getAdapter(baseConfig.system).pointToCell(
          lng,
          lat,
          baseConfig.level
        );
        setError(null);
        selectCell(cell);
        mapRef.current?.map?.flyTo({ center: [lng, lat], zoom: 13 });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [baseConfig, selectCell]
  );

  const handleIdInput = () => {
    const text = idInput.trim();
    if (!text) return;
    // 緯度経度入力（例: "42.923, 143.196"）を判定（指示書 §9.3）
    const coords = text.split(/[\s,、/]+/).map(Number);
    if (coords.length === 2 && coords.every(isFinite)) {
      const [a, b] = coords;
      if (Math.abs(a) <= 90 && Math.abs(b) <= 180) {
        selectAtPoint(b, a); // 緯度, 経度 の順とみなす
      } else if (Math.abs(a) <= 180 && Math.abs(b) <= 90) {
        selectAtPoint(a, b); // 経度, 緯度 の順とみなす
      } else {
        setError(`緯度経度として解釈できません: ${text}`);
      }
      return;
    }
    // 貼り付けられたIDの方式を自動判別（指示書 §9.3）
    for (const adapter of [
      getAdapter(baseConfig.system),
      ...availableSystems(),
    ]) {
      try {
        const cell = adapter.cellToGeometry(text);
        setBaseConfig((c) => ({ ...c, system: cell.system, level: cell.level }));
        setError(null);
        selectCell(cell);
        mapRef.current?.map?.flyTo({ center: cell.center, zoom: 13 });
        return;
      } catch {
        // 次のアダプターを試す
      }
    }
    setError(`指定されたセルIDは無効です: ${idInput}`);
  };

  /** 現在地から基準セルを選択（指示書 §9.3） */
  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      setError("この環境では現在地を取得できません");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => selectAtPoint(pos.coords.longitude, pos.coords.latitude),
      () => setError("現在地を取得できませんでした")
    );
  };

  /** 地名検索（国土地理院 住所検索API、指示書 §9.3） */
  const searchPlace = () => {
    const q = geoQuery.trim();
    if (!q) return;
    setGeoBusy(true);
    fetch(
      `https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(q)}`
    )
      .then((r) => r.json())
      .then(
        (
          data: { geometry: { coordinates: [number, number] }; properties: { title: string } }[]
        ) => {
          setGeoResults(
            data.slice(0, 5).map((f) => ({
              title: f.properties.title,
              lng: f.geometry.coordinates[0],
              lat: f.geometry.coordinates[1],
            }))
          );
          if (!data.length) setError(`「${q}」は見つかりませんでした`);
          else setError(null);
        }
      )
      .catch(() => setError("地名検索に失敗しました"))
      .finally(() => setGeoBusy(false));
  };

  // ターゲット変更時に再計算
  useEffect(() => {
    if (baseCell) runCorrespondence(baseCell, targets);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targets]);

  // URL の選択セル復元
  useEffect(() => {
    if (urlState.selectedId && !baseCell) {
      try {
        const cell = getAdapter(urlState.baseSystem).cellToGeometry(
          urlState.selectedId
        );
        selectCell(cell);
      } catch {
        // 無効なIDは無視
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 基準セルの親・子セル表示（指示書 §9.4）
  const pedigree = useMemo(() => {
    let parent: GridCell | null = null;
    let children: GridCell[] = [];
    if (baseCell) {
      const adapter = getAdapter(baseCell.system);
      try {
        if (baseConfig.showParent && baseCell.parentId) {
          parent = adapter.cellToGeometry(baseCell.parentId);
        }
        if (baseConfig.showChildren) {
          children = adapter
            .getChildren(baseCell.id)
            .slice(0, 128)
            .map((id) => adapter.cellToGeometry(id));
        }
      } catch {
        // 親子を取得できないセルは無視
      }
    }
    return { parent, children };
  }, [baseCell, baseConfig.showParent, baseConfig.showChildren]);

  const moveTarget = (index: number, delta: number) => {
    const next = [...targets];
    const j = index + delta;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    setTargets(next);
  };

  const overlayCells = results.flatMap((r) => {
    const filter =
      targets.find((t) => t.system === r.targetSystem)?.filter ?? "all";
    return r.targetCells
      .map((cell, i) => ({
        cell,
        kind:
          r.intersections[i].relation === "contains" ||
          r.intersections[i].relation === "equal"
            ? ("within" as const)
            : ("boundary" as const),
        color: SYSTEM_COLORS[r.targetSystem],
      }))
      .filter((o) => filter === "all" || o.kind === filter);
  });

  const exportCsv = () => {
    if (!results.length) return;
    const header =
      "source_system,source_id,target_system,target_id,intersection_area_m2,source_ratio,target_ratio,relation";
    const rows = results.flatMap((r) =>
      r.intersections.map((ix) =>
        [
          ix.sourceSystem,
          ix.sourceId,
          ix.targetSystem,
          ix.targetId,
          ix.intersectionAreaM2.toFixed(2),
          ix.sourceRatio.toFixed(6),
          ix.targetRatio.toFixed(6),
          ix.relation,
        ].join(",")
      )
    );
    downloadText("correspondence.csv", [header, ...rows].join("\n"), "text/csv");
  };

  const exportGeoJson = () => {
    if (!results.length) return;
    const features = results.flatMap((r) =>
      r.targetCells.map((cell, i) => ({
        type: "Feature" as const,
        geometry: cell.geometry,
        properties: { ...r.intersections[i] },
      }))
    );
    downloadText(
      "correspondence.geojson",
      JSON.stringify({ type: "FeatureCollection", features }, null, 2),
      "application/geo+json"
    );
  };

  return (
    <div className="correspond-mode">
      <div className="side-panel">
        <h3>基準グリッド</h3>
        <select
          value={baseConfig.system}
          onChange={(e) => {
            const system = e.target.value as GridSystem;
            setBaseConfig((c) => ({
              ...c,
              system,
              level: getAdapter(system).defaultLevel,
            }));
            setTargets(
              availableSystems()
                .filter((a) => a.system !== system)
                .map((a) => ({
                  system: a.system,
                  level: a.defaultLevel,
                  enabled: false,
                  filter: "all" as RelationFilter,
                }))
            );
            setBaseCell(null);
            setResults([]);
          }}
        >
          {availableSystems().map((a) => (
            <option key={a.system} value={a.system}>
              {a.displayName}
            </option>
          ))}
        </select>
        <select
          value={String(baseConfig.level)}
          onChange={(e) => {
            const raw = e.target.value;
            const asNum = Number(raw);
            setBaseConfig((c) => ({
              ...c,
              level: isNaN(asNum) || String(asNum) !== raw ? raw : asNum,
            }));
            setBaseCell(null);
            setResults([]);
          }}
        >
          {getAdapter(baseConfig.system).levels.map((lv) => (
            <option key={String(lv.value)} value={String(lv.value)}>
              {lv.label}
            </option>
          ))}
        </select>
        <div className="id-input">
          <input
            placeholder="セルID / 緯度,経度 を入力"
            value={idInput}
            onChange={(e) => setIdInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleIdInput()}
          />
          <button onClick={handleIdInput}>選択</button>
        </div>
        <div className="id-input">
          <input
            placeholder="地名・住所で検索"
            value={geoQuery}
            onChange={(e) => setGeoQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && searchPlace()}
          />
          <button onClick={searchPlace} disabled={geoBusy}>
            {geoBusy ? "検索中" : "検索"}
          </button>
        </div>
        {geoResults.length > 0 && (
          <ul className="geocode-results">
            {geoResults.map((r, i) => (
              <li key={i}>
                <button
                  className="link"
                  onClick={() => {
                    selectAtPoint(r.lng, r.lat);
                    setGeoResults([]);
                  }}
                >
                  {r.title}
                </button>
              </li>
            ))}
          </ul>
        )}
        <button onClick={useCurrentLocation}>📍 現在地から選択</button>
        {baseCell && (
          <div className="base-cell-info">
            <div className="mono">{baseCell.id}</div>
            <div>面積: {formatArea(baseCell.areaM2)}</div>
          </div>
        )}
        <div className="row-group">
          <label className="row">
            <input
              type="checkbox"
              checked={baseConfig.showParent ?? false}
              onChange={(e) =>
                setBaseConfig((c) => ({ ...c, showParent: e.target.checked }))
              }
            />
            親セル表示
          </label>
          <label className="row">
            <input
              type="checkbox"
              checked={baseConfig.showChildren ?? false}
              onChange={(e) =>
                setBaseConfig((c) => ({ ...c, showChildren: e.target.checked }))
              }
            />
            子セル表示
          </label>
        </div>
        <h3>比較対象</h3>
        {targets.map((t, i) => (
          <div key={t.system} className="target-row">
            <div className="target-head">
              <label className="row">
                <input
                  type="checkbox"
                  checked={t.enabled}
                  onChange={(e) => {
                    const next = [...targets];
                    next[i] = { ...t, enabled: e.target.checked };
                    setTargets(next);
                  }}
                />
                <span
                  className="color-chip"
                  style={{ background: SYSTEM_COLORS[t.system] }}
                />
                {getAdapter(t.system).displayName}
              </label>
              <span className="order-buttons">
                <button
                  className="mini"
                  title="表示順序を上へ（後に描画され前面になる）"
                  disabled={i === 0}
                  onClick={() => moveTarget(i, -1)}
                >
                  ↑
                </button>
                <button
                  className="mini"
                  title="表示順序を下へ"
                  disabled={i === targets.length - 1}
                  onClick={() => moveTarget(i, 1)}
                >
                  ↓
                </button>
              </span>
            </div>
            <select
              value={String(t.level)}
              onChange={(e) => {
                const raw = e.target.value;
                const asNum = Number(raw);
                const next = [...targets];
                next[i] = {
                  ...t,
                  level: isNaN(asNum) || String(asNum) !== raw ? raw : asNum,
                };
                setTargets(next);
              }}
            >
              {getAdapter(t.system).levels.map((lv) => (
                <option key={String(lv.value)} value={String(lv.value)}>
                  {lv.label}
                </option>
              ))}
            </select>
            {t.enabled && (
              <select
                value={t.filter}
                onChange={(e) => {
                  const next = [...targets];
                  next[i] = { ...t, filter: e.target.value as RelationFilter };
                  setTargets(next);
                }}
              >
                <option value="all">すべて表示</option>
                <option value="within">完全包含セルのみ</option>
                <option value="boundary">境界交差セルのみ</option>
              </select>
            )}
          </div>
        ))}
        {busy && <p className="hint">交差計算中...</p>}
        {error && <div className="error-bar">{error}</div>}
        <div className="legend">
          <h4>凡例</h4>
          <div><span className="legend-line solid" /> 通常セル（枠線のみ）</div>
          <div><span className="legend-line bold" /> 基準セル（太線＋薄い塗り）</div>
          <div><span className="legend-line fill" /> 完全包含セル（薄い塗り）</div>
          <div><span className="legend-line dashed" /> 境界交差セル（破線）</div>
        </div>
        <div className="export-row">
          <button onClick={exportCsv} disabled={!results.length}>
            CSV出力
          </button>
          <button onClick={exportGeoJson} disabled={!results.length}>
            GeoJSON出力
          </button>
        </div>
        {results.map((r) => (
          <div key={r.targetSystem} className="result-block">
            <h4>
              <span
                className="color-chip"
                style={{ background: SYSTEM_COLORS[r.targetSystem] }}
              />
              {getAdapter(r.targetSystem).displayName}
            </h4>
            <table className="info-table small">
              <tbody>
                <tr><td>交差セル数</td><td>{r.intersectCount}</td></tr>
                <tr><td>完全包含</td><td>{r.containedCount}</td></tr>
                <tr><td>境界交差</td><td>{r.boundaryCount}</td></tr>
                <tr><td>面積比合計</td><td>{(r.ratioSum * 100).toFixed(2)}%</td></tr>
                <tr><td>計算誤差</td><td>{(r.ratioError * 100).toFixed(4)}%</td></tr>
              </tbody>
            </table>
            <details>
              <summary>面積構成（上位10セル）</summary>
              <table className="info-table small">
                <tbody>
                  {[...r.intersections]
                    .sort((a, b) => b.sourceRatio - a.sourceRatio)
                    .slice(0, 10)
                    .map((ix) => (
                      <tr key={ix.targetId}>
                        <td className="mono">{ix.targetId}</td>
                        <td>{(ix.sourceRatio * 100).toFixed(1)}%</td>
                        <td>{ix.relation}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </details>
          </div>
        ))}
      </div>
      <div className="map-single">
        <GridMap
          ref={mapRef}
          bg={bg}
          layer={baseConfig}
          selectedCell={baseCell}
          parentCell={pedigree.parent}
          childCells={pedigree.children}
          overlayCells={overlayCells}
          initialView={{ lng: urlState.lng, lat: urlState.lat, zoom: urlState.zoom }}
          onClick={handleClick}
          onMove={(m) => {
            const c = m.getCenter();
            onViewChange(c.lng, c.lat, m.getZoom());
          }}
          onError={setError}
        />
      </div>
    </div>
  );
}
