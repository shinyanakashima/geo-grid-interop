# -*- coding: utf-8 -*-
"""Processingアルゴリズム共通ヘルパー。"""

from qgis.core import (
    QgsCoordinateReferenceSystem,
    QgsCoordinateTransform,
    QgsFeature,
    QgsField,
    QgsFields,
    QgsGeometry,
    QgsPointXY,
    QgsProject,
)
from qgis.PyQt.QtCore import QVariant

from ..core.models import GridCell

# UI表示順のグリッド方式（Processingのenumインデックスと対応）
SYSTEM_KEYS = ["jismesh", "h3", "s2", "geohash", "xyz", "spatial-id"]
SYSTEM_LABELS = ["地域標準メッシュ", "H3", "S2", "Geohash", "XYZタイル", "空間ID"]

WGS84 = QgsCoordinateReferenceSystem("EPSG:4326")


def parse_level(system: str, text: str):
    """レベル文字列をアダプターのレベル値へ変換する。

    jismesh: "1"/"2"/"3"/"half"/"quarter"/"eighth"（3次=「3」）
    h3/xyz/spatial-id: 整数
    """
    text = str(text).strip()
    if system == "jismesh":
        aliases = {
            "1次": "1",
            "2次": "2",
            "3次": "3",
            "1/2": "half",
            "1/4": "quarter",
            "1/8": "eighth",
        }
        level = aliases.get(text, text)
        from ..adapters import jismesh

        if level not in jismesh.LEVELS:
            raise ValueError(
                "地域標準メッシュのレベルは 1 / 2 / 3 / half / quarter / eighth "
                "のいずれかを指定してください: %s" % text
            )
        return level
    try:
        return int(text)
    except ValueError:
        raise ValueError("レベルは整数で指定してください: %s" % text)


def cell_fields() -> QgsFields:
    fields = QgsFields()
    fields.append(QgsField("system", QVariant.String))
    fields.append(QgsField("cell_id", QVariant.String))
    fields.append(QgsField("level", QVariant.String))
    fields.append(QgsField("area_m2", QVariant.Double))
    fields.append(QgsField("parent_id", QVariant.String))
    fields.append(QgsField("center_lon", QVariant.Double))
    fields.append(QgsField("center_lat", QVariant.Double))
    return fields


def cell_geometry(cell: GridCell) -> QgsGeometry:
    return QgsGeometry.fromPolygonXY(
        [[QgsPointXY(x, y) for x, y in ring] for ring in cell.rings]
    )


def cell_feature(cell: GridCell, fields: QgsFields) -> QgsFeature:
    feat = QgsFeature(fields)
    feat.setGeometry(cell_geometry(cell))
    feat.setAttributes(
        [
            cell.system,
            cell.id,
            str(cell.level),
            float(cell.area_m2),
            cell.parent_id or "",
            float(cell.center[0]),
            float(cell.center[1]),
        ]
    )
    return feat


def extent_to_wgs84(extent, crs, context):
    """任意CRSの範囲を WGS84 の (min_lon, min_lat, max_lon, max_lat) へ変換."""
    if crs != WGS84:
        transform = QgsCoordinateTransform(
            crs, WGS84, context.transformContext() if context else QgsProject.instance()
        )
        extent = transform.transformBoundingBox(extent)
    return (
        extent.xMinimum(),
        extent.yMinimum(),
        extent.xMaximum(),
        extent.yMaximum(),
    )
