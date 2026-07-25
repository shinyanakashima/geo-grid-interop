/** 選択セルの比較表（指示書 §8.8, §8.9） */

import type { GridCell } from "../lib/types";
import { distanceM, formatArea, formatLength } from "../lib/geo";
import { getAdapter } from "../lib/adapters";

interface Props {
  left: GridCell | null;
  right: GridCell | null;
  clickPoint: [number, number] | null;
}

function fmtCenter(c: GridCell | null): string {
  if (!c) return "-";
  return `${c.center[1].toFixed(5)}, ${c.center[0].toFixed(5)}`;
}

function fmtDistance(c: GridCell | null, p: [number, number] | null): string {
  if (!c || !p) return "-";
  return formatLength(distanceM(p, c.center));
}

function neighborCount(c: GridCell | null): string {
  if (!c) return "-";
  try {
    return String(getAdapter(c.system).getNeighbors(c.id).length);
  } catch {
    return "-";
  }
}

export function CellInfoTable({ left, right, clickPoint }: Props) {
  if (!left && !right) {
    return (
      <p className="hint">地図をクリックすると、その地点を含むセルを左右で選択します。</p>
    );
  }
  const rows: [string, string, string][] = [
    [
      "方式",
      left ? getAdapter(left.system).displayName : "-",
      right ? getAdapter(right.system).displayName : "-",
    ],
    ["セルID", left?.id ?? "-", right?.id ?? "-"],
    ["レベル", String(left?.level ?? "-"), String(right?.level ?? "-")],
    [
      "面積",
      left ? formatArea(left.areaM2) : "-",
      right ? formatArea(right.areaM2) : "-",
    ],
    ["中心座標", fmtCenter(left), fmtCenter(right)],
    ["幅", formatLength(left?.widthM), formatLength(right?.widthM)],
    ["高さ", formatLength(left?.heightM), formatLength(right?.heightM)],
    ["辺長", formatLength(left?.edgeLengthM), formatLength(right?.edgeLengthM)],
    ["親セルID", left?.parentId ?? "-", right?.parentId ?? "-"],
    [
      "子セル数",
      String(left?.childCount ?? "-"),
      String(right?.childCount ?? "-"),
    ],
    ["隣接セル数", neighborCount(left), neighborCount(right)],
    [
      "選択地点から中心まで",
      fmtDistance(left, clickPoint),
      fmtDistance(right, clickPoint),
    ],
  ];
  return (
    <table className="info-table">
      <thead>
        <tr>
          <th>項目</th>
          <th>左</th>
          <th>右</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, l, r]) => (
          <tr key={label}>
            <td>{label}</td>
            <td className="mono">{l}</td>
            <td className="mono">{r}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
