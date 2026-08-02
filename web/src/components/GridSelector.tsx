/** グリッド方式・レベル・表示スタイルの選択（指示書 §8.6, §9.6） */

import { availableSystems, getAdapter } from "../lib/adapters";
import type { GridSystem } from "../lib/types";
import type { GridLayerConfig } from "../map/GridMap";
import { SYSTEM_COLORS } from "../map/style";

interface Props {
  label: string;
  config: GridLayerConfig;
  onChange: (config: GridLayerConfig) => void;
  levelDisabled?: boolean;
}

export function GridSelector({ label, config, onChange, levelDisabled }: Props) {
  const adapter = getAdapter(config.system);
  return (
    <div className="grid-selector">
      <span className="grid-selector-label">{label}</span>
      <select
        value={config.system}
        onChange={(e) => {
          const system = e.target.value as GridSystem;
          onChange({
            ...config,
            system,
            level: getAdapter(system).defaultLevel,
          });
        }}
      >
        {availableSystems().map((a) => (
          <option key={a.system} value={a.system}>
            {a.displayName}
          </option>
        ))}
      </select>
      <select
        value={String(config.level)}
        disabled={levelDisabled}
        onChange={(e) => {
          const raw = e.target.value;
          const asNum = Number(raw);
          onChange({
            ...config,
            level: isNaN(asNum) || String(asNum) !== raw ? raw : asNum,
          });
        }}
      >
        {adapter.levels.map((lv) => (
          <option key={String(lv.value)} value={String(lv.value)}>
            {lv.label}
          </option>
        ))}
      </select>
      <details className="inline-details">
        <summary>表示</summary>
        <label>
          線 {Math.round(config.lineOpacity * 100)}%
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={config.lineOpacity}
            onChange={(e) =>
              onChange({ ...config, lineOpacity: parseFloat(e.target.value) })
            }
          />
        </label>
        <label>
          面 {Math.round(config.fillOpacity * 100)}%
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={config.fillOpacity}
            onChange={(e) =>
              onChange({ ...config, fillOpacity: parseFloat(e.target.value) })
            }
          />
        </label>
        <label>
          線幅 {config.lineWidth ?? 1}px
          <input
            type="range"
            min={0.5}
            max={5}
            step={0.5}
            value={config.lineWidth ?? 1}
            onChange={(e) =>
              onChange({ ...config, lineWidth: parseFloat(e.target.value) })
            }
          />
        </label>
        <label className="row">
          線色
          <input
            type="color"
            value={config.lineColor ?? SYSTEM_COLORS[config.system]}
            onChange={(e) => onChange({ ...config, lineColor: e.target.value })}
          />
          {config.lineColor && (
            <button
              className="mini"
              onClick={() => onChange({ ...config, lineColor: undefined })}
            >
              標準色に戻す
            </button>
          )}
        </label>
        <label className="row">
          <input
            type="checkbox"
            checked={config.showLabels}
            onChange={(e) =>
              onChange({ ...config, showLabels: e.target.checked })
            }
          />
          選択セルのラベル
        </label>
        <label className="row">
          <input
            type="checkbox"
            checked={config.showParent ?? false}
            onChange={(e) =>
              onChange({ ...config, showParent: e.target.checked })
            }
          />
          親セル表示（破線）
        </label>
        <label className="row">
          <input
            type="checkbox"
            checked={config.showChildren ?? false}
            onChange={(e) =>
              onChange({ ...config, showChildren: e.target.checked })
            }
          />
          子セル表示（細線）
        </label>
        <label className="row">
          <input
            type="checkbox"
            checked={config.visible}
            onChange={(e) => onChange({ ...config, visible: e.target.checked })}
          />
          グリッド表示
        </label>
        {config.system === "spatial-id" && (
          <>
            <hr className="sep" />
            <label>
              高度（楕円体高） {config.heightM ?? 0} m
              <input
                type="range"
                min={-500}
                max={10000}
                step={50}
                value={config.heightM ?? 0}
                onChange={(e) =>
                  onChange({ ...config, heightM: parseFloat(e.target.value) })
                }
              />
              <input
                type="number"
                step={10}
                value={config.heightM ?? 0}
                onChange={(e) =>
                  onChange({
                    ...config,
                    heightM: parseFloat(e.target.value) || 0,
                  })
                }
              />
            </label>
            <label className="row">
              <input
                type="checkbox"
                checked={config.show3d ?? false}
                onChange={(e) =>
                  onChange({ ...config, show3d: e.target.checked })
                }
              />
              3Dボクセル表示
            </label>
            {config.show3d && (
              <label>
                高さ倍率 ×{config.heightScale ?? 1}
                <input
                  type="range"
                  min={0.2}
                  max={10}
                  step={0.2}
                  value={config.heightScale ?? 1}
                  onChange={(e) =>
                    onChange({
                      ...config,
                      heightScale: parseFloat(e.target.value),
                    })
                  }
                />
              </label>
            )}
          </>
        )}
      </details>
    </div>
  );
}
