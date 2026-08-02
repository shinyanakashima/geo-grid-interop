#!/usr/bin/env bash
# QGISプラグイン配布用zipを作成する。
# 使い方: scripts/package_qgis_plugin.sh [出力ディレクトリ]
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${1:-$REPO_ROOT/dist}"
PLUGIN_DIR="$REPO_ROOT/qgis-plugin/grid_interoperability"
VERSION="$(grep '^version=' "$PLUGIN_DIR/metadata.txt" | cut -d= -f2)"
ZIP_PATH="$OUT_DIR/grid_interoperability-$VERSION.zip"

mkdir -p "$OUT_DIR"
rm -f "$ZIP_PATH"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cp -r "$PLUGIN_DIR" "$STAGE/grid_interoperability"
# テスト・キャッシュは配布物から除外する
rm -rf "$STAGE/grid_interoperability/tests"
find "$STAGE" -name '__pycache__' -type d -exec rm -rf {} + 2>/dev/null || true
find "$STAGE" -name '*.pyc' -delete

(cd "$STAGE" && zip -rq "$ZIP_PATH" grid_interoperability)
echo "created: $ZIP_PATH"
