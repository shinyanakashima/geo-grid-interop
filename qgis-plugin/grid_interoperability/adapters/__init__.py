# -*- coding: utf-8 -*-
"""グリッドアダプターレジストリ。Web版 src/lib/adapters と対応する。"""

from . import geohash, jismesh, spatial_id, xyz

_ADAPTERS = {
    "jismesh": jismesh,
    "geohash": geohash,
    "xyz": xyz,
    "spatial-id": spatial_id,
}

# 外部ライブラリ依存のアダプターは、無い環境でも他機能を使えるよう
# インポートに失敗したら登録しない（利用時に案内を出す）。
_INSTALL_HINTS = {
    "h3": "h3",
    "s2": "s2sphere",
}

try:
    from . import h3 as _h3_adapter

    _ADAPTERS["h3"] = _h3_adapter
except ImportError:  # pragma: no cover
    pass

try:
    from . import s2 as _s2_adapter

    _ADAPTERS["s2"] = _s2_adapter
except ImportError:  # pragma: no cover
    pass

DISPLAY_NAMES = {
    "jismesh": "地域標準メッシュ",
    "h3": "H3",
    "s2": "S2",
    "geohash": "Geohash",
    "xyz": "XYZタイル",
    "spatial-id": "空間ID",
}


def get_adapter(system: str):
    if system not in _ADAPTERS:
        if system in _INSTALL_HINTS:
            raise ImportError(
                "%s パッケージが見つかりません。QGISのPython環境に "
                "`pip install %s` でインストールしてください。"
                % (_INSTALL_HINTS[system], _INSTALL_HINTS[system])
            )
        raise ValueError("グリッド方式 %s は未対応です" % system)
    return _ADAPTERS[system]


def available_systems():
    return list(_ADAPTERS.keys())
