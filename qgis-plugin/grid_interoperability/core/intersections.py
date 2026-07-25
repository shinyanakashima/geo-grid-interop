# -*- coding: utf-8 -*-
"""グリッド間の交差・包含関係計算。Web版 src/lib/intersect.ts と同一仕様。

ポリゴン交差は Shapely があれば Shapely を、無ければ QGIS の QgsGeometry を
使う。交差面積はどちらの場合も経緯度リングに対する球面過剰法で計算し、
Web版と結果を一致させる（指示書 §16）。
"""

import math
from typing import List, Optional, Tuple

from .geometry import polygon_area_m2
from .models import GridCell, GridIntersection

# 交差面積の相対誤差がこの範囲なら包含・一致とみなす（Web版と同値）
RATIO_EPS = 1e-6

try:
    from shapely.geometry import Polygon as _ShpPolygon

    _HAS_SHAPELY = True
except ImportError:  # pragma: no cover
    _HAS_SHAPELY = False


def _rings_to_shapely(rings):
    return _ShpPolygon(rings[0], rings[1:])


def _intersection_rings_shapely(a_rings, b_rings) -> List[List[List[Tuple[float, float]]]]:
    inter = _rings_to_shapely(a_rings).intersection(_rings_to_shapely(b_rings))
    polys = []
    geoms = getattr(inter, "geoms", [inter])
    for g in geoms:
        if g.geom_type != "Polygon" or g.is_empty:
            continue
        rings = [list(g.exterior.coords)]
        rings.extend(list(r.coords) for r in g.interiors)
        polys.append(rings)
    return polys


def _intersection_rings_qgis(a_rings, b_rings):  # pragma: no cover - QGIS環境のみ
    from qgis.core import QgsGeometry, QgsPointXY

    def to_geom(rings):
        return QgsGeometry.fromPolygonXY(
            [[QgsPointXY(x, y) for x, y in ring] for ring in rings]
        )

    inter = to_geom(a_rings).intersection(to_geom(b_rings))
    if inter.isEmpty():
        return []
    polys = []
    multi = inter.asMultiPolygon() or ([inter.asPolygon()] if inter.asPolygon() else [])
    for poly in multi:
        rings = []
        for ring in poly:
            coords = [(p.x(), p.y()) for p in ring]
            if coords and coords[0] != coords[-1]:
                coords.append(coords[0])
            rings.append(coords)
        if rings:
            polys.append(rings)
    return polys


def intersection_area_m2(a_rings, b_rings) -> float:
    """2ポリゴンの交差の球面面積 [m^2]."""
    if _HAS_SHAPELY:
        polys = _intersection_rings_shapely(a_rings, b_rings)
    else:
        polys = _intersection_rings_qgis(a_rings, b_rings)
    return sum(polygon_area_m2(rings) for rings in polys)


def classify_relation(
    intersection_area: float, source_area: float, target_area: float
) -> str:
    if intersection_area <= 0:
        return "touches"
    src_ratio = intersection_area / source_area
    tgt_ratio = intersection_area / target_area
    if src_ratio >= 1 - RATIO_EPS and tgt_ratio >= 1 - RATIO_EPS:
        return "equal"
    if tgt_ratio >= 1 - RATIO_EPS:
        return "contains"  # source が target を包含
    if src_ratio >= 1 - RATIO_EPS:
        return "within"  # source が target に包含
    return "overlaps"


def intersect_cells(source: GridCell, target: GridCell) -> Optional[GridIntersection]:
    area = intersection_area_m2(source.rings, target.rings)
    if area <= 0:
        return None
    return GridIntersection(
        source_system=source.system,
        source_id=source.id,
        target_system=target.system,
        target_id=target.id,
        intersection_area_m2=area,
        source_area_m2=source.area_m2,
        target_area_m2=target.area_m2,
        source_ratio=area / source.area_m2,
        target_ratio=area / target.area_m2,
        relation=classify_relation(area, source.area_m2, target.area_m2),
    )


def cell_bounds(cell: GridCell) -> Tuple[float, float, float, float]:
    lons = [p[0] for ring in cell.rings for p in ring]
    lats = [p[1] for ring in cell.rings for p in ring]
    return min(lons), min(lats), max(lons), max(lats)


def compute_correspondence(
    base: GridCell, target_system: str, target_level, max_cells: int = 100000
):
    """基準セルと交差する対象方式のセルと交差統計を返す。

    戻り値: (intersections, target_cells, stats)
    """
    from ..adapters import get_adapter

    adapter = get_adapter(target_system)
    candidates = adapter.cells_for_bounds(cell_bounds(base), target_level)
    if len(candidates) > max_cells:
        raise ValueError(
            "交差計算対象が %d セルあり上限 %d を超えます。レベルを下げてください。"
            % (len(candidates), max_cells)
        )
    intersections = []
    target_cells = []
    for cell in candidates:
        ix = intersect_cells(base, cell)
        if ix is not None:
            intersections.append(ix)
            target_cells.append(cell)
    contained = sum(
        1 for i in intersections if i.relation in ("contains", "equal")
    )
    ratio_sum = sum(i.source_ratio for i in intersections)
    stats = {
        "intersect_count": len(intersections),
        "contained_count": contained,
        "boundary_count": len(intersections) - contained,
        "ratio_sum": ratio_sum,
        "ratio_error": abs(1 - ratio_sum),
    }
    return intersections, target_cells, stats


def level_by_area_match(target_system: str, lon: float, lat: float, reference_area_m2: float):
    """面積一致: 指定地点で基準セル面積に最も近いレベルを選ぶ（指示書 §8.7）."""
    from ..adapters import get_adapter

    adapter = get_adapter(target_system)
    best = adapter.DEFAULT_LEVEL
    best_diff = float("inf")
    for value, _label in adapter.levels_for_ui():
        try:
            cell = adapter.point_to_cell(lon, lat, value)
        except (ValueError, OverflowError):
            continue
        diff = abs(math.log(cell.area_m2 / reference_area_m2))
        if diff < best_diff:
            best_diff = diff
            best = value
    return best
