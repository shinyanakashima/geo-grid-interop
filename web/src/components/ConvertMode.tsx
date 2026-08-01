/**
 * モード3: グリッド変換（指示書 §10）。
 * MVP: 地域標準メッシュコード付きCSV、またはセルIDリストを他方式へ変換する。
 */

import { useMemo, useState } from "react";
import { availableSystems, getAdapter } from "../lib/adapters";
import type { GridSystem } from "../lib/types";
import type {
  ConversionMethod,
  ConversionRecord,
  RoundingMethod,
} from "../lib/convert";
import { recordsToCsv, recordsToGeoJson } from "../lib/convert";
import { callWorker } from "../workers/client";
import { downloadText } from "../lib/download";

const METHOD_LABELS: Record<ConversionMethod, string> = {
  centroid: "重心割当",
  "largest-overlap": "最大重複面積",
  "areal-weighted": "面積按分",
  "all-intersections": "全交差セルへ関連付け",
  "within-only": "完全包含セルのみ",
  threshold: "閾値指定（最低交差率）",
};

const ROUNDING_LABELS: Record<RoundingMethod, string> = {
  none: "小数のまま",
  round: "四捨五入",
  "largest-remainder": "最大剰余法（合計値を維持）",
};

/** 簡易CSVパース（引用符対応） */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    if (row.some((f) => f !== "")) rows.push(row);
  }
  return rows;
}

export function ConvertMode() {
  const [sourceSystem, setSourceSystem] = useState<GridSystem>("jismesh");
  const [idText, setIdText] = useState("");
  const [csvRows, setCsvRows] = useState<string[][] | null>(null);
  const [csvName, setCsvName] = useState("");
  const [codeColumn, setCodeColumn] = useState(0);
  const [valueColumn, setValueColumn] = useState(-1);
  const [targetSystem, setTargetSystem] = useState<GridSystem>("h3");
  const [targetLevel, setTargetLevel] = useState<number | string>(8);
  const [method, setMethod] = useState<ConversionMethod>("areal-weighted");
  const [threshold, setThreshold] = useState(1);
  const [rounding, setRounding] = useState<RoundingMethod>("none");
  const [records, setRecords] = useState<ConversionRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const MAX_SOURCE_CELLS = 500;

  const header = csvRows?.[0] ?? null;

  const sources = useMemo(() => {
    if (csvRows && csvRows.length > 1) {
      return csvRows.slice(1).map((row) => ({
        system: sourceSystem,
        id: row[codeColumn]?.trim() ?? "",
        value:
          valueColumn >= 0 && row[valueColumn] !== undefined
            ? parseFloat(row[valueColumn])
            : undefined,
      }));
    }
    return idText
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((id) => ({ system: sourceSystem, id, value: undefined }));
  }, [csvRows, idText, sourceSystem, codeColumn, valueColumn]);

  const handleFile = (file: File) => {
    file.text().then((text) => {
      const rows = parseCsv(text);
      if (rows.length < 2) {
        setError("CSVにデータ行がありません");
        return;
      }
      setCsvRows(rows);
      setCsvName(file.name);
      setError(null);
      // メッシュコード列の自動検出
      const head = rows[0].map((h) => h.toLowerCase());
      const codeIdx = head.findIndex(
        (h) => h.includes("mesh") || h.includes("メッシュ") || h.includes("code")
      );
      setCodeColumn(codeIdx >= 0 ? codeIdx : 0);
      const valIdx = rows[0].findIndex((_, i) => {
        if (i === (codeIdx >= 0 ? codeIdx : 0)) return false;
        const v = parseFloat(rows[1][i]);
        return isFinite(v);
      });
      setValueColumn(valIdx);
    });
  };

  const run = () => {
    const valid = sources.filter((s) => s.id);
    if (!valid.length) {
      setError("変換元セルがありません");
      return;
    }
    if (valid.length > MAX_SOURCE_CELLS) {
      setError(
        `変換元セルが ${valid.length} 件あります。ブラウザ内処理の上限は ${MAX_SOURCE_CELLS} 件です（大規模変換は第2段階のWorkers APIで対応予定）。`
      );
      return;
    }
    setBusy(true);
    setError(null);
    callWorker<ConversionRecord[]>({
      type: "convert",
      sources: valid,
      options: {
        targetSystem,
        targetLevel,
        method,
        minSourceRatio: threshold / 100,
        rounding,
      },
    })
      .then(setRecords)
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };

  return (
    <div className="convert-mode">
      <div className="convert-form">
        <h3>変換元</h3>
        <label>
          グリッド方式
          <select
            value={sourceSystem}
            onChange={(e) => setSourceSystem(e.target.value as GridSystem)}
          >
            {availableSystems().map((a) => (
              <option key={a.system} value={a.system}>
                {a.displayName}
              </option>
            ))}
          </select>
        </label>
        <label>
          CSVファイル（メッシュコード付き）
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
        </label>
        {header && (
          <>
            <p className="hint">{csvName}: {csvRows!.length - 1} 行</p>
            <label>
              コード列
              <select
                value={codeColumn}
                onChange={(e) => setCodeColumn(parseInt(e.target.value, 10))}
              >
                {header.map((h, i) => (
                  <option key={i} value={i}>{h || `列${i + 1}`}</option>
                ))}
              </select>
            </label>
            <label>
              属性値列（面積按分対象）
              <select
                value={valueColumn}
                onChange={(e) => setValueColumn(parseInt(e.target.value, 10))}
              >
                <option value={-1}>（なし）</option>
                {header.map((h, i) => (
                  <option key={i} value={i}>{h || `列${i + 1}`}</option>
                ))}
              </select>
            </label>
          </>
        )}
        {!csvRows && (
          <label>
            またはセルIDを直接入力（空白・カンマ区切り）
            <textarea
              rows={3}
              value={idText}
              onChange={(e) => setIdText(e.target.value)}
              placeholder="例: 644142883 644142884"
            />
          </label>
        )}
        <h3>変換先</h3>
        <label>
          グリッド方式
          <select
            value={targetSystem}
            onChange={(e) => {
              const system = e.target.value as GridSystem;
              setTargetSystem(system);
              setTargetLevel(getAdapter(system).defaultLevel);
            }}
          >
            {availableSystems().map((a) => (
              <option key={a.system} value={a.system}>
                {a.displayName}
              </option>
            ))}
          </select>
        </label>
        <label>
          レベル
          <select
            value={String(targetLevel)}
            onChange={(e) => {
              const raw = e.target.value;
              const asNum = Number(raw);
              setTargetLevel(isNaN(asNum) || String(asNum) !== raw ? raw : asNum);
            }}
          >
            {getAdapter(targetSystem).levels.map((lv) => (
              <option key={String(lv.value)} value={String(lv.value)}>
                {lv.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          変換方法
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as ConversionMethod)}
          >
            {Object.entries(METHOD_LABELS).map(([m, label]) => (
              <option key={m} value={m}>{label}</option>
            ))}
          </select>
        </label>
        {method === "threshold" && (
          <label>
            最低交差率 {threshold}%
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={threshold}
              onChange={(e) => setThreshold(parseInt(e.target.value, 10))}
            />
          </label>
        )}
        {method === "areal-weighted" && (
          <label>
            整数化方法
            <select
              value={rounding}
              onChange={(e) => setRounding(e.target.value as RoundingMethod)}
            >
              {Object.entries(ROUNDING_LABELS).map(([m, label]) => (
                <option key={m} value={m}>{label}</option>
              ))}
            </select>
          </label>
        )}
        <button className="primary" onClick={run} disabled={busy}>
          {busy ? "変換中..." : "変換を実行"}
        </button>
        {error && <div className="error-bar">{error}</div>}
        {method === "areal-weighted" && (
          <p className="hint">
            面積按分値は推計値です。属性値がセル内で均等分布しているとは限りません。
          </p>
        )}
      </div>
      <div className="convert-result">
        <div className="export-row">
          <span>{records.length ? `${records.length} 件の対応` : ""}</span>
          <button
            onClick={() =>
              downloadText("conversion.csv", recordsToCsv(records), "text/csv")
            }
            disabled={!records.length}
          >
            CSV出力
          </button>
          <button
            onClick={() =>
              downloadText(
                "conversion.geojson",
                recordsToGeoJson(records),
                "application/geo+json"
              )
            }
            disabled={!records.length}
          >
            GeoJSON出力
          </button>
        </div>
        {records.length === 0 && !busy && (
          <div className="empty-state">
            <p>変換元セルと変換先グリッドを指定して「変換を実行」すると、
            対応関係と按分結果がここに表示されます。</p>
          </div>
        )}
        {records.length > 0 && (
          <div className="table-scroll">
            <table className="info-table small">
              <thead>
                <tr>
                  <th>変換元ID</th>
                  <th>変換先ID</th>
                  <th>交差率(元)</th>
                  <th>交差率(先)</th>
                  <th>元属性値</th>
                  <th>変換後属性値</th>
                  <th>推計</th>
                </tr>
              </thead>
              <tbody>
                {records.slice(0, 200).map((r, i) => (
                  <tr key={i}>
                    <td className="mono">{r.sourceId}</td>
                    <td className="mono">{r.targetId}</td>
                    <td>{(r.sourceRatio * 100).toFixed(2)}%</td>
                    <td>{(r.targetRatio * 100).toFixed(2)}%</td>
                    <td>{r.sourceValue ?? ""}</td>
                    <td>
                      {r.targetValue !== undefined
                        ? Number.isInteger(r.targetValue)
                          ? r.targetValue
                          : r.targetValue.toFixed(3)
                        : ""}
                    </td>
                    <td>{r.isEstimated ? "推計値" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {records.length > 200 && (
              <p className="hint">先頭200件のみ表示。全件はCSV/GeoJSONで出力してください。</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
