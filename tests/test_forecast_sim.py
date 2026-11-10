import json
import unittest
from pathlib import Path

from model.forecast.sim import Rng, SimParams, simulate, tie_win_chance

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

    def test_floor_bid_wins_for_certain_when_seats_are_left(self):
        # tiny demand against many seats: every run is uncontested, so a bid at the floor must be ~100%, not 50%
        p = SimParams(demandMean=1, demandDispersion=1e9, priceLevelCents=2000, priceSigma=0.4, anchorSigma=0.2, anchorShare=0, anchorCents=1000)
        r = simulate(60, 1, 1000, p, runs=4000, seed=3)
        self.assertEqual(r["curve"]["bidCents"][0], 1000)
        self.assertGreater(r["curve"]["pIn"][0], 0.99)

    def test_a_tied_bid_wins_by_random_draw_among_the_tied(self):
        self.assertAlmostEqual(tie_win_chance(10, 1, 9, 1), 0.5, places=12)
        self.assertAlmostEqual(tie_win_chance(10, 1, 7, 4), 0.6, places=12)
        self.assertAlmostEqual(tie_win_chance(3, 3, 0, 10), 1 / 286, places=12)
        self.assertEqual(tie_win_chance(5, 2, 4, 1), 0)

    def test_floor_bid_against_many_floor_bidders_is_far_below_half_credit(self):
        p = SimParams(demandMean=10, demandDispersion=1e9, priceLevelCents=1000, priceSigma=0, anchorSigma=0, anchorShare=0, anchorCents=1000)
        r = simulate(3, 3, 1000, p, runs=4000, seed=5)
        self.assertEqual(r["curve"]["bidCents"][0], 1000)
        self.assertLess(r["curve"]["pIn"][0], 0.05)
        self.assertGreater(r["curve"]["pIn"][-1], 0.99)

    def test_curve_is_monotone(self):
        p = SimParams(demandMean=12, demandDispersion=4, priceLevelCents=1500, priceSigma=0.2, anchorSigma=0.1, anchorShare=0.4, anchorCents=1000)
        pin = simulate(5, 2, 1000, p, runs=5000, seed=9)["curve"]["pIn"]
        self.assertTrue(all(b >= a - 1e-12 for a, b in zip(pin, pin[1:])))

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
