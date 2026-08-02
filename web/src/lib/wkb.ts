/**
 * GeoJSON Polygon / MultiPolygon → WKB（little-endian）エンコーダ。
 * GeoParquet の geometry 列（WKBエンコーディング）用。
 */

import type { MultiPolygonGeometry, PolygonGeometry, Position } from "./types";

const WKB_POLYGON = 3;
const WKB_MULTIPOLYGON = 6;

function polygonByteLength(rings: Position[][]): number {
  // byteOrder(1) + type(4) + numRings(4) + 各リング: numPoints(4) + 16*points
  return 9 + rings.reduce((sum, ring) => sum + 4 + ring.length * 16, 0);
}

function writePolygonBody(
  view: DataView,
  offset: number,
  rings: Position[][]
): number {
  view.setUint8(offset, 1); // little-endian
  view.setUint32(offset + 1, WKB_POLYGON, true);
  view.setUint32(offset + 5, rings.length, true);
  let pos = offset + 9;
  for (const ring of rings) {
    view.setUint32(pos, ring.length, true);
    pos += 4;
    for (const [x, y] of ring) {
      view.setFloat64(pos, x, true);
      view.setFloat64(pos + 8, y, true);
      pos += 16;
    }
  }
  return pos;
}

export function geometryToWkb(
  geometry: PolygonGeometry | MultiPolygonGeometry
): Uint8Array {
  if (geometry.type === "Polygon") {
    const rings = geometry.coordinates as Position[][];
    const buf = new ArrayBuffer(polygonByteLength(rings));
    writePolygonBody(new DataView(buf), 0, rings);
    return new Uint8Array(buf);
  }
  const polygons = geometry.coordinates as Position[][][];
  const total =
    9 + polygons.reduce((sum, rings) => sum + polygonByteLength(rings), 0);
  const buf = new ArrayBuffer(total);
  const view = new DataView(buf);
  view.setUint8(0, 1);
  view.setUint32(1, WKB_MULTIPOLYGON, true);
  view.setUint32(5, polygons.length, true);
  let pos = 9;
  for (const rings of polygons) {
    pos = writePolygonBody(view, pos, rings);
  }
  return new Uint8Array(buf);
}
