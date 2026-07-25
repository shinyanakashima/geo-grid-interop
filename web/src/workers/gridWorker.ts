/**
 * グリッド計算 Web Worker（指示書 §13.2）。
 * セル境界生成・交差判定・レベル自動選択・変換をメインスレッド外で行う。
 */

import { getAdapter } from "../lib/adapters";
import { computeCorrespondence, levelByAreaMatch } from "../lib/intersect";
import { applyRounding, convertCell } from "../lib/convert";
import type { ConversionOptions, ConversionRecord } from "../lib/convert";
import type { GridSystem } from "../lib/types";

export type WorkerRequest =
  | {
      type: "cells";
      system: GridSystem;
      level: number | string;
      bounds: [number, number, number, number];
      maxCells: number;
    }
  | {
      type: "correspondence";
      baseSystem: GridSystem;
      baseId: string;
      targets: { system: GridSystem; level: number | string }[];
    }
  | {
      type: "area-match";
      targetSystem: GridSystem;
      lon: number;
      lat: number;
      referenceAreaM2: number;
    }
  | {
      type: "convert";
      sources: { system: GridSystem; id: string; value?: number }[];
      options: ConversionOptions;
    };

export interface WorkerMessage {
  requestId: number;
  payload: WorkerRequest;
}

self.onmessage = (ev: MessageEvent<WorkerMessage>) => {
  const { requestId, payload } = ev.data;
  try {
    const result = handle(payload);
    self.postMessage({ requestId, ok: true, result });
  } catch (e) {
    self.postMessage({
      requestId,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
};

function handle(req: WorkerRequest): unknown {
  switch (req.type) {
    case "cells": {
      const cells = getAdapter(req.system).cellsForBounds(req.bounds, req.level);
      if (cells.length > req.maxCells) {
        throw new Error(
          `現在の範囲ではセル数が多すぎます（${cells.length} > ${req.maxCells}）。解像度を下げてください。`
        );
      }
      return cells;
    }
    case "correspondence": {
      const base = getAdapter(req.baseSystem).cellToGeometry(req.baseId);
      return {
        base,
        results: req.targets.map((t) =>
          computeCorrespondence(base, t.system, t.level)
        ),
      };
    }
    case "area-match":
      return levelByAreaMatch(
        req.targetSystem,
        req.lon,
        req.lat,
        req.referenceAreaM2
      );
    case "convert": {
      const records: ConversionRecord[] = [];
      for (const src of req.sources) {
        const cell = getAdapter(src.system).cellToGeometry(src.id);
        records.push(...convertCell(cell, req.options, src.value));
      }
      return applyRounding(records, req.options.rounding ?? "none");
    }
  }
}
