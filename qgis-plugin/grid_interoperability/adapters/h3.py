# -*- coding: utf-8 -*-
"""H3アダプター（h3 v4 Pythonバインディングのラッパー）。

Web版 src/lib/adapters/h3.ts と同一の面積アルゴリズム（球面過剰法）を使う。
"""

import math
from typing import List, Optional

import h3

from ..core.geometry import distance_m, polygon_area_m2
from ..core.models import GridCell

SYSTEM = "h3"
DEFAULT_LEVEL = 8


def _unwrap_ring(ring, center_lon):
    """境界リングを中心経度基準でアンラップ（日付変更線対策）."""
    out = []
    for lon, lat in ring:
        x = lon
        while x - center_lon > 180:
            x -= 360
        while x - center_lon < -180:
            x += 360
        out.append((x, lat))
    return out


def _build_cell(cell_id: str) -> GridCell:
    if not h3.is_valid_cell(cell_id):
        raise ValueError("無効なH3セルIDです: %s" % cell_id)
    res = h3.get_resolution(cell_id)
    lat, lng = h3.cell_to_latlng(cell_id)
    boundary = h3.cell_to_boundary(cell_id)  # [(lat, lng), ...] 開リング
    ring = [(p[1], p[0]) for p in boundary]
    ring.append(ring[0])
    ring = _unwrap_ring(ring, lng)
    edge_sum = sum(
        distance_m(ring[i], ring[i + 1]) for i in range(len(ring) - 1)
    )
    return GridCell(
        system=SYSTEM,
        id=cell_id,
        level=res,
        rings=[ring],
        center=(lng, lat),
        area_m2=polygon_area_m2([ring]),
        edge_length_m=edge_sum / (len(ring) - 1),
        parent_id=h3.cell_to_parent(cell_id, res - 1) if res > 0 else None,
        child_count=len(h3.cell_to_children(cell_id, res + 1)) if res < 15 else 0,
    )


def point_to_cell(lon: float, lat: float, level, height_m: float = 0.0) -> GridCell:
    return _build_cell(h3.latlng_to_cell(lat, lon, int(level)))


def cell_to_geometry(cell_id: str) -> GridCell:
    return _build_cell(cell_id)


def get_parent(cell_id: str) -> Optional[str]:
    res = h3.get_resolution(cell_id)
    return h3.cell_to_parent(cell_id, res - 1) if res > 0 else None


def get_children(cell_id: str) -> List[str]:
    res = h3.get_resolution(cell_id)
    return list(h3.cell_to_children(cell_id, res + 1)) if res < 15 else []


def get_neighbors(cell_id: str) -> List[str]:
    return [c for c in h3.grid_disk(cell_id, 1) if c != cell_id]


def cells_for_bounds(bounds, level) -> List[GridCell]:
    res = int(level)
    min_lon, min_lat, max_lon, max_lat = bounds
    # セル中心がポリゴン内のセルのみ返るため、辺長の約3倍だけ範囲を拡張する
    edge_m = h3.average_hexagon_edge_length(res, unit="m")
    mid_lat = (min_lat + max_lat) / 2
    pad_lat = edge_m * 3 / 111320.0
    pad_lon = pad_lat / max(math.cos(math.radians(mid_lat)), 0.1)
    poly = h3.LatLngPoly(
        [
            (max(min_lat - pad_lat, -90), min_lon - pad_lon),
            (max(min_lat - pad_lat, -90), max_lon + pad_lon),
            (min(max_lat + pad_lat, 90), max_lon + pad_lon),
            (min(max_lat + pad_lat, 90), min_lon - pad_lon),
        ]
    )
    ids = h3.polygon_to_cells(poly, res)
    if len(ids) > 1000000:
        raise ValueError("セル数が多すぎます。解像度を下げてください。")
    return [_build_cell(c) for c in ids]


def levels_for_ui():
    return [(r, "resolution %d" % r) for r in range(16)]
