# -*- coding: utf-8 -*-
"""Grid Interoperability ドックウィジェット（指示書 §15.3）。"""

from qgis.PyQt.QtWidgets import (
    QCheckBox,
    QComboBox,
    QDockWidget,
    QGridLayout,
    QLabel,
    QPushButton,
    QVBoxLayout,
    QWidget,
)

from .adapters import DISPLAY_NAMES, available_systems, get_adapter


class GridInteropDockWidget(QDockWidget):
    def __init__(self, iface, parent=None):
        super().__init__("Grid Interoperability", parent)
        self.iface = iface
        self.setObjectName("GridInteropDockWidget")

        body = QWidget()
        layout = QVBoxLayout(body)

        layout.addWidget(QLabel("基準グリッド"))
        self.system_combo = QComboBox()
        for system in available_systems():
            self.system_combo.addItem(DISPLAY_NAMES.get(system, system), system)
        self.system_combo.currentIndexChanged.connect(self._refresh_levels)
        layout.addWidget(self.system_combo)

        layout.addWidget(QLabel("レベル"))
        self.level_combo = QComboBox()
        layout.addWidget(self.level_combo)
        self._refresh_levels()

        layout.addWidget(QLabel("比較対象"))
        self.target_checks = {}
        grid = QGridLayout()
        for row, system in enumerate(available_systems()):
            check = QCheckBox(DISPLAY_NAMES.get(system, system))
            self.target_checks[system] = check
            grid.addWidget(check, row, 0)
        layout.addLayout(grid)

        buttons = [
            ("表示範囲を生成", self._run_generate),
            ("IDを属性として付与", self._run_assign),
            ("対応表を作成", self._run_crosswalk),
            ("グリッド間変換", self._run_convert),
            ("面積按分", self._run_interpolation),
        ]
        for label, handler in buttons:
            btn = QPushButton(label)
            btn.clicked.connect(handler)
            layout.addWidget(btn)

        layout.addStretch()
        self.setWidget(body)

    # --- UI ---

    def _refresh_levels(self):
        system = self.system_combo.currentData()
        self.level_combo.clear()
        adapter = get_adapter(system)
        for value, label in adapter.levels_for_ui():
            self.level_combo.addItem(label, str(value))
        # デフォルトレベルを選択
        idx = self.level_combo.findData(str(adapter.DEFAULT_LEVEL))
        if idx >= 0:
            self.level_combo.setCurrentIndex(idx)

    def _selected_params(self):
        from .processing.common import SYSTEM_KEYS

        system = self.system_combo.currentData()
        return {
            "SYSTEM": SYSTEM_KEYS.index(system),
            "LEVEL": self.level_combo.currentData(),
        }

    # --- Processing 実行 ---

    def _exec_dialog(self, alg_id, params=None):
        import processing

        processing.execAlgorithmDialog(alg_id, params or {})

    def _run_generate(self):
        params = self._selected_params()
        canvas = self.iface.mapCanvas()
        extent = canvas.extent()
        crs = canvas.mapSettings().destinationCrs()
        params["EXTENT"] = "%f,%f,%f,%f [%s]" % (
            extent.xMinimum(),
            extent.xMaximum(),
            extent.yMinimum(),
            extent.yMaximum(),
            crs.authid(),
        )
        self._exec_dialog("gridinterop:generategrid", params)

    def _run_assign(self):
        self._exec_dialog("gridinterop:assigngridid", self._selected_params())

    def _run_crosswalk(self):
        params = self._selected_params()
        self._exec_dialog(
            "gridinterop:createcrosswalk",
            {
                "SOURCE_SYSTEM": params["SYSTEM"],
                "SOURCE_LEVEL": params["LEVEL"],
            },
        )

    def _run_convert(self):
        params = self._selected_params()
        self._exec_dialog(
            "gridinterop:convertgrid", {"SOURCE_SYSTEM": params["SYSTEM"]}
        )

    def _run_interpolation(self):
        params = self._selected_params()
        self._exec_dialog(
            "gridinterop:arealinterpolation", {"SOURCE_SYSTEM": params["SYSTEM"]}
        )
