# -*- coding: utf-8 -*-
"""共通テストケース（shared/testcases/grid-cells.json）との整合性テスト。

QGIS本体なしで実行できる（adapters と core は純Python）。
実行: リポジトリルートで `pytest qgis-plugin`
"""

import json
import math
import os
import sys
import unittest

sys.path.insert(
    0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
)

from grid_interoperability.adapters import available_systems, get_adapter  # noqa: E402
from grid_interoperability.adapters import jismesh, xyz, spatial_id  # noqa: E402
from grid_interoperability.core.geometry import polygon_area_m2  # noqa: E402

TESTCASES = os.path.abspath(
    os.path.join(
        os.path.dirname(__file__),
        "..", "..", "..", "shared", "testcases", "grid-cells.json",
    )
)


def load_cases():
    with open(TESTCASES, encoding="utf-8") as f:
        return json.load(f)["cases"]


class TestSharedCases(unittest.TestCase):
    """Web版とQGIS版で同一座標から同じIDが得られること（指示書 §16）."""

    def test_shared_testcases(self):
        for case in load_cases():
            lon, lat = case["longitude"], case["latitude"]
            height = case.get("heightM", 0)
            for system, expected in case["expected"].items():
                if system not in available_systems():
                    continue
                adapter = get_adapter(system)
                if expected is None:
                    with self.assertRaises(
                        ValueError, msg="%s / %s" % (case["name"], system)
                    ):
                        adapter.point_to_cell(lon, lat, self._level(expected, system))
                    continue
                cell = adapter.point_to_cell(lon, lat, expected["level"], height)
                self.assertEqual(
                    cell.id, expected["id"], "%s / %s" % (case["name"], system)
                )
                if expected.get("areaM2") is not None:
                    self.assertAlmostEqual(
                        cell.area_m2,
                        expected["areaM2"],
                        delta=max(expected["areaM2"] * 1e-6, 0.01),
                        msg="%s / %s の面積" % (case["name"], system),
                    )
                if expected.get("parentId") is not None:
                    self.assertEqual(cell.parent_id, expected["parentId"])
                if expected.get("minHeightM") is not None:
                    self.assertEqual(cell.min_height_m, expected["minHeightM"])
                    self.assertEqual(cell.max_height_m, expected["maxHeightM"])

    @staticmethod
    def _level(expected, system):
        if expected and "level" in expected:
            return expected["level"]
        return "3" if system == "jismesh" else 8 if system == "h3" else 14


class TestJismesh(unittest.TestCase):
    def test_tokyo_station(self):
        self.assertEqual(jismesh.to_mesh_code(139.767125, 35.681236, "1"), "5339")
        self.assertEqual(jismesh.to_mesh_code(139.767125, 35.681236, "2"), "533946")
        self.assertEqual(jismesh.to_mesh_code(139.767125, 35.681236, "3"), "53394611")

    def test_roundtrip_all_levels(self):
        lon, lat = 143.196, 42.923
        for level in jismesh.LEVEL_ORDER:
            code = jismesh.to_mesh_code(lon, lat, level)
            cell = jismesh.cell_from_code(code)
            self.assertEqual(
                jismesh.to_mesh_code(cell.center[0], cell.center[1], level), code
            )

    def test_parent_children(self):
        code = jismesh.to_mesh_code(143.196, 42.923, "3")
        self.assertEqual(jismesh.get_parent(code), code[:6])
        children = jismesh.get_children(code[:6])
        self.assertEqual(len(children), 100)
        self.assertIn(code, children)

    def test_out_of_range(self):
        with self.assertRaises(ValueError):
            jismesh.to_mesh_code(-70, 40, "3")

    def test_boundary_rounding_rule(self):
        """セル境界上の点は北東側のセルに属する（半開区間規約）."""
        # 42.925 * 120 = 5151 ちょうど（浮動小数点では 5150.999…）
        code = jismesh.to_mesh_code(143.2, 42.925, "3")
        self.assertEqual(code, "64433116")


class TestXyz(unittest.TestCase):
    def test_dateline_bounds(self):
        cells = xyz.cells_for_bounds((179.5, 60, -179.5, 61), 8)
        self.assertGreater(len(cells), 0)
        for c in cells:
            z, x, y = xyz.parse_tile_id(c.id)
            self.assertTrue(0 <= x < 2 ** z)

    def test_parent_children(self):
        cell = xyz.point_to_cell(139.767125, 35.681236, 14)
        parent = xyz.get_parent(cell.id)
        self.assertIn(cell.id, xyz.get_children(parent))

    def test_area_positive_high_latitude(self):
        cell = xyz.point_to_cell(0, 84.9, 10)
        self.assertGreater(cell.area_m2, 0)


class TestSpatialId(unittest.TestCase):
    def test_horizontal_matches_xyz(self):
        a = xyz.point_to_cell(143.196, 42.923, 14)
        b = spatial_id.point_to_cell(143.196, 42.923, 14, 0)
        self.assertEqual(a.rings, b.rings)

    def test_vertical_index(self):
        # z=14 のボクセル高さは 2^11 = 2048m
        cell = spatial_id.point_to_cell(143.196, 42.923, 14, 3000)
        self.assertTrue(cell.id.startswith("/14/1/"))
        self.assertEqual(cell.min_height_m, 2048)
        self.assertEqual(cell.max_height_m, 4096)

    def test_underground(self):
        cell = spatial_id.point_to_cell(143.196, 42.923, 14, -50)
        self.assertTrue(cell.id.startswith("/14/-1/"))


class TestGeometry(unittest.TestCase):
    def test_equator_one_degree_area(self):
        ring = [(0, -0.5), (1, -0.5), (1, 0.5), (0, 0.5), (0, -0.5)]
        area_km2 = polygon_area_m2([ring]) / 1e6
        self.assertGreater(area_km2, 12000)
        self.assertLess(area_km2, 12500)


class TestIntersections(unittest.TestCase):
    """Shapely が使える環境では交差計算も検証する."""

    def setUp(self):
        try:
            import shapely  # noqa: F401
        except ImportError:
            self.skipTest("shapely なし")

    def test_ratio_sum_jismesh_to_xyz(self):
        from grid_interoperability.core.intersections import compute_correspondence

        base = jismesh.point_to_cell(139.767125, 35.681236, "3")
        _ix, _cells, stats = compute_correspondence(base, "xyz", 14)
        self.assertAlmostEqual(stats["ratio_sum"], 1.0, places=3)

    def test_ratio_sum_jismesh_to_h3(self):
        if "h3" not in available_systems():
            self.skipTest("h3 なし")
        from grid_interoperability.core.intersections import compute_correspondence

        base = jismesh.point_to_cell(143.196, 42.923, "3")
        _ix, _cells, stats = compute_correspondence(base, "h3", 8)
        self.assertAlmostEqual(stats["ratio_sum"], 1.0, places=3)
        self.assertEqual(
            stats["contained_count"] + stats["boundary_count"],
            stats["intersect_count"],
        )

    def test_areal_interpolation_preserves_total(self):
        if "h3" not in available_systems():
            self.skipTest("h3 なし")
        from grid_interoperability.core.convert import apply_rounding, convert_cell

        base = jismesh.point_to_cell(139.767125, 35.681236, "3")
        records = convert_cell(base, "h3", 8, "areal-weighted", 120.0)
        total = sum(r.target_value for r in records)
        self.assertAlmostEqual(total, 120.0, places=3)
        rounded = apply_rounding(records, "largest-remainder")
        self.assertEqual(sum(r.target_value for r in rounded), 120)

    def test_level_by_area_match(self):
        if "h3" not in available_systems():
            self.skipTest("h3 なし")
        from grid_interoperability.core.intersections import level_by_area_match

        base = jismesh.point_to_cell(139.767125, 35.681236, "3")
        self.assertEqual(
            level_by_area_match("h3", 139.767125, 35.681236, base.area_m2), 8
        )


if __name__ == "__main__":
    unittest.main()
