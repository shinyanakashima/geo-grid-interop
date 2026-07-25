# -*- coding: utf-8 -*-
"""表示範囲のグリッド生成アルゴリズム（指示書 §15.4）。"""

from qgis.core import (
    QgsProcessing,
    QgsProcessingAlgorithm,
    QgsProcessingException,
    QgsProcessingParameterEnum,
    QgsProcessingParameterExtent,
    QgsProcessingParameterFeatureSink,
    QgsProcessingParameterString,
)

from ..adapters import get_adapter
from .common import (
    SYSTEM_KEYS,
    SYSTEM_LABELS,
    WGS84,
    cell_feature,
    cell_fields,
    extent_to_wgs84,
    parse_level,
)

MAX_CELLS = 200000


class GenerateGridAlgorithm(QgsProcessingAlgorithm):
    EXTENT = "EXTENT"
    SYSTEM = "SYSTEM"
    LEVEL = "LEVEL"
    OUTPUT = "OUTPUT"

    def name(self):
        return "generategrid"

    def displayName(self):
        return "グリッド生成（範囲指定）"

    def group(self):
        return "グリッド"

    def groupId(self):
        return "grid"

    def shortHelpString(self):
        return (
            "指定範囲に指定方式・レベルのグリッドセルを生成します。"
            "レベル: 地域標準メッシュは 1 / 2 / 3 / half / quarter / eighth、"
            "H3は 0-15、XYZ・空間IDは 0-20。"
        )

    def createInstance(self):
        return GenerateGridAlgorithm()

    def initAlgorithm(self, config=None):
        self.addParameter(QgsProcessingParameterExtent(self.EXTENT, "対象範囲"))
        self.addParameter(
            QgsProcessingParameterEnum(self.SYSTEM, "グリッド方式", SYSTEM_LABELS, defaultValue=0)
        )
        self.addParameter(
            QgsProcessingParameterString(self.LEVEL, "レベル", defaultValue="3")
        )
        self.addParameter(
            QgsProcessingParameterFeatureSink(
                self.OUTPUT, "グリッドセル", QgsProcessing.TypeVectorPolygon
            )
        )

    def processAlgorithm(self, parameters, context, feedback):
        system = SYSTEM_KEYS[self.parameterAsEnum(parameters, self.SYSTEM, context)]
        level = parse_level(
            system, self.parameterAsString(parameters, self.LEVEL, context)
        )
        crs = self.parameterAsExtentCrs(parameters, self.EXTENT, context)
        extent = self.parameterAsExtent(parameters, self.EXTENT, context)
        bounds = extent_to_wgs84(extent, crs, context)

        try:
            cells = get_adapter(system).cells_for_bounds(bounds, level)
        except (ValueError, ImportError) as e:
            raise QgsProcessingException(str(e))
        if len(cells) > MAX_CELLS:
            raise QgsProcessingException(
                "セル数が %d で上限 %d を超えます。レベルを下げてください。"
                % (len(cells), MAX_CELLS)
            )

        fields = cell_fields()
        sink, dest_id = self.parameterAsSink(
            parameters, self.OUTPUT, context, fields, 3, WGS84  # 3 = Polygon
        )
        total = max(len(cells), 1)
        for i, cell in enumerate(cells):
            if feedback.isCanceled():
                break
            sink.addFeature(cell_feature(cell, fields))
            if i % 500 == 0:
                feedback.setProgress(int(i / total * 100))
        return {self.OUTPUT: dest_id}
