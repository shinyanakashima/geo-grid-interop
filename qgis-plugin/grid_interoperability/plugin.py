# -*- coding: utf-8 -*-
"""プラグイン本体。Processingプロバイダーとドックウィジェットを登録する。"""

from qgis.core import QgsApplication
from qgis.PyQt.QtCore import Qt
from qgis.PyQt.QtWidgets import QAction

from .dockwidget import GridInteropDockWidget
from .processing.provider import GridInteropProvider


class GridInteroperabilityPlugin:
    def __init__(self, iface):
        self.iface = iface
        self.provider = None
        self.dock = None
        self.action = None

    def initGui(self):  # noqa: N802
        self.provider = GridInteropProvider()
        QgsApplication.processingRegistry().addProvider(self.provider)

        self.action = QAction("Grid Interoperability", self.iface.mainWindow())
        self.action.setCheckable(True)
        self.action.triggered.connect(self._toggle_dock)
        self.iface.addPluginToMenu("&Grid Interoperability", self.action)
        self.iface.addToolBarIcon(self.action)

    def unload(self):
        if self.provider is not None:
            QgsApplication.processingRegistry().removeProvider(self.provider)
            self.provider = None
        if self.dock is not None:
            self.iface.removeDockWidget(self.dock)
            self.dock = None
        if self.action is not None:
            self.iface.removePluginMenu("&Grid Interoperability", self.action)
            self.iface.removeToolBarIcon(self.action)
            self.action = None

    def _toggle_dock(self, checked):
        if self.dock is None:
            self.dock = GridInteropDockWidget(self.iface, self.iface.mainWindow())
            self.iface.addDockWidget(Qt.RightDockWidgetArea, self.dock)
        self.dock.setVisible(checked)
