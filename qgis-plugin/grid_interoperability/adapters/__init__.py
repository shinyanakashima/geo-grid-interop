# -*- coding: utf-8 -*-
"""グリッドアダプターレジストリ。Web版 src/lib/adapters と対応する。"""

from . import jismesh, xyz, spatial_id

_ADAPTERS = {
    "jismesh": jismesh,
    "xyz": xyz,
    "spatial-id": spatial_id,
}

# H3はライブラリが無い環境でも他機能を使えるよう遅延登録する
try:
    from . import h3 as _h3_adapter

    _ADAPTERS["h3"] = _h3_adapter
except ImportError:  # pragma: no cover
    pass

DISPLAY_NAMES = {
    "jismesh": "地域標準メッシュ",
    "h3": "H3",
    "xyz": "XYZタイル",
    "spatial-id": "空間ID",
}


def get_adapter(system: str):
    if system not in _ADAPTERS:
        if system == "h3":
            raise ImportError(
                "h3 パッケージが見つかりません。QGISのPython環境に "
                "`pip install h3` でインストールしてください。"
            )
        raise ValueError("グリッド方式 %s は未対応です" % system)
    return _ADAPTERS[system]


def available_systems():
    return list(_ADAPTERS.keys())
