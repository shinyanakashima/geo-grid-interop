/** 共通データモデル（指示書 §12） */

export type GridSystem =
  | "jismesh"
  | "h3"
  | "s2"
  | "geohash"
  | "xyz"
  | "spatial-id";

export type Position = [number, number];

export interface PolygonGeometry {
  type: "Polygon";
  coordinates: Position[][];
}

export interface MultiPolygonGeometry {
  type: "MultiPolygon";
  coordinates: Position[][][];
}

export interface GridCell {
  system: GridSystem;
  id: string;
  level: number | string;

  geometry: PolygonGeometry | MultiPolygonGeometry;
  center: [number, number];

  areaM2: number;
  widthM?: number;
  heightM?: number;
  edgeLengthM?: number;

  parentId?: string;
  childIds?: string[];
  childCount?: number;
  neighbors?: string[];

  minHeightM?: number;
  maxHeightM?: number;

  metadata?: Record<string, unknown>;
}

export type SpatialRelation =
  | "contains"
  | "within"
  | "overlaps"
  | "touches"
  | "equal";

export interface GridIntersection {
  sourceSystem: GridSystem;
  sourceId: string;

  targetSystem: GridSystem;
  targetId: string;

  intersectionAreaM2: number;
  sourceAreaM2: number;
  targetAreaM2: number;

  /** 交差面積 ÷ 変換元セル面積 */
  sourceRatio: number;
  /** 交差面積 ÷ 変換先セル面積 */
  targetRatio: number;

  relation: SpatialRelation;
}

export interface LevelDef {
  /** アダプター内部で使うレベル値 */
  value: number | string;
  /** UI 表示名 */
  label: string;
}

export interface GridAdapter {
  system: GridSystem;
  /** UI 表示名 */
  displayName: string;
  /** 選択可能なレベル一覧（UI用） */
  levels: LevelDef[];
  /** デフォルトレベル */
  defaultLevel: number | string;

  pointToCell(
    longitude: number,
    latitude: number,
    level: number | string,
    heightM?: number
  ): GridCell;

  cellToGeometry(id: string): GridCell;

  getParent(id: string): string | null;

  getChildren(id: string): string[];

  getNeighbors(id: string): string[];

  cellsForBounds(
    bounds: [number, number, number, number],
    level: number | string
  ): GridCell[];
}
