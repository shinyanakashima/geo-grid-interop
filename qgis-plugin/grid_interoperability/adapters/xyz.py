# -*- coding: utf-8 -*-
"""XYZタイルアダプター。Web版 src/lib/adapters/xyz.ts と同一ロジック。

ID形式: "z/x/y"
"""

import math
import re
from typing import List, Optional, Tuple

from ..core.geometry import distance_m, polygon_area_m2, rect_ring
from ..core.models import GridCell

SYSTEM = "xyz"
WEB_MERCATOR_MAX_LAT = 85.0511287798066
DEFAULT_LEVEL = 14

_TILE_RE = re.compile(r"^(\d+)/(\d+)/(\d+)$")


def lon_to_tile_x(lon: float, z: int) -> int:
    n = 2 ** z
    x = math.floor((lon + 180.0) / 360.0 * n)
    return x % n


def lat_to_tile_y(lat: float, z: int) -> int:
    clamped = max(-WEB_MERCATOR_MAX_LAT, min(WEB_MERCATOR_MAX_LAT, lat))
    rad = math.radians(clamped)
    n = 2 ** z
    y = math.floor((1 - math.log(math.tan(rad) + 1 / math.cos(rad)) / math.pi) / 2 * n)
    return max(0, min(n - 1, y))


def tile_x_to_lon(x: float, z: int) -> float:
    return x / (2 ** z) * 360.0 - 180.0


def tile_y_to_lat(y: float, z: int) -> float:
    n = math.pi - 2.0 * math.pi * y / (2 ** z)
    return math.degrees(math.atan(0.5 * (math.exp(n) - math.exp(-n))))


def parse_tile_id(tile_id: str) -> Tuple[int, int, int]:
    m = _TILE_RE.match(tile_id.strip())
    if not m:
        raise ValueError("無効なタイルIDです: %s" % tile_id)
    z, x, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
    n = 2 ** z
    if not (0 <= x < n and 0 <= y < n):
        raise ValueError("無効なタイルIDです: %s" % tile_id)
    return z, x, y


def tile_bounds(z: int, x: int, y: int) -> Tuple[float, float, float, float]:
    return (
        tile_x_to_lon(x, z),
        tile_y_to_lat(y + 1, z),
        tile_x_to_lon(x + 1, z),
        tile_y_to_lat(y, z),
    )


def build_tile_cell(z: int, x: int, y: int, system: str = SYSTEM, f: int = 0) -> GridCell:
    lon_min, lat_min, lon_max, lat_max = tile_bounds(z, x, y)
    ring = rect_ring(lon_min, lat_min, lon_max, lat_max)
    center = ((lon_min + lon_max) / 2, (lat_min + lat_max) / 2)
    if system == SYSTEM:
        cell_id = "%d/%d/%d" % (z, x, y)
        parent = "%d/%d/%d" % (z - 1, x >> 1, y >> 1) if z > 0 else None
        child_count = 4
    else:
        cell_id = "/%d/%d/%d/%d" % (z, f, x, y)
        parent = (
            "/%d/%d/%d/%d" % (z - 1, f >> 1, x >> 1, y >> 1) if z > 0 else None
        )
        child_count = 8
    cell = GridCell(
        system=system,
        id=cell_id,
        level=z,
        rings=[ring],
        center=center,
        area_m2=polygon_area_m2([ring]),
        width_m=distance_m((lon_min, center[1]), (lon_max, center[1])),
        height_m=distance_m((center[0], lat_min), (center[0], lat_max)),
        parent_id=parent,
        child_count=child_count,
    )
    if system != SYSTEM:
        # 空間IDの鉛直方向: ズームレベル z の1ボクセルの高さは 2^(25-z) m
        voxel_h = 2.0 ** (25 - z)
        cell.min_height_m = f * voxel_h
        cell.max_height_m = (f + 1) * voxel_h
    return cell


def tiles_for_bounds(bounds, z: int) -> List[Tuple[int, int]]:
    min_lon, min_lat, max_lon, max_lat = bounds
    x_min = lon_to_tile_x(max(min_lon, -179.9999999), z)
    x_max = lon_to_tile_x(min(max_lon, 179.9999999), z)
    y_min = lat_to_tile_y(min(max_lat, WEB_MERCATOR_MAX_LAT), z)
    y_max = lat_to_tile_y(max(min_lat, -WEB_MERCATOR_MAX_LAT), z)
    n = 2 ** z
    if x_min <= x_max:
        xs = list(range(x_min, x_max + 1))
    else:
        # 国際日付変更線をまたぐ範囲
        xs = list(range(x_min, n)) + list(range(0, x_max + 1))
    if len(xs) * (y_max - y_min + 1) > 1000000:
        raise ValueError("セル数が多すぎます。ズームレベルを下げてください。")
    return [(x, y) for x in xs for y in range(y_min, y_max + 1)]


def point_to_cell(lon: float, lat: float, level, height_m: float = 0.0) -> GridCell:
    z = int(level)
    if abs(lat) > WEB_MERCATOR_MAX_LAT:
        raise ValueError("XYZタイルは緯度±85.05°を超える範囲に対応していません")
    return build_tile_cell(z, lon_to_tile_x(lon, z), lat_to_tile_y(lat, z))


def cell_to_geometry(tile_id: str) -> GridCell:
    z, x, y = parse_tile_id(tile_id)
    return build_tile_cell(z, x, y)


def get_parent(tile_id: str) -> Optional[str]:
    z, x, y = parse_tile_id(tile_id)
    return "%d/%d/%d" % (z - 1, x >> 1, y >> 1) if z > 0 else None


def get_children(tile_id: str) -> List[str]:
    z, x, y = parse_tile_id(tile_id)
    cz = z + 1
    return [
        "%d/%d/%d" % (cz, x * 2, y * 2),
        "%d/%d/%d" % (cz, x * 2 + 1, y * 2),
        "%d/%d/%d" % (cz, x * 2, y * 2 + 1),
        "%d/%d/%d" % (cz, x * 2 + 1, y * 2 + 1),
    ]


def get_neighbors(tile_id: str) -> List[str]:
    z, x, y = parse_tile_id(tile_id)
    n = 2 ** z
    out = []
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dx == 0 and dy == 0:
                continue
            ny = y + dy
            if ny < 0 or ny >= n:
                continue
            nx = (x + dx) % n  # 経度方向はラップ
            out.append("%d/%d/%d" % (z, nx, ny))
    return out


def cells_for_bounds(bounds, level) -> List[GridCell]:
    z = int(level)
    return [build_tile_cell(z, x, y) for x, y in tiles_for_bounds(bounds, z)]


def levels_for_ui():
    return [(z, "zoom %d" % z) for z in range(21)]
