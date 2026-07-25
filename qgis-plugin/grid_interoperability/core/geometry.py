# -*- coding: utf-8 -*-
"""測地計算。Web版 src/lib/geo.ts と同一アルゴリズム・同一半径（指示書 §16）。

Webメルカトル上の平面面積を正式なセル面積として扱わない（指示書 §4.3）。
"""

import math
from typing import List, Sequence, Tuple

# 平均半径 [m]（GRS80: (2a + b) / 3）
EARTH_RADIUS_M = 6371008.7714

Position = Tuple[float, float]


def ring_area_m2(ring: Sequence[Position]) -> float:
    """球面上のリング面積 [m^2]（符号なし・球面過剰法）."""
    if len(ring) < 4:
        return 0.0
    total = 0.0
    for i in range(len(ring) - 1):
        lon1, lat1 = ring[i]
        lon2, lat2 = ring[i + 1]
        total += (
            math.radians(lon2 - lon1)
            * (2 + math.sin(math.radians(lat1)) + math.sin(math.radians(lat2)))
        )
    return abs(total * EARTH_RADIUS_M * EARTH_RADIUS_M / 2)


def polygon_area_m2(rings: Sequence[Sequence[Position]]) -> float:
    """ポリゴン（外環 - 内環）の球面面積 [m^2]."""
    if not rings:
        return 0.0
    area = ring_area_m2(rings[0])
    for hole in rings[1:]:
        area -= ring_area_m2(hole)
    return max(area, 0.0)


def distance_m(a: Position, b: Position) -> float:
    """ハーバサイン距離 [m]."""
    lon1, lat1 = a
    lon2, lat2 = b
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    h = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlon / 2) ** 2
    )
    return 2 * EARTH_RADIUS_M * math.asin(min(1.0, math.sqrt(h)))


def rect_ring(
    lon_min: float, lat_min: float, lon_max: float, lat_max: float
) -> List[Position]:
    """閉じた矩形リング（反時計回り）."""
    return [
        (lon_min, lat_min),
        (lon_max, lat_min),
        (lon_max, lat_max),
        (lon_min, lat_max),
        (lon_min, lat_min),
    ]
