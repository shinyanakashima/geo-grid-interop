# -*- coding: utf-8 -*-
"""グリッド間対応表作成アルゴリズム（指示書 §15.6, §15.7）。"""

from qgis.core import (
    QgsFeature,
    QgsField,
    QgsFields,
    QgsProcessing,
    QgsProcessingAlgorithm,
    QgsProcessingException,
    QgsProcessingParameterEnum,
    QgsProcessingParameterExtent,
    QgsProcessingParameterFeatureSink,
    QgsProcessingParameterNumber,
    QgsProcessingParameterString,
    QgsWkbTypes,
)
from qgis.PyQt.QtCore import QVariant

from ..adapters import get_adapter
from ..core.intersections import compute_correspondence
from .common import SYSTEM_KEYS, SYSTEM_LABELS, extent_to_wgs84, parse_level

MAX_SOURCE_CELLS = 50000


class CreateCrosswalkAlgorithm(QgsProcessingAlgorithm):
    EXTENT = "EXTENT"
    SOURCE_SYSTEM = "SOURCE_SYSTEM"
    SOURCE_LEVEL = "SOURCE_LEVEL"
    TARGET_SYSTEM = "TARGET_SYSTEM"
    TARGET_LEVEL = "TARGET_LEVEL"
    MIN_RATIO = "MIN_RATIO"
    OUTPUT = "OUTPUT"

    def name(self):
        return "createcrosswalk"

    def displayName(self):
        return "グリッド間対応表を作成"

    def group(self):
        return "変換"

    def groupId(self):
        return "convert"

    def shortHelpString(self):
        return (
            "指定範囲の変換元グリッドの各セルについて、変換先グリッドとの交差面積・"
            "交差率を計算した対応表（crosswalk）を作成します。"
            "面積は球面近似で計算します。"
        )

    def createInstance(self):
        return CreateCrosswalkAlgorithm()

    def initAlgorithm(self, config=None):
        self.addParameter(QgsProcessingParameterExtent(self.EXTENT, "対象範囲"))
        self.addParameter(
            QgsProcessingParameterEnum(
                self.SOURCE_SYSTEM, "変換元グリッド方式", SYSTEM_LABELS, defaultValue=0
            )
        )
        self.addParameter(
            QgsProcessingParameterString(self.SOURCE_LEVEL, "変換元レベル", defaultValue="3")
        )
        self.addParameter(
            QgsProcessingParameterEnum(
                self.TARGET_SYSTEM, "変換先グリッド方式", SYSTEM_LABELS, defaultValue=1
            )
        )
        self.addParameter(
            QgsProcessingParameterString(self.TARGET_LEVEL, "変換先レベル", defaultValue="8")
        )
        self.addParameter(
            QgsProcessingParameterNumber(
                self.MIN_RATIO,
                "最低交差率（%）",
                QgsProcessingParameterNumber.Double,
                defaultValue=0.0,
                minValue=0.0,
                maxValue=100.0,
            )
        )
        self.addParameter(
            QgsProcessingParameterFeatureSink(
                self.OUTPUT, "対応表", QgsProcessing.TypeVector
            )
        )

    def processAlgorithm(self, parameters, context, feedback):
        src_system = SYSTEM_KEYS[
            self.parameterAsEnum(parameters, self.SOURCE_SYSTEM, context)
        ]
        src_level = parse_level(
            src_system, self.parameterAsString(parameters, self.SOURCE_LEVEL, context)
        )
        tgt_system = SYSTEM_KEYS[
            self.parameterAsEnum(parameters, self.TARGET_SYSTEM, context)
        ]
        tgt_level = parse_level(
            tgt_system, self.parameterAsString(parameters, self.TARGET_LEVEL, context)
        )
        min_ratio = (
            self.parameterAsDouble(parameters, self.MIN_RATIO, context) / 100.0
        )
        crs = self.parameterAsExtentCrs(parameters, self.EXTENT, context)
        extent = self.parameterAsExtent(parameters, self.EXTENT, context)
        bounds = extent_to_wgs84(extent, crs, context)

        try:
            source_cells = get_adapter(src_system).cells_for_bounds(bounds, src_level)
        except (ValueError, ImportError) as e:
            raise QgsProcessingException(str(e))
        if len(source_cells) > MAX_SOURCE_CELLS:
            raise QgsProcessingException(
                "変換元セル数が %d で上限 %d を超えます。範囲を狭めるかレベルを下げてください。"
                % (len(source_cells), MAX_SOURCE_CELLS)
            )

        fields = QgsFields()
        for name, vtype in [
            ("source_system", QVariant.String),
            ("source_id", QVariant.String),
            ("source_level", QVariant.String),
            ("target_system", QVariant.String),
            ("target_id", QVariant.String),
            ("target_level", QVariant.String),
            ("intersection_area_m2", QVariant.Double),
            ("source_area_m2", QVariant.Double),
            ("target_area_m2", QVariant.Double),
            ("source_ratio", QVariant.Double),
            ("target_ratio", QVariant.Double),
            ("relation", QVariant.String),
        ]:
            fields.append(QgsField(name, vtype))
        sink, dest_id = self.parameterAsSink(
            parameters, self.OUTPUT, context, fields, QgsWkbTypes.NoGeometry,
            self.parameterAsExtentCrs(parameters, self.EXTENT, context),
        )

        total = max(len(source_cells), 1)
        for i, base in enumerate(source_cells):
            if feedback.isCanceled():
                break
            try:
                intersections, _cells, _stats = compute_correspondence(
                    base, tgt_system, tgt_level
                )
            except (ValueError, ImportError) as e:
                raise QgsProcessingException(str(e))
            for ix in intersections:
                if ix.source_ratio < min_ratio:
                    continue
                feat = QgsFeature(fields)
                feat.setAttributes(
                    [
                        ix.source_system,
                        ix.source_id,
                        str(src_level),
                        ix.target_system,
                        ix.target_id,
                        str(tgt_level),
                        ix.intersection_area_m2,
                        ix.source_area_m2,
                        ix.target_area_m2,
                        ix.source_ratio,
                        ix.target_ratio,
                        ix.relation,
                    ]
                )
                sink.addFeature(feat)
            feedback.setProgress(int((i + 1) / total * 100))
        return {self.OUTPUT: dest_id}
