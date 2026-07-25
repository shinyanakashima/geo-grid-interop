/** 背景地図の表示調整（指示書 §6.3） */

import { BASEMAPS, BackgroundSettings, BasemapId } from "../map/style";

interface Props {
  bg: BackgroundSettings;
  onChange: (bg: BackgroundSettings) => void;
}

export function BackgroundPanel({ bg, onChange }: Props) {
  return (
    <details className="panel-section">
      <summary>背景地図設定</summary>
      <label>
        背景地図
        <select
          value={bg.basemap}
          onChange={(e) =>
            onChange({ ...bg, basemap: e.target.value as BasemapId })
          }
        >
          {Object.entries(BASEMAPS).map(([id, { label }]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        透過度 {Math.round((1 - bg.opacity) * 100)}%
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={1 - bg.opacity}
          onChange={(e) =>
            onChange({ ...bg, opacity: 1 - parseFloat(e.target.value) })
          }
        />
      </label>
      <label>
        彩度 {Math.round(((bg.saturation + 1) / 2) * 100)}%
        <input
          type="range"
          min={-1}
          max={1}
          step={0.05}
          value={bg.saturation}
          onChange={(e) =>
            onChange({ ...bg, saturation: parseFloat(e.target.value) })
          }
        />
      </label>
      <label>
        明るさ {Math.round(bg.brightness * 100)}%
        <input
          type="range"
          min={0.2}
          max={1}
          step={0.05}
          value={bg.brightness}
          onChange={(e) =>
            onChange({ ...bg, brightness: parseFloat(e.target.value) })
          }
        />
      </label>
      <label className="row">
        <input
          type="checkbox"
          checked={!bg.visible}
          onChange={(e) => onChange({ ...bg, visible: !e.target.checked })}
        />
        背景非表示（白背景）
      </label>
    </details>
  );
}
