import json
import unittest
from pathlib import Path

from model.forecast.sim import Rng, SimParams, simulate

FIXTURE = Path(__file__).parent / "fixtures" / "forecast_sim_parity.json"


class SimParityTests(unittest.TestCase):
    """Fixture made by running site/src/lib/sim/index.ts (see forecast_sim_parity_gen.ts)."""

    def test_matches_typescript_engine(self):
        for c in json.loads(FIXTURE.read_text()):
            with self.subTest(case=c["name"]):
                r = simulate(c["seats"], c["group"], c["minBidCents"], SimParams(**c["params"]), c["runs"], c["seed"])
                t = c["result"]
                self.assertEqual(r["runs"], t["runs"])
                self.assertAlmostEqual(r["pFill"], t["pFill"], places=12)
                for k, v in t["percentilesCents"].items():
                    self.assertLessEqual(abs(r["percentilesCents"][k] - v), 1)
                self.assertEqual(r["histogram"]["startCents"], t["histogram"]["startCents"])
                self.assertLessEqual(sum(abs(a - b) for a, b in zip(r["histogram"]["counts"], t["histogram"]["counts"])), 2)
                self.assertEqual(r["curve"]["bidCents"], t["curve"]["bidCents"])
                for a, b in zip(r["curve"]["pIn"], t["curve"]["pIn"]):
                    self.assertAlmostEqual(a, b, places=3)

    def test_rng_deterministic_and_seeded(self):
        a, b, c = Rng(7), Rng(7), Rng(8)
        xs = [a.uniform() for _ in range(5)]
        self.assertEqual(xs, [b.uniform() for _ in range(5)])
        self.assertNotEqual(xs, [c.uniform() for _ in range(5)])
        self.assertTrue(all(0 <= x < 1 for x in xs))

    def test_no_demand_never_fills_at_min_bid(self):
        p = SimParams(0.0001, 1, 3000, 0.4, 0.1, 0, 1000)
        r = simulate(5, 1, 1000, p, 2000, 3)
        self.assertLess(r["pFill"], 0.01)
        self.assertEqual(r["percentilesCents"]["p99"], 1000)


if __name__ == "__main__":
    unittest.main()
