# -*- coding: utf-8 -*-
"""グリッド間変換アルゴリズム（指示書 §10, §15.6）。

セルコード列を持つレイヤーを、指定した方式（重心割当・最大重複面積・
全交差セル・完全包含のみ・閾値指定）で変換先グリッドへ対応付ける。
"""

from qgis.core import (
    QgsFeature,
    QgsField,
    QgsFields,
    QgsProcessing,
    QgsProcessingAlgorithm,
    QgsProcessingParameterEnum,
    QgsProcessingParameterFeatureSink,
    QgsProcessingParameterFeatureSource,
    QgsProcessingParameterField,
    QgsProcessingParameterNumber,
    QgsProcessingParameterString,
)
from qgis.PyQt.QtCore import QVariant

from ..adapters import get_adapter
from ..core.convert import METHODS, convert_cell
from .common import SYSTEM_KEYS, SYSTEM_LABELS, WGS84, cell_geometry, parse_level


class ConvertGridAlgorithm(QgsProcessingAlgorithm):
    INPUT = "INPUT"
    CODE_FIELD = "CODE_FIELD"
    SOURCE_SYSTEM = "SOURCE_SYSTEM"
    TARGET_SYSTEM = "TARGET_SYSTEM"
    TARGET_LEVEL = "TARGET_LEVEL"
    METHOD = "METHOD"
    MIN_RATIO = "MIN_RATIO"
    OUTPUT = "OUTPUT"

    def name(self):
        return "convertgrid"

    def displayName(self):
        return "グリッド間変換"

    def group(self):
        return "変換"

    def groupId(self):
        return "convert"

    def shortHelpString(self):
        return (
            "セルコード列を持つレイヤーの各セルを、変換先グリッドのセルへ対応付けます。"
            "出力は変換先セルのポリゴンと交差率を持つレイヤーです。"
        )

    def createInstance(self):
        return ConvertGridAlgorithm()

    def initAlgorithm(self, config=None):
        self.addParameter(
            QgsProcessingParameterFeatureSource(
                self.INPUT, "入力レイヤー（セルコード付き）", [QgsProcessing.TypeVector]
            )
        )
        self.addParameter(
            QgsProcessingParameterField(
                self.CODE_FIELD, "セルコード列", parentLayerParameterName=self.INPUT
            )
        )
        self.addParameter(
            QgsProcessingParameterEnum(
                self.SOURCE_SYSTEM, "変換元グリッド方式", SYSTEM_LABELS, defaultValue=0
            )
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
            QgsProcessingParameterEnum(
                self.METHOD,
                "変換方法",
                [label for _key, label in METHODS],
                defaultValue=1,
            )
        )
        self.addParameter(
            QgsProcessingParameterNumber(
                self.MIN_RATIO,
                "最低交差率（%・閾値指定のとき）",
                QgsProcessingParameterNumber.Double,
                defaultValue=1.0,
                minValue=0.0,
                maxValue=100.0,
            )
        )
        self.addParameter(
            QgsProcessingParameterFeatureSink(
                self.OUTPUT, "変換結果", QgsProcessing.TypeVectorPolygon
            )
        )

    def processAlgorithm(self, parameters, context, feedback):
        source = self.parameterAsSource(parameters, self.INPUT, context)
        code_field = self.parameterAsString(parameters, self.CODE_FIELD, context)
        src_system = SYSTEM_KEYS[
            self.parameterAsEnum(parameters, self.SOURCE_SYSTEM, context)
        ]
        tgt_system = SYSTEM_KEYS[
            self.parameterAsEnum(parameters, self.TARGET_SYSTEM, context)
        ]
        tgt_level = parse_level(
            tgt_system, self.parameterAsString(parameters, self.TARGET_LEVEL, context)
        )
        method = METHODS[self.parameterAsEnum(parameters, self.METHOD, context)][0]
        min_ratio = self.parameterAsDouble(parameters, self.MIN_RATIO, context) / 100.0
        adapter = get_adapter(src_system)

        fields = QgsFields()
        for name, vtype in [
            ("source_system", QVariant.String),
            ("source_id", QVariant.String),
            ("target_system", QVariant.String),
            ("target_id", QVariant.String),
            ("target_level", QVariant.String),
            ("intersection_area_m2", QVariant.Double),
            ("source_ratio", QVariant.Double),
            ("target_ratio", QVariant.Double),
            ("method", QVariant.String),
            ("is_estimated", QVariant.Bool),
        ]:
            fields.append(QgsField(name, vtype))
        sink, dest_id = self.parameterAsSink(
            parameters, self.OUTPUT, context, fields, 3, WGS84  # 3 = Polygon
        )

        total = max(source.featureCount(), 1)
        for i, feat in enumerate(source.getFeatures()):
            if feedback.isCanceled():
                break
            code = str(feat[code_field]).strip()
            try:
                cell = adapter.cell_to_geometry(code)
                records = convert_cell(
                    cell, tgt_system, tgt_level, method, None, min_ratio
                )
            except (ValueError, ImportError) as e:
                feedback.pushWarning("fid=%s (%s): %s" % (feat.id(), code, e))
                continue
            for r in records:
                out = QgsFeature(fields)
                out.setGeometry(cell_geometry(r.target_cell))
                out.setAttributes(
                    [
                        r.source_system,
                        r.source_id,
                        r.target_system,
                        r.target_id,
                        str(r.target_level),
                        r.intersection_area_m2,
                        r.source_ratio,
                        r.target_ratio,
                        r.method,
                        r.is_estimated,
                    ]
                )
                sink.addFeature(out)
            feedback.setProgress(int((i + 1) / total * 100))
        return {self.OUTPUT: dest_id}
