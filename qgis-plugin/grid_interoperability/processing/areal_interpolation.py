# -*- coding: utf-8 -*-
"""属性値の面積按分アルゴリズム（指示書 §10.5, §15.7）。"""

from qgis.core import (
    QgsFeature,
    QgsField,
    QgsFields,
    QgsProcessing,
    QgsProcessingAlgorithm,
    QgsProcessingException,
    QgsProcessingParameterEnum,
    QgsProcessingParameterFeatureSink,
    QgsProcessingParameterFeatureSource,
    QgsProcessingParameterField,
    QgsProcessingParameterString,
)
from qgis.PyQt.QtCore import QVariant

from ..adapters import get_adapter
from ..core.convert import ROUNDINGS, apply_rounding, convert_cell
from .common import SYSTEM_KEYS, SYSTEM_LABELS, WGS84, cell_geometry, parse_level


class ArealInterpolationAlgorithm(QgsProcessingAlgorithm):
    INPUT = "INPUT"
    CODE_FIELD = "CODE_FIELD"
    VALUE_FIELD = "VALUE_FIELD"
    SOURCE_SYSTEM = "SOURCE_SYSTEM"
    TARGET_SYSTEM = "TARGET_SYSTEM"
    TARGET_LEVEL = "TARGET_LEVEL"
    ROUNDING = "ROUNDING"
    OUTPUT = "OUTPUT"

    def name(self):
        return "arealinterpolation"

    def displayName(self):
        return "属性値を面積按分"

    def group(self):
        return "変換"

    def groupId(self):
        return "convert"

    def shortHelpString(self):
        return (
            "セルコード列を持つレイヤー（例: 地域標準メッシュコード付き統計表）の"
            "属性値を、変換先グリッドのセルへ交差面積の割合で按分します。"
            "按分結果は推計値です（is_estimated=true が付与されます）。"
            "同じ変換先セルに複数の変換元セルが交差する場合は合算します。"
        )

    def createInstance(self):
        return ArealInterpolationAlgorithm()

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
            QgsProcessingParameterField(
                self.VALUE_FIELD,
                "按分する属性値列",
                parentLayerParameterName=self.INPUT,
                type=QgsProcessingParameterField.Numeric,
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
                self.ROUNDING,
                "整数化方法",
                [label for _key, label in ROUNDINGS],
                defaultValue=0,
            )
        )
        self.addParameter(
            QgsProcessingParameterFeatureSink(
                self.OUTPUT, "面積按分結果", QgsProcessing.TypeVectorPolygon
            )
        )

    def processAlgorithm(self, parameters, context, feedback):
        source = self.parameterAsSource(parameters, self.INPUT, context)
        code_field = self.parameterAsString(parameters, self.CODE_FIELD, context)
        value_field = self.parameterAsString(parameters, self.VALUE_FIELD, context)
        src_system = SYSTEM_KEYS[
            self.parameterAsEnum(parameters, self.SOURCE_SYSTEM, context)
        ]
        tgt_system = SYSTEM_KEYS[
            self.parameterAsEnum(parameters, self.TARGET_SYSTEM, context)
        ]
        tgt_level = parse_level(
            tgt_system, self.parameterAsString(parameters, self.TARGET_LEVEL, context)
        )
        rounding = ROUNDINGS[self.parameterAsEnum(parameters, self.ROUNDING, context)][0]
        adapter = get_adapter(src_system)

        fields = QgsFields()
        for name, vtype in [
            ("target_system", QVariant.String),
            ("target_id", QVariant.String),
            ("target_level", QVariant.String),
            ("value", QVariant.Double),
            ("source_count", QVariant.Int),
            ("is_estimated", QVariant.Bool),
            ("method", QVariant.String),
        ]:
            fields.append(QgsField(name, vtype))
        sink, dest_id = self.parameterAsSink(
            parameters, self.OUTPUT, context, fields, 3, WGS84  # 3 = Polygon
        )

        records = []
        total = max(source.featureCount(), 1)
        for i, feat in enumerate(source.getFeatures()):
            if feedback.isCanceled():
                break
            code = str(feat[code_field]).strip()
            raw = feat[value_field]
            try:
                value = float(raw)
            except (TypeError, ValueError):
                feedback.pushWarning("fid=%s: 属性値が数値ではありません" % feat.id())
                continue
            try:
                cell = adapter.cell_to_geometry(code)
                records.extend(
                    convert_cell(cell, tgt_system, tgt_level, "areal-weighted", value)
                )
            except (ValueError, ImportError) as e:
                feedback.pushWarning("fid=%s (%s): %s" % (feat.id(), code, e))
            feedback.setProgress(int((i + 1) / total * 90))

        records = apply_rounding(records, rounding)

        # 変換先セル単位に合算
        merged = {}
        for r in records:
            entry = merged.setdefault(
                r.target_id, {"value": 0.0, "count": 0, "cell": r.target_cell}
            )
            entry["value"] += r.target_value or 0.0
            entry["count"] += 1

        for target_id, entry in merged.items():
            feat = QgsFeature(fields)
            feat.setGeometry(cell_geometry(entry["cell"]))
            feat.setAttributes(
                [
                    tgt_system,
                    target_id,
                    str(tgt_level),
                    entry["value"],
                    entry["count"],
                    True,
                    "areal-weighted",
                ]
            )
            sink.addFeature(feat)
        feedback.setProgress(100)
        return {self.OUTPUT: dest_id}
