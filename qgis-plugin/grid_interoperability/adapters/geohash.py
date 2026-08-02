# -*- coding: utf-8 -*-
"""Geohashアダプター（純Python実装・外部依存なし）。

ID形式: base32文字列（例 "xn76ur"）。レベル = 文字数 1-12。
Web版 src/lib/adapters/geohash.ts（ngeohash）と同一仕様。
"""

from typing import List, Optional, Tuple

from ..core.geometry import distance_m, polygon_area_m2, rect_ring
from ..core.models import GridCell

SYSTEM = "geohash"
DEFAULT_LEVEL = 6
MAX_LENGTH = 12

BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz"
_BASE32_MAP = {ch: i for i, ch in enumerate(BASE32)}


def _assert_valid(geohash: str) -> str:
    h = geohash.strip().lower()
    if not (1 <= len(h) <= MAX_LENGTH) or any(ch not in _BASE32_MAP for ch in h):
        raise ValueError("無効なGeohashです: %s" % geohash)
    return h


def encode(lat: float, lon: float, precision: int) -> str:
    """経緯度→Geohash（標準アルゴリズム、ngeohash.encodeと同一結果）."""
    lat_range = [-90.0, 90.0]
    lon_range = [-180.0, 180.0]
    bits = 0
    bit_count = 0
    even = True  # 経度から開始
    out = []
    while len(out) < precision:
        if even:
            mid = (lon_range[0] + lon_range[1]) / 2
            if lon >= mid:
                bits = bits * 2 + 1
                lon_range[0] = mid
            else:
                bits = bits * 2
                lon_range[1] = mid
        else:
            mid = (lat_range[0] + lat_range[1]) / 2
            if lat >= mid:
                bits = bits * 2 + 1
                lat_range[0] = mid
            else:
                bits = bits * 2
                lat_range[1] = mid
        even = not even
        bit_count += 1
        if bit_count == 5:
            out.append(BASE32[bits])
            bits = 0
            bit_count = 0
    return "".join(out)


def decode_bbox(geohash: str) -> Tuple[float, float, float, float]:
    """Geohash→(min_lat, min_lon, max_lat, max_lon)."""
    h = _assert_valid(geohash)
    lat_range = [-90.0, 90.0]
    lon_range = [-180.0, 180.0]
    even = True
    for ch in h:
        value = _BASE32_MAP[ch]
        for shift in range(4, -1, -1):
            bit = (value >> shift) & 1
            if even:
                mid = (lon_range[0] + lon_range[1]) / 2
                lon_range[0 if bit else 1] = mid
            else:
                mid = (lat_range[0] + lat_range[1]) / 2
                lat_range[0 if bit else 1] = mid
            even = not even
    return lat_range[0], lon_range[0], lat_range[1], lon_range[1]


def _build_cell(geohash: str) -> GridCell:
    h = _assert_valid(geohash)
    min_lat, min_lon, max_lat, max_lon = decode_bbox(h)
    ring = rect_ring(min_lon, min_lat, max_lon, max_lat)
    center = ((min_lon + max_lon) / 2, (min_lat + max_lat) / 2)
    return GridCell(
        system=SYSTEM,
        id=h,
        level=len(h),
        rings=[ring],
        center=center,
        area_m2=polygon_area_m2([ring]),
        width_m=distance_m((min_lon, center[1]), (max_lon, center[1])),
        height_m=distance_m((center[0], min_lat), (center[0], max_lat)),
        parent_id=h[:-1] if len(h) > 1 else None,
        child_count=32 if len(h) < MAX_LENGTH else 0,
    )


def point_to_cell(lon: float, lat: float, level, height_m: float = 0.0) -> GridCell:
    return _build_cell(encode(lat, lon, int(level)))


def cell_to_geometry(geohash: str) -> GridCell:
    return _build_cell(geohash)


def get_parent(geohash: str) -> Optional[str]:
    h = _assert_valid(geohash)
    return h[:-1] if len(h) > 1 else None


def get_children(geohash: str) -> List[str]:
    h = _assert_valid(geohash)
    if len(h) >= MAX_LENGTH:
        return []
    return [h + ch for ch in BASE32]


def get_neighbors(geohash: str) -> List[str]:
    """8近傍（経緯度オフセットで計算）."""
    h = _assert_valid(geohash)
    min_lat, min_lon, max_lat, max_lon = decode_bbox(h)
    lat_span = max_lat - min_lat
    lon_span = max_lon - min_lon
    c_lat = (min_lat + max_lat) / 2
    c_lon = (min_lon + max_lon) / 2
    out = []
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dx == 0 and dy == 0:
                continue
            lat = c_lat + dy * lat_span
            if not (-90 <= lat <= 90):
                continue
            lon = c_lon + dx * lon_span
            if lon > 180:
                lon -= 360
            if lon < -180:
                lon += 360
            out.append(encode(lat, lon, len(h)))
    return out


def cells_for_bounds(bounds, level) -> List[GridCell]:
    min_lon, min_lat, max_lon, max_lat = bounds
    precision = int(level)
    lat0 = max(min_lat, -90.0)
    lat1 = min(max_lat, 90.0)
    if min_lon <= max_lon:
        ranges = [(min_lon, max_lon)]
    else:
        # 国際日付変更線をまたぐ範囲は分割する
        ranges = [(min_lon, 180.0), (-180.0, max_lon)]
    out = {}
    for lon0, lon1 in ranges:
        # 範囲南西端のセルから格子状に列挙する
        sw = decode_bbox(encode(lat0, lon0, precision))
        lat_span = sw[2] - sw[0]
        lon_span = sw[3] - sw[1]
        n_lat = int((lat1 - sw[0]) / lat_span) + 1
        n_lon = int((lon1 - sw[1]) / lon_span) + 1
        if len(out) + n_lat * n_lon > 1000000:
            raise ValueError("セル数が多すぎます。レベルを下げてください。")
        for i in range(n_lat):
            lat = sw[0] + (i + 0.5) * lat_span
            if lat > 90:
                continue
            for j in range(n_lon):
                lon = sw[1] + (j + 0.5) * lon_span
                if lon > 180:
                    lon -= 360
                h = encode(lat, lon, precision)
                if h not in out:
                    out[h] = _build_cell(h)
    return list(out.values())


def levels_for_ui():
    return [(n, "length %d" % n) for n in range(1, MAX_LENGTH + 1)]
