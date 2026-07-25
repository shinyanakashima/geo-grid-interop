# -*- coding: utf-8 -*-
"""共通データモデル（指示書 §12）。Web版 src/lib/types.ts と対応する。"""

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple, Union

GridSystem = str  # "jismesh" | "h3" | "s2" | "geohash" | "xyz" | "spatial-id"

Ring = List[Tuple[float, float]]


@dataclass
class GridCell:
    system: GridSystem
    id: str
    level: Union[int, str]

    # 外環のみの矩形/六角形セルを想定した単一リング
    rings: List[Ring]
    center: Tuple[float, float]

    area_m2: float
    width_m: Optional[float] = None
    height_m: Optional[float] = None
    edge_length_m: Optional[float] = None

    parent_id: Optional[str] = None
    child_count: Optional[int] = None
    neighbors: Optional[List[str]] = None

    min_height_m: Optional[float] = None
    max_height_m: Optional[float] = None

    metadata: Dict = field(default_factory=dict)


@dataclass
class GridIntersection:
    source_system: GridSystem
    source_id: str

    target_system: GridSystem
    target_id: str

    intersection_area_m2: float
    source_area_m2: float
    target_area_m2: float

    source_ratio: float
    target_ratio: float

    relation: str  # "contains" | "within" | "overlaps" | "touches" | "equal"
