/**
 * 共通テストケース生成（指示書 §16, §17）。
 * Web版アダプターで各テスト地点の期待値を計算し、
 * shared/testcases/grid-cells.json へ出力する。
 * QGISプラグイン側のテストは同じJSONを読み込み、同一IDが得られることを確認する。
 *
 * 実行: npm run generate-testcases
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getAdapter } from "../src/lib/adapters";

const points = [
  { name: "帯広", longitude: 143.196, latitude: 42.923 },
  { name: "札幌", longitude: 141.3544, latitude: 43.0621 },
  { name: "東京駅", longitude: 139.767125, latitude: 35.681236 },
  { name: "那覇", longitude: 127.6809, latitude: 26.2124 },
  { name: "赤道付近", longitude: 104.0, latitude: 0.5 },
  { name: "高緯度（緯度84.9度）", longitude: 20.0, latitude: 84.9 },
  { name: "国際日付変更線付近（東側）", longitude: 179.999, latitude: 52.0 },
  { name: "国際日付変更線付近（西側）", longitude: -179.999, latitude: 52.0 },
  { name: "3次メッシュ境界上", longitude: 143.2, latitude: 42.925 },
  { name: "海上（太平洋）", longitude: 145.0, latitude: 40.0 },
];

const heights = [
  { name: "地上0m", heightM: 0 },
  { name: "高高度10000m", heightM: 10000 },
  { name: "地下（-50m）", heightM: -50 },
];

interface Expected {
  level: number | string;
  id: string;
  areaM2?: number;
  centerLon?: number;
  centerLat?: number;
  parentId?: string | null;
}

const cases: unknown[] = [];

for (const p of points) {
  const expected: Record<string, Expected | null> = {};
  for (const { system, level } of [
    { system: "jismesh" as const, level: "3" },
    { system: "h3" as const, level: 8 },
    { system: "xyz" as const, level: 14 },
    { system: "spatial-id" as const, level: 14 },
  ]) {
    try {
      const cell = getAdapter(system).pointToCell(
        p.longitude,
        p.latitude,
        level,
        0
      );
      expected[system] = {
        level,
        id: cell.id,
        areaM2: Math.round(cell.areaM2 * 100) / 100,
        centerLon: cell.center[0],
        centerLat: cell.center[1],
        parentId: cell.parentId ?? null,
      };
    } catch {
      expected[system] = null; // 適用範囲外
    }
  }
  cases.push({ ...p, heightM: 0, expected });
}

// 空間IDの鉛直方向テスト（z=14, ボクセル高 2^11 = 2048 m）
const verticalCases = heights.map((h) => {
  const cell = getAdapter("spatial-id").pointToCell(
    139.767125,
    35.681236,
    14,
    h.heightM
  );
  return {
    name: `空間ID鉛直: ${h.name}`,
    longitude: 139.767125,
    latitude: 35.681236,
    heightM: h.heightM,
    expected: {
      "spatial-id": {
        level: 14,
        id: cell.id,
        minHeightM: cell.minHeightM,
        maxHeightM: cell.maxHeightM,
      },
    },
  };
});

const out = {
  description:
    "Web版とQGIS版の計算結果整合性を確認する共通テストケース（指示書 §16）",
  generatedBy: "web/scripts/generate-testcases.ts",
  areaAlgorithm: "spherical-excess R=6371008.7714",
  cases: [...cases, ...verticalCases],
};

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, "../../shared/testcases/grid-cells.json");
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, JSON.stringify(out, null, 2) + "\n");
console.log(`wrote ${target} (${out.cases.length} cases)`);
