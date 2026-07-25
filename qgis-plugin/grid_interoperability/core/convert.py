# -*- coding: utf-8 -*-
"""グリッド変換（指示書 §10）。Web版 src/lib/convert.ts と同一仕様。"""

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import List, Optional, Union

from .intersections import compute_correspondence, intersect_cells
from .models import GridCell

METHODS = [
    ("centroid", "重心割当"),
    ("largest-overlap", "最大重複面積"),
    ("areal-weighted", "面積按分"),
    ("all-intersections", "全交差セルへ関連付け"),
    ("within-only", "完全包含セルのみ"),
    ("threshold", "閾値指定（最低交差率）"),
]

ROUNDINGS = [
    ("none", "小数のまま"),
    ("round", "四捨五入"),
    ("largest-remainder", "最大剰余法（合計値を維持）"),
]


@dataclass
class ConversionRecord:
    source_system: str
    source_id: str
    source_level: Union[int, str]
    target_system: str
    target_id: str
    target_level: Union[int, str]
    intersection_area_m2: float
    source_area_m2: float
    target_area_m2: float
    source_ratio: float
    target_ratio: float
    source_value: Optional[float]
    target_value: Optional[float]
    method: str
    is_estimated: bool
    target_cell: Optional[GridCell]
    converted_at: str


def convert_cell(
    source: GridCell,
    target_system: str,
    target_level,
    method: str,
    value: Optional[float] = None,
    min_source_ratio: float = 0.01,
) -> List[ConversionRecord]:
    from ..adapters import get_adapter

    adapter = get_adapter(target_system)
    converted_at = datetime.now(timezone.utc).isoformat()

    def to_record(ix, cell, target_value=None, is_estimated=False):
        return ConversionRecord(
            source_system=source.system,
            source_id=source.id,
            source_level=source.level,
            target_system=target_system,
            target_id=ix.target_id,
            target_level=target_level,
            intersection_area_m2=ix.intersection_area_m2,
            source_area_m2=ix.source_area_m2,
            target_area_m2=ix.target_area_m2,
            source_ratio=ix.source_ratio,
            target_ratio=ix.target_ratio,
            source_value=value,
            target_value=target_value,
            method=method,
            is_estimated=is_estimated,
            target_cell=cell,
            converted_at=converted_at,
        )

    if method == "centroid":
        cell = adapter.point_to_cell(source.center[0], source.center[1], target_level)
        ix = intersect_cells(source, cell)
        if ix is None:
            from .models import GridIntersection

            ix = GridIntersection(
                source_system=source.system,
                source_id=source.id,
                target_system=target_system,
                target_id=cell.id,
                intersection_area_m2=0.0,
                source_area_m2=source.area_m2,
                target_area_m2=cell.area_m2,
                source_ratio=0.0,
                target_ratio=0.0,
                relation="touches",
            )
        return [to_record(ix, cell, value, False)]

    intersections, target_cells, _stats = compute_correspondence(
        source, target_system, target_level
    )
    pairs = list(zip(intersections, target_cells))

    if method == "largest-overlap":
        ix, cell = max(pairs, key=lambda p: p[0].intersection_area_m2)
        return [to_record(ix, cell, value, False)]
    if method == "areal-weighted":
        return [
            to_record(
                ix,
                cell,
                value * ix.source_ratio if value is not None else None,
                True,
            )
            for ix, cell in pairs
        ]
    if method == "all-intersections":
        return [to_record(ix, cell, value, False) for ix, cell in pairs]
    if method == "within-only":
        return [
            to_record(ix, cell, value, False)
            for ix, cell in pairs
            if ix.relation in ("contains", "equal")
        ]
    if method == "threshold":
        return [
            to_record(ix, cell, value, False)
            for ix, cell in pairs
            if ix.source_ratio >= min_source_ratio
        ]
    raise ValueError("未対応の変換方法です: %s" % method)


def apply_rounding(records: List[ConversionRecord], rounding: str) -> List[ConversionRecord]:
    """整数化（指示書 §10.5）。largest-remainder は変換元セル単位で合計を維持する。"""
    if rounding == "none":
        return records
    if rounding == "round":
        for r in records:
            if r.target_value is not None:
                # Pythonの銀行丸めではなく四捨五入
                r.target_value = int(r.target_value + (0.5 if r.target_value >= 0 else -0.5))
        return records
    if rounding != "largest-remainder":
        raise ValueError("未対応の整数化方法です: %s" % rounding)

    groups = {}
    for r in records:
        groups.setdefault((r.source_system, r.source_id), []).append(r)
    for group in groups.values():
        with_value = [r for r in group if r.target_value is not None]
        if not with_value:
            continue
        total = int(round(sum(r.target_value for r in with_value)))
        floors = [int(r.target_value // 1) for r in with_value]
        remainder = total - sum(floors)
        order = sorted(
            range(len(with_value)),
            key=lambda i: with_value[i].target_value - floors[i],
            reverse=True,
        )
        assigned = list(floors)
        for i in order:
            if remainder <= 0:
                break
            assigned[i] += 1
            remainder -= 1
        for r, v in zip(with_value, assigned):
            r.target_value = v
    return records
