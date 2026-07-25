# -*- coding: utf-8 -*-
"""QGIS Processing プロバイダー。"""

from qgis.core import QgsProcessingProvider

from .areal_interpolation import ArealInterpolationAlgorithm
from .assign_grid_id import AssignGridIdAlgorithm
from .convert_grid import ConvertGridAlgorithm
from .create_crosswalk import CreateCrosswalkAlgorithm
from .generate_grid import GenerateGridAlgorithm


class GridInteropProvider(QgsProcessingProvider):
    def loadAlgorithms(self):
        self.addAlgorithm(GenerateGridAlgorithm())
        self.addAlgorithm(AssignGridIdAlgorithm())
        self.addAlgorithm(CreateCrosswalkAlgorithm())
        self.addAlgorithm(ConvertGridAlgorithm())
        self.addAlgorithm(ArealInterpolationAlgorithm())

    def id(self):
        return "gridinterop"

    def name(self):
        return "Grid Interoperability"

    def longName(self):
        return "空間グリッド比較・変換基盤"
