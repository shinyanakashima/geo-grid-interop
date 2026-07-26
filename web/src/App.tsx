import { useCallback, useRef, useState } from "react";
import { CompareMode } from "./components/CompareMode";
import { CorrespondMode } from "./components/CorrespondMode";
import { ConvertMode } from "./components/ConvertMode";
import { BackgroundPanel } from "./components/BackgroundPanel";
import { DEFAULT_BACKGROUND, BackgroundSettings } from "./map/style";
import {
  AppState,
  readStateFromUrl,
  writeStateToUrl,
} from "./lib/urlState";

const MODES = [
  { id: "compare", label: "メッシュ比較" },
  { id: "correspond", label: "セル対応確認" },
  { id: "convert", label: "グリッド変換" },
] as const;

export default function App() {
  const stateRef = useRef<AppState>(readStateFromUrl());
  const [mode, setMode] = useState<AppState["mode"]>(stateRef.current.mode);
  const [bg, setBg] = useState<BackgroundSettings>({
    ...DEFAULT_BACKGROUND,
    basemap: stateRef.current.basemap,
  });
  const [shared, setShared] = useState(false);

  const patchState = useCallback((patch: Partial<AppState>) => {
    Object.assign(stateRef.current, patch);
    writeStateToUrl(stateRef.current);
  }, []);

  const onViewChange = useCallback(
    (lng: number, lat: number, zoom: number) => {
      patchState({ lng, lat, zoom });
    },
    [patchState]
  );

  const share = () => {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setShared(true);
      setTimeout(() => setShared(false), 2000);
    });
  };

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <svg className="brand-mark" viewBox="0 0 26 26" aria-hidden="true">
            <rect x="1" y="1" width="24" height="24" rx="5" fill="#2563eb" />
            <path
              d="M9 1v24 M17 1v24 M1 9h24 M1 17h24"
              stroke="rgba(255,255,255,.55)"
              strokeWidth="1.4"
            />
            <path
              d="M13 5.5l6.1 3.6v7.3L13 20.5l-6.1-4.1V9.1z"
              fill="none"
              stroke="#fff"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
          </svg>
          <h1>空間グリッド比較・変換基盤</h1>
        </div>
        <nav>
          {MODES.map((m) => (
            <button
              key={m.id}
              className={mode === m.id ? "tab active" : "tab"}
              onClick={() => {
                setMode(m.id);
                patchState({ mode: m.id });
              }}
            >
              {m.label}
            </button>
          ))}
        </nav>
        <div className="header-right">
          <BackgroundPanel
            bg={bg}
            onChange={(next) => {
              setBg(next);
              patchState({ basemap: next.basemap });
            }}
          />
          <button onClick={share}>{shared ? "コピーしました" : "共有URL"}</button>
        </div>
      </header>
      <main className="main">
        {mode === "compare" && (
          <CompareMode
            bg={bg}
            urlState={stateRef.current}
            onViewChange={onViewChange}
            onStateChange={patchState}
          />
        )}
        {mode === "correspond" && (
          <CorrespondMode
            bg={bg}
            urlState={stateRef.current}
            onViewChange={onViewChange}
            onStateChange={patchState}
          />
        )}
        {mode === "convert" && <ConvertMode />}
      </main>
    </div>
  );
}
