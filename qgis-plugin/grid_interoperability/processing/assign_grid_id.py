# -*- coding: utf-8 -*-
"""レイヤーへのセルID付与アルゴリズム（指示書 §15.5）。"""

from qgis.core import (
    QgsCoordinateTransform,
    QgsField,
    QgsProcessing,
    QgsProcessingAlgorithm,
    QgsProcessingParameterEnum,
    QgsProcessingParameterFeatureSink,
    QgsProcessingParameterFeatureSource,
    QgsProcessingParameterString,
)
from qgis.PyQt.QtCore import QVariant

from ..adapters import get_adapter
from ..core.intersections import intersection_area_m2
from .common import SYSTEM_KEYS, SYSTEM_LABELS, WGS84, parse_level

METHOD_LABELS = [
    "代表点（point on surface）",
    "重心",
    "最大重複面積",
    "交差する全セル（;区切り）",
]


class AssignGridIdAlgorithm(QgsProcessingAlgorithm):
    INPUT = "INPUT"
    SYSTEM = "SYSTEM"
    LEVEL = "LEVEL"
    METHOD = "METHOD"
    OUTPUT = "OUTPUT"

    def name(self):
        return "assigngridid"

    def displayName(self):
        return "セルIDを属性として付与"

    def group(self):
        return "グリッド"

    def groupId(self):
        return "grid"

    def shortHelpString(self):
        return (
            "入力レイヤーの各地物へ、指定グリッド方式のセルIDを cell_id 属性として"
            "付与します。ポイントには代表点方式、ポリゴン・ラインには最大重複面積や"
            "全交差セル方式が使えます。"
        )

    def createInstance(self):
        return AssignGridIdAlgorithm()

    def initAlgorithm(self, config=None):
        self.addParameter(
            QgsProcessingParameterFeatureSource(
                self.INPUT, "入力レイヤー", [QgsProcessing.TypeVectorAnyGeometry]
            )
        )
        self.addParameter(
            QgsProcessingParameterEnum(self.SYSTEM, "グリッド方式", SYSTEM_LABELS, defaultValue=0)
        )
        self.addParameter(
            QgsProcessingParameterString(self.LEVEL, "レベル", defaultValue="3")
        )
        self.addParameter(
            QgsProcessingParameterEnum(self.METHOD, "付与方式", METHOD_LABELS, defaultValue=0)
        )
        self.addParameter(
            QgsProcessingParameterFeatureSink(self.OUTPUT, "ID付与済みレイヤー")
        )

    def processAlgorithm(self, parameters, context, feedback):
        source = self.parameterAsSource(parameters, self.INPUT, context)
        system = SYSTEM_KEYS[self.parameterAsEnum(parameters, self.SYSTEM, context)]
        level = parse_level(
            system, self.parameterAsString(parameters, self.LEVEL, context)
        )
        method = self.parameterAsEnum(parameters, self.METHOD, context)
        adapter = get_adapter(system)

        fields = source.fields()
        fields.append(QgsField("cell_id", QVariant.String))
        sink, dest_id = self.parameterAsSink(
            parameters, self.OUTPUT, context, fields, source.wkbType(), source.sourceCrs()
        )

        transform = None
        if source.sourceCrs() != WGS84:
            transform = QgsCoordinateTransform(
                source.sourceCrs(), WGS84, context.transformContext()
            )

        total = max(source.featureCount(), 1)
        for i, feat in enumerate(source.getFeatures()):
            if feedback.isCanceled():
                break
            geom = feat.geometry()
            wgs_geom = geom if transform is None else self._transformed(geom, transform)
            try:
                cell_id = self._assign(wgs_geom, adapter, level, method)
            except (ValueError, ImportError) as e:
                feedback.pushWarning("fid=%s: %s" % (feat.id(), e))
                cell_id = None
            out = feat
            attrs = feat.attributes()
            attrs.append(cell_id)
            out.setAttributes(attrs)
            sink.addFeature(out)
            if i % 200 == 0:
                feedback.setProgress(int(i / total * 100))
        return {self.OUTPUT: dest_id}

    @staticmethod
    def _transformed(geom, transform):
        g = type(geom)(geom)  # コピーしてから変換
        g.transform(transform)
        return g

    def _assign(self, geom, adapter, level, method):
        if method in (0, 1):  # 代表点 / 重心
            pt = geom.pointOnSurface() if method == 0 else geom.centroid()
            p = pt.asPoint()
            return adapter.point_to_cell(p.x(), p.y(), level).id
        bbox = geom.boundingBox()
        cells = adapter.cells_for_bounds(
            (bbox.xMinimum(), bbox.yMinimum(), bbox.xMaximum(), bbox.yMaximum()),
            level,
        )
        feat_rings = self._geom_rings(geom)
        hits = []
        for cell in cells:
            area = sum(
                intersection_area_m2(rings, cell.rings) for rings in feat_rings
            )
            if area > 0:
                hits.append((area, cell.id))
        if not hits:
            raise ValueError("交差するセルがありません")
        if method == 2:  # 最大重複面積
            return max(hits)[1]
        return ";".join(cell_id for _, cell_id in sorted(hits, reverse=True))

    @staticmethod
    def _geom_rings(geom):
        """ポリゴンジオメトリを [(ポリゴンごとのリング列), ...] へ変換."""
        multi = geom.asMultiPolygon()
        if not multi:
            poly = geom.asPolygon()
            multi = [poly] if poly else []
        out = []
        for poly in multi:
            rings = []
            for ring in poly:
                coords = [(p.x(), p.y()) for p in ring]
                if coords and coords[0] != coords[-1]:
                    coords.append(coords[0])
                rings.append(coords)
            if rings:
                out.append(rings)
        if not out:
            raise ValueError("ポリゴンジオメトリではありません（面ベースの付与方式はポリゴンのみ対応）")
        return out
