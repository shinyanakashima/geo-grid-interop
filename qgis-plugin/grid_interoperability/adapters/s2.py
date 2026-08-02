# -*- coding: utf-8 -*-
"""S2アダプター（s2sphere ラッパー）。

ID形式: S2セルトークン（16進、例 "60188bfc"）。レベル 0-30。
Web版 src/lib/adapters/s2.ts と同一の辺分割数・面積アルゴリズムを使う。
"""

import math
from typing import List, Optional

import s2sphere

from ..core.geometry import distance_m, polygon_area_m2
from ..core.models import GridCell

SYSTEM = "s2"
DEFAULT_LEVEL = 13
MAX_LEVEL = 30

# 1辺あたりの分割数（Web版 SUBDIV と同値にすること）
SUBDIV = 4


def _token_to_id(token: str) -> s2sphere.CellId:
    cid = s2sphere.CellId.from_token(token.strip())
    if not cid.is_valid():
        raise ValueError("無効なS2セルトークンです: %s" % token)
    return cid


def _interpolate(a, b, t):
    """球面上の2点間を弦補間して正規化（Web版と同一の近似）."""
    x = a[0] + (b[0] - a[0]) * t
    y = a[1] + (b[1] - a[1]) * t
    z = a[2] + (b[2] - a[2]) * t
    n = math.sqrt(x * x + y * y + z * z)
    lat = math.degrees(math.asin(max(-1.0, min(1.0, z / n))))
    lng = math.degrees(math.atan2(y, x))
    return (lng, lat)


def _unwrap_ring(ring, center_lon):
    out = []
    for lon, lat in ring:
        x = lon
        while x - center_lon > 180:
            x -= 360
        while x - center_lon < -180:
            x += 360
        out.append((x, lat))
    return out


def _cell_ring(cid: s2sphere.CellId):
    """セル境界リング（辺を SUBDIV 分割、閉じたリング）."""
    cell = s2sphere.Cell(cid)
    verts = [cell.get_vertex(k) for k in range(4)]
    ring = []
    for k in range(4):
        a, b = verts[k], verts[(k + 1) % 4]
        for i in range(SUBDIV):
            ring.append(_interpolate(a, b, i / SUBDIV))
    ring.append(ring[0])
    center = cid.to_lat_lng()
    return _unwrap_ring(ring, center.lng().degrees)


def _build_cell(cid: s2sphere.CellId) -> GridCell:
    level = cid.level()
    ll = cid.to_lat_lng()
    center = (ll.lng().degrees, ll.lat().degrees)
    ring = _cell_ring(cid)
    edge_sum = sum(
        distance_m(ring[k * SUBDIV], ring[((k + 1) % 4) * SUBDIV])
        for k in range(4)
    )
    return GridCell(
        system=SYSTEM,
        id=cid.to_token(),
        level=level,
        rings=[ring],
        center=center,
        area_m2=polygon_area_m2([ring]),
        edge_length_m=edge_sum / 4,
        parent_id=cid.parent(level - 1).to_token() if level > 0 else None,
        child_count=4 if level < MAX_LEVEL else 0,
    )


def point_to_cell(lon: float, lat: float, level, height_m: float = 0.0) -> GridCell:
    leaf = s2sphere.CellId.from_lat_lng(s2sphere.LatLng.from_degrees(lat, lon))
    return _build_cell(leaf.parent(int(level)))


def cell_to_geometry(token: str) -> GridCell:
    return _build_cell(_token_to_id(token))


def get_parent(token: str) -> Optional[str]:
    cid = _token_to_id(token)
    return cid.parent(cid.level() - 1).to_token() if cid.level() > 0 else None


def get_children(token: str) -> List[str]:
    cid = _token_to_id(token)
    if cid.level() >= MAX_LEVEL:
        return []
    return [c.to_token() for c in cid.children()]


def get_neighbors(token: str) -> List[str]:
    return [n.to_token() for n in _token_to_id(token).get_edge_neighbors()]


def _ring_bounds(ring):
    lons = [p[0] for p in ring]
    lats = [p[1] for p in ring]
    return (min(lons), min(lats), max(lons), max(lats))


def _boxes_intersect(a, b):
    lon_overlap = any(
        a[0] + s <= b[2] and a[2] + s >= b[0] for s in (-360, 0, 360)
    )
    return lon_overlap and a[1] <= b[3] and a[3] >= b[1]


def _cells_for_box(box, level, collected, max_cells):
    """中心セルから辺隣接BFSで範囲交差セルを列挙（Web版と同一ロジック）."""
    min_lon, min_lat, max_lon, max_lat = box
    seed = s2sphere.CellId.from_lat_lng(
        s2sphere.LatLng.from_degrees(
            (min_lat + max_lat) / 2, (min_lon + max_lon) / 2
        )
    ).parent(level)
    queue = [seed]
    visited = {seed.to_token()}
    while queue:
        cid = queue.pop(0)
        cell = _build_cell(cid)
        if not _boxes_intersect(_ring_bounds(cell.rings[0]), box):
            continue
        collected[cell.id] = cell
        if len(collected) > max_cells:
            raise ValueError("セル数が多すぎます。レベルを下げてください。")
        for n in cid.get_edge_neighbors():
            token = n.to_token()
            if token not in visited:
                visited.add(token)
                queue.append(n)


def cells_for_bounds(bounds, level) -> List[GridCell]:
    min_lon, min_lat, max_lon, max_lat = bounds
    collected = {}
    if min_lon <= max_lon:
        boxes = [(min_lon, min_lat, max_lon, max_lat)]
    else:
        # 国際日付変更線をまたぐ範囲は分割する
        boxes = [(min_lon, min_lat, 180.0, max_lat), (-180.0, min_lat, max_lon, max_lat)]
    for box in boxes:
        _cells_for_box(box, int(level), collected, 1000000)
    return list(collected.values())


def levels_for_ui():
    return [(lv, "level %d" % lv) for lv in range(MAX_LEVEL + 1)]
