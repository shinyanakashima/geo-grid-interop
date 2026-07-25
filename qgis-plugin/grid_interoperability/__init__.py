# -*- coding: utf-8 -*-
"""Grid Interoperability QGISプラグイン."""


def classFactory(iface):  # noqa: N802 (QGIS規約)
    from .plugin import GridInteroperabilityPlugin

    return GridInteroperabilityPlugin(iface)
