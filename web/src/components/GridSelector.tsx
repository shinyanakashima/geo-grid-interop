/** グリッド方式・レベル・表示スタイルの選択（指示書 §8.6） */

import { availableSystems, getAdapter } from "../lib/adapters";
import type { GridSystem } from "../lib/types";
import type { GridLayerConfig } from "../map/GridMap";

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
            checked={config.visible}
            onChange={(e) => onChange({ ...config, visible: e.target.checked })}
          />
          グリッド表示
        </label>
      </details>
    </div>
  );
}
