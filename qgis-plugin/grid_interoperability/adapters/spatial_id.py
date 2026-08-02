# -*- coding: utf-8 -*-
"""空間ID（ZFXY）アダプター。Web版 src/lib/adapters/spatialid.ts と同一ロジック。

ID形式: "/z/f/x/y"。水平方向の境界はXYZタイルと一致し、
鉛直方向はズームレベル z における1ボクセルの高さを 2^(25-z) m とする。
"""

import math
import re
from typing import List, Optional

from ..core.models import GridCell
from . import xyz as _xyz

SYSTEM = "spatial-id"
DEFAULT_LEVEL = 14

_SID_RE = re.compile(r"^/?(\d+)/(-?\d+)/(\d+)/(\d+)$")


def parse_spatial_id(sid: str):
    m = _SID_RE.match(sid.strip())
    if not m:
        raise ValueError("無効な空間IDです: %s" % sid)
    z, f, x, y = (int(m.group(i)) for i in range(1, 5))
    n = 2 ** z
    if not (0 <= x < n and 0 <= y < n):
        raise ValueError("無効な空間IDです: %s" % sid)
    return z, f, x, y


def height_to_f(height_m: float, z: int) -> int:
    return math.floor(height_m / 2.0 ** (25 - z))


def point_to_cell(lon: float, lat: float, level, height_m: float = 0.0) -> GridCell:
    z = int(level)
    if abs(lat) > _xyz.WEB_MERCATOR_MAX_LAT:
        raise ValueError("空間IDは緯度±85.05°を超える範囲に対応していません")
    f = height_to_f(height_m, z)
    return _xyz.build_tile_cell(
        z, _xyz.lon_to_tile_x(lon, z), _xyz.lat_to_tile_y(lat, z), SYSTEM, f
    )


def cell_to_geometry(sid: str) -> GridCell:
    z, f, x, y = parse_spatial_id(sid)
    return _xyz.build_tile_cell(z, x, y, SYSTEM, f)


def get_parent(sid: str) -> Optional[str]:
    z, f, x, y = parse_spatial_id(sid)
    return "/%d/%d/%d/%d" % (z - 1, f >> 1, x >> 1, y >> 1) if z > 0 else None


def get_children(sid: str) -> List[str]:
    z, f, x, y = parse_spatial_id(sid)
    cz = z + 1
    return [
        "/%d/%d/%d/%d" % (cz, cf, cx, cy)
        for cf in (f * 2, f * 2 + 1)
        for cx in (x * 2, x * 2 + 1)
        for cy in (y * 2, y * 2 + 1)
    ]


def get_neighbors(sid: str) -> List[str]:
    z, f, x, y = parse_spatial_id(sid)
    n = 2 ** z
    out = []
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dx == 0 and dy == 0:
                continue
            ny = y + dy
            if ny < 0 or ny >= n:
                continue
            nx = (x + dx) % n
            out.append("/%d/%d/%d/%d" % (z, f, nx, ny))
    return out


def cells_for_bounds(bounds, level, height_m: float = 0.0) -> List[GridCell]:
    z = int(level)
    f = height_to_f(height_m, z)
    return [
        _xyz.build_tile_cell(z, x, y, SYSTEM, f)
        for x, y in _xyz.tiles_for_bounds(bounds, z)
    ]


def levels_for_ui():
    return [(z, "zoom %d" % z) for z in range(21)]
