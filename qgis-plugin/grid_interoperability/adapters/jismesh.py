# -*- coding: utf-8 -*-
"""地域標準メッシュ（JIS X 0410）アダプター。

Web版 src/lib/adapters/jismesh.ts と同一ロジック。
座標の丸め規則: セル境界上の点は EPS 付き floor により
北東側（値の大きい側）のセルに属する（半開区間 [下端, 上端)）。
"""

import math
from typing import List, Optional, Tuple

from ..core.geometry import distance_m, polygon_area_m2, rect_ring
from ..core.models import GridCell

SYSTEM = "jismesh"

# level -> (latSpan, lonSpan, codeLength)
LEVELS = {
    "1": (2.0 / 3.0, 1.0, 4),
    "2": (1.0 / 12.0, 1.0 / 8.0, 6),
    "3": (1.0 / 120.0, 1.0 / 80.0, 8),
    "half": (1.0 / 240.0, 1.0 / 160.0, 9),
    "quarter": (1.0 / 480.0, 1.0 / 320.0, 10),
    "eighth": (1.0 / 960.0, 1.0 / 640.0, 11),
}

LEVEL_ORDER = ["1", "2", "3", "half", "quarter", "eighth"]

LEVEL_LABELS = {
    "1": "1次メッシュ（約80km）",
    "2": "2次メッシュ（約10km）",
    "3": "3次メッシュ（約1km）",
    "half": "2分の1メッシュ（約500m）",
    "quarter": "4分の1メッシュ（約250m）",
    "eighth": "8分の1メッシュ（約125m）",
}

DEFAULT_LEVEL = "3"

# 浮動小数点誤差でセル境界上の点が隣セルへ落ちるのを防ぐ許容量（Web版と同値）
EPS = 1e-9


def _assert_in_range(lon: float, lat: float) -> None:
    if lat < 0 or lat >= 66.66 or lon < 100 or lon >= 180:
        raise ValueError(
            "地域標準メッシュの適用範囲外です (lon=%s, lat=%s)" % (lon, lat)
        )


def level_of_code(code: str) -> str:
    if not code.isdigit():
        raise ValueError("無効なメッシュコードです: %s" % code)
    for level in LEVEL_ORDER:
        if LEVELS[level][2] == len(code):
            return level
    raise ValueError("無効なメッシュコードです: %s" % code)


def to_mesh_code(lon: float, lat: float, level: str) -> str:
    _assert_in_range(lon, lat)
    p = math.floor(lat * 1.5 + EPS)
    u = math.floor(lon + EPS) - 100
    code = "%02d%02d" % (p, u)
    if level == "1":
        return code

    q = math.floor(lat * 12 + EPS) % 8
    v = math.floor(lon * 8 + EPS) % 8
    code += "%d%d" % (q, v)
    if level == "2":
        return code

    r = math.floor(lat * 120 + EPS) % 10
    w = math.floor(lon * 80 + EPS) % 10
    code += "%d%d" % (r, w)
    if level == "3":
        return code

    depth = {"half": 1, "quarter": 2, "eighth": 3}[level]
    lat_mul, lon_mul = 240, 160
    for _ in range(depth):
        lat_bit = math.floor(lat * lat_mul + EPS) % 2
        lon_bit = math.floor(lon * lon_mul + EPS) % 2
        code += str(lat_bit * 2 + lon_bit + 1)
        lat_mul *= 2
        lon_mul *= 2
    return code


def code_to_south_west(code: str) -> Tuple[float, float]:
    level = level_of_code(code)
    lat_min = int(code[0:2]) / 1.5
    lon_min = int(code[2:4]) + 100.0
    if level == "1":
        return lon_min, lat_min

    lat_min += int(code[4]) / 12.0
    lon_min += int(code[5]) / 8.0
    if level == "2":
        return lon_min, lat_min

    lat_min += int(code[6]) / 120.0
    lon_min += int(code[7]) / 80.0
    if level == "3":
        return lon_min, lat_min

    lat_span, lon_span = 1.0 / 240.0, 1.0 / 160.0
    for ch in code[8:]:
        d = int(ch) - 1
        if d < 0 or d > 3:
            raise ValueError("無効なメッシュコードです: %s" % code)
        lat_min += (d >> 1) * lat_span
        lon_min += (d & 1) * lon_span
        lat_span /= 2
        lon_span /= 2
    return lon_min, lat_min


def cell_from_code(code: str) -> GridCell:
    level = level_of_code(code)
    lat_span, lon_span, _ = LEVELS[level]
    lon_min, lat_min = code_to_south_west(code)
    lon_max = lon_min + lon_span
    lat_max = lat_min + lat_span
    ring = rect_ring(lon_min, lat_min, lon_max, lat_max)
    center = (lon_min + lon_span / 2, lat_min + lat_span / 2)
    idx = LEVEL_ORDER.index(level)
    return GridCell(
        system=SYSTEM,
        id=code,
        level=level,
        rings=[ring],
        center=center,
        area_m2=polygon_area_m2([ring]),
        width_m=distance_m((lon_min, center[1]), (lon_max, center[1])),
        height_m=distance_m((center[0], lat_min), (center[0], lat_max)),
        parent_id=get_parent(code) if idx > 0 else None,
        child_count=(
            64 if level == "1" else 100 if level == "2" else 0 if level == "eighth" else 4
        ),
    )


def point_to_cell(lon: float, lat: float, level, height_m: float = 0.0) -> GridCell:
    return cell_from_code(to_mesh_code(lon, lat, str(level)))


def cell_to_geometry(code: str) -> GridCell:
    return cell_from_code(code)


def get_parent(code: str) -> Optional[str]:
    level = level_of_code(code)
    idx = LEVEL_ORDER.index(level)
    if idx == 0:
        return None
    parent_level = LEVEL_ORDER[idx - 1]
    return code[: LEVELS[parent_level][2]]


def get_children(code: str) -> List[str]:
    level = level_of_code(code)
    idx = LEVEL_ORDER.index(level)
    if idx == len(LEVEL_ORDER) - 1:
        return []
    if level == "1":
        return ["%s%d%d" % (code, q, v) for q in range(8) for v in range(8)]
    if level == "2":
        return ["%s%d%d" % (code, r, w) for r in range(10) for w in range(10)]
    return ["%s%d" % (code, d) for d in range(1, 5)]


def get_neighbors(code: str) -> List[str]:
    level = level_of_code(code)
    lat_span, lon_span, _ = LEVELS[level]
    lon_min, lat_min = code_to_south_west(code)
    c_lon = lon_min + lon_span / 2
    c_lat = lat_min + lat_span / 2
    out = []
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dx == 0 and dy == 0:
                continue
            try:
                out.append(
                    to_mesh_code(c_lon + dx * lon_span, c_lat + dy * lat_span, level)
                )
            except ValueError:
                pass
    return out


def cells_for_bounds(bounds, level) -> List[GridCell]:
    level = str(level)
    min_lon, min_lat, max_lon, max_lat = bounds
    lat_span, lon_span, _ = LEVELS[level]
    lat0 = max(min_lat, 0.0)
    lat1 = min(max_lat, 66.66 - lat_span / 2)
    lon0 = max(min_lon, 100.0)
    lon1 = min(max_lon, 180.0 - lon_span / 2)
    if lat0 > lat1 or lon0 > lon1:
        return []
    i_min = math.floor(lat0 / lat_span + EPS)
    i_max = math.floor(lat1 / lat_span + EPS)
    j_min = math.floor(lon0 / lon_span + EPS)
    j_max = math.floor(lon1 / lon_span + EPS)
    if (i_max - i_min + 1) * (j_max - j_min + 1) > 1000000:
        raise ValueError("セル数が多すぎます。レベルを下げてください。")
    cells = []
    for i in range(i_min, i_max + 1):
        for j in range(j_min, j_max + 1):
            lat = (i + 0.5) * lat_span
            lon = (j + 0.5) * lon_span
            cells.append(cell_from_code(to_mesh_code(lon, lat, level)))
    return cells


def levels_for_ui():
    return [(lv, LEVEL_LABELS[lv]) for lv in LEVEL_ORDER]
