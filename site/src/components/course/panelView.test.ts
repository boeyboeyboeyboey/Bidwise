import { beforeAll, describe, expect, it, vi } from 'vitest';
import fixture from './__fixtures__/claim_view_parity.json';
import type { PanelView, PanelViewInput } from './panelView';

type Case = { name: string; input: PanelViewInput; expected: PanelView };
const cases = fixture as unknown as Case[];
const get = (name: string): Case => cases.find((c) => c.name === name)!;

let panelView: (i: PanelViewInput) => PanelView;
beforeAll(async () => {
  // The suite's forced-calibration mode replaces the bid-level readers with fixed stubs; this file tests the real readers on the fixture's metadata.
  vi.doUnmock('../../lib/data/bidLevels');
  vi.resetModules();
  ({ panelView } = await import('./panelView'));
});

describe('panelView against the shared fixture (scripts/claim_view.py must give the same)', () => {
  it('has the cases the spec lists', () => {
    const names = cases.map((c) => c.name);
    for (const n of ['normal_above_floor', 'floor_distinct', 'floor_with_unreached', 'three_way_tie_at_floor', 'three_way_tie_above_floor', 'two_way_tie_merged_lines',
      'rare_fill_0_0199', 'rare_fill_0_02', 'fallback_80_90_95_no_calibration', 'malformed_band_edges_not_increasing', 'malformed_null_rate_for_chosen_style',
      'malformed_partial_pooled_level_table_falls_back', 'malformed_upper_out_of_range', 'malformed_ncourses_not_integer', 'malformed_reached_missing_for_one_style_in_tie',
      'below_aim_true_at_guard_minimums', 'below_aim_false_upper_at_threshold', 'group_2_notice']) expect(names).toContain(n);
    expect(new Set(names).size).toBe(names.length);
  });

  it.each(cases.map((c) => [c.name, c] as const))('%s', (_n, c) => {
    expect(JSON.parse(JSON.stringify(panelView(c.input)))).toEqual(c.expected);
  });

  it('the style is chosen by key: every case carries a key and the bid shown is the one at that key\'s position', () => {
    const pos: Record<string, number> = { cheap: 0, t80: 0, balanced: 1, t90: 1, safe: 2, t95: 2 };
    for (const c of cases) {
      expect(c.input).not.toHaveProperty('styleIndex');
      expect(Object.keys(pos)).toContain(c.input.styleKey);
      if (!c.expected.groupHidden) expect(c.expected.bidCents).toBe(c.input.recs[pos[c.input.styleKey]]);
    }
    expect(() => panelView({ ...get('normal_above_floor').input, styleKey: 'Balanced' })).toThrow(/unknown style key/);
  });

  it('the claims the page may make hold in the cases that matter most', () => {
    const e = (n: string) => get(n).expected;
    expect(e('floor_distinct')).toMatchObject({ floor: true, ifFills: null, past: [], minBidOnly: false });
    expect(e('three_way_tie_at_floor')).toMatchObject({ floor: true, minBidOnly: true, sameAs: ['cheap', 'balanced'] });
    expect(e('floor_with_unreached').unreached).toEqual(['cheap', 'balanced']);
    expect(e('group_2_notice')).toMatchObject({ groupHidden: true, bidCents: null, chanceNow: null, past: [] });
    expect(e('rare_fill_0_0199').fillChance).toBeNull();
    expect(e('rare_fill_0_02').fillChance).toEqual({ text: '2%', barPct: 2 });
    expect(e('below_aim_true_at_guard_minimums').past[0].belowAim).toBe(true);
    expect(e('below_aim_false_upper_at_threshold').past[0].belowAim).toBe(false);
    // malformed metadata reads as "no calibration" or "no measured rate", never as a made-up figure
    for (const n of ['malformed_band_edges_not_increasing', 'malformed_rate_missing_drops_window', 'malformed_partial_pooled_level_table_falls_back']) expect(e(n).past).toEqual([]);
  });
});
