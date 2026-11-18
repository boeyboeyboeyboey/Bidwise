// Generates claim_view_parity.json: synthetic panelView inputs (no real course, section or forecast) with the output panelView.ts gives
// for each. panelView.test.ts checks the TypeScript still gives these outputs; tests/test_claim_view.py (private) checks the Python
// mirror scripts/claim_view.py gives the same. Change an input or a rule here, regenerate, and review the diff of the expected values.
// regenerate (from repo/site): npx vite-node src/components/course/__fixtures__/claim_view_parity_gen.ts > src/components/course/__fixtures__/claim_view_parity.json
import { panelView, type PanelViewInput } from '../panelView';

const W = 'Round 2 Window 1';
type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

const lv = (level: number, lossFilled: number) => ({ level, lossFilled, lossAll: 0.07, winAboveFloor: 0.86, meanOverpay: 6.6, reached: true });
/** Past win rates by band: rates rise with the band, so a case shows which band it read. Band 3 has no `source`, as in older builds. */
const cell = (b: number): Obj => ({
  cheap: 0.6 + b / 100, balanced: 0.8 + b / 100, safe: 0.9 + b / 200, nFilled: 100 + b,
  ...(b === 3 ? {} : { source: b === 0 ? 'all' : b === 1 ? 'group' : 'cell' }),
  upper: { cheap: 0.7 + b / 100, balanced: 0.9 + b / 100 / 2, safe: 0.95 },
  nCourses: 40 + b, effCourses: 25.5,
});

const baseMeta = (): Obj => ({
  distCalibration: { enabled: true, ok: true },
  bidLevels: { cheap: lv(0.9, 0.304), balanced: lv(0.975, 0.157), safe: lv(0.99, 0.106) },
  bidLevelsByWindow: { [W]: { cheap: { level: 0.9, lossFilled: 0.3, reached: true }, balanced: { level: 0.97, lossFilled: 0.15, reached: true }, safe: { level: 0.99, lossFilled: 0.1, reached: true } } },
  bandEdges: [15, 25, 40, 60],
  measuredWin: { [W]: Object.fromEntries([0, 1, 2, 3, 4].map((b) => [String(b), cell(b)])) },
});

const baseInput = (): Obj => ({
  meta: baseMeta(), window: W, group: 1, minBidCents: 1000, recs: [2101, 2601, 3101], styleIndex: 1,
  pNow: 0.8731, pFill: 0.83, conditionalMedianCents: 3000, reasons: [], hardWindow: false,
});

/** Edit a fresh base input: `f` mutates it. */
const make = (name: string, f: (i: Obj) => void = () => {}): { name: string; input: Obj } => {
  const input = baseInput();
  f(input);
  return { name, input };
};
const cellOf = (i: Obj, band = 2): Obj => i.meta.measuredWin[W][String(band)];
const levelOf = (i: Obj, style: string): Obj => i.meta.bidLevelsByWindow[W][style];

const cases = [
  make('normal_above_floor'),
  make('floor_distinct', (i) => { i.recs = [1001, 1501, 2101]; i.styleIndex = 0; }),
  make('floor_one_cent_above_min_is_floor', (i) => { i.recs = [1001, 1501, 2101]; i.styleIndex = 0; i.minBidCents = 1000; }),
  make('two_cents_above_min_is_not_floor', (i) => { i.recs = [1002, 1501, 2101]; i.styleIndex = 0; i.minBidCents = 1000; }),
  make('floor_with_unreached', (i) => { i.recs = [1001, 1001, 1601]; i.styleIndex = 1; levelOf(i, 'cheap').reached = false; levelOf(i, 'balanced').reached = false; }),
  make('three_way_tie_at_floor', (i) => { i.recs = [1001, 1001, 1001]; i.styleIndex = 2; }),
  make('three_way_tie_above_floor', (i) => { i.recs = [2101, 2101, 2101]; i.styleIndex = 1; }),
  make('two_way_tie_merged_lines', (i) => { i.recs = [2101, 2601, 2601]; i.styleIndex = 1; cellOf(i).safe = cellOf(i).balanced; cellOf(i).upper.safe = cellOf(i).upper.balanced; }),
  make('three_way_tie_above_floor_same_rate_one_line', (i) => {
    i.recs = [2101, 2101, 2101]; i.styleIndex = 0; Object.assign(cellOf(i), { cheap: 0.8, balanced: 0.8, safe: 0.8 }); cellOf(i).upper = { cheap: 0.9, balanced: 0.9, safe: 0.9 };
  }),
  make('two_way_tie_same_rate_but_different_judgement_stay_apart', (i) => {
    i.recs = [2101, 2601, 2601]; i.styleIndex = 1; Object.assign(cellOf(i), { balanced: 0.75, safe: 0.75 }); cellOf(i).upper.balanced = 0.8; cellOf(i).upper.safe = 0.99;
  }),
  make('tie_with_a_style_without_measured_rate', (i) => { i.recs = [2101, 2101, 3101]; i.styleIndex = 0; cellOf(i).balanced = null; }),
  make('rare_fill_0_0199', (i) => { i.pFill = 0.0199; i.pNow = 0.99; i.conditionalMedianCents = null; }),
  make('rare_fill_0_02', (i) => { i.pFill = 0.02; i.pNow = 0.99; i.conditionalMedianCents = 2000; }),
  make('rare_fill_0_02_uncalibrated', (i) => { i.meta = {}; i.pFill = 0.02; i.pNow = 0.99; }),
  make('fill_chance_without_past_lines_shows_model_if_fills', (i) => { i.conditionalMedianCents = null; }),
  make('fallback_80_90_95_no_calibration', (i) => { i.meta = {}; i.recs = [2001, 2301, 2701]; }),
  make('fallback_all_same_at_floor', (i) => { i.meta = {}; i.recs = [1001, 1001, 1001]; i.styleIndex = 0; }),
  make('fallback_partial_tie_shows_no_same_bid_line', (i) => { i.meta = {}; i.recs = [2001, 2001, 2701]; i.styleIndex = 0; }),
  make('calibration_not_ok', (i) => { i.meta.distCalibration.ok = false; }),
  make('calibration_ok_not_true', (i) => { i.meta.distCalibration.ok = 'yes'; }),
  // malformed metadata: what bidLevels.ts rejects the Python readers must reject too
  make('malformed_band_edges_not_increasing', (i) => { i.meta.bandEdges = [15, 25, 25, 60]; }),
  make('malformed_band_edges_three_numbers', (i) => { i.meta.bandEdges = [15, 25, 40]; }),
  make('malformed_band_edges_missing', (i) => { delete i.meta.bandEdges; }),
  make('malformed_null_rate_for_chosen_style', (i) => { cellOf(i).balanced = null; }),
  make('malformed_rate_above_one_drops_window', (i) => { cellOf(i, 4).safe = 1.2; }),
  make('malformed_rate_missing_drops_window', (i) => { delete cellOf(i, 4).safe; }),
  make('malformed_rate_string_drops_window', (i) => { cellOf(i, 0).cheap = '0.7'; }),
  make('malformed_missing_band_cell_drops_window', (i) => { delete i.meta.measuredWin[W]['3']; }),
  make('malformed_nfilled_not_a_number', (i) => { cellOf(i).nFilled = '100'; }),
  make('malformed_partial_pooled_level_table_falls_back', (i) => { delete i.meta.bidLevels.safe; }),
  make('malformed_pooled_level_missing_lossfilled_key', (i) => { delete i.meta.bidLevels.cheap.lossFilled; }),
  make('malformed_pooled_reached_not_boolean', (i) => { i.meta.bidLevels.balanced.reached = 'yes'; }),
  make('malformed_partial_window_level_table_keeps_measured', (i) => { i.recs = [1001, 1001, 1001]; delete i.meta.bidLevelsByWindow[W].safe; levelOf(i, 'cheap').reached = false; }),
  make('malformed_window_level_not_below_one', (i) => { i.recs = [1001, 1001, 1001]; levelOf(i, 'safe').level = 1; levelOf(i, 'cheap').reached = false; }),
  make('malformed_window_level_lossfilled_missing', (i) => { i.recs = [1001, 1001, 1001]; delete levelOf(i, 'balanced').lossFilled; levelOf(i, 'cheap').reached = false; }),
  make('malformed_upper_out_of_range', (i) => { cellOf(i).upper.balanced = 1.4; }),
  make('malformed_upper_negative_and_not_a_number', (i) => { cellOf(i).upper.balanced = -0.1; cellOf(i).upper.safe = 'high'; }),
  make('malformed_ncourses_not_integer', (i) => { cellOf(i).nCourses = 40.5; cellOf(i).upper.balanced = 0.8; cellOf(i).balanced = 0.75; }),
  make('malformed_ncourses_zero_effcourses_zero', (i) => { cellOf(i).nCourses = 0; cellOf(i).effCourses = 0; cellOf(i).upper.balanced = 0.8; cellOf(i).balanced = 0.75; }),
  make('malformed_source_unknown', (i) => { cellOf(i).source = 'region'; }),
  make('malformed_reached_missing_for_one_style_in_tie', (i) => {
    i.recs = [1001, 1001, 1001]; i.styleIndex = 1;
    levelOf(i, 'cheap').reached = false; delete levelOf(i, 'balanced').reached; levelOf(i, 'safe').reached = false;
  }),
  make('malformed_reached_string_is_ignored', (i) => { i.recs = [1001, 1001, 1001]; i.styleIndex = 1; levelOf(i, 'cheap').reached = false; levelOf(i, 'safe').reached = 'false'; }),
  make('reached_false_only_read_from_the_window_not_pooled', (i) => { delete i.meta.bidLevelsByWindow; i.meta.bidLevels.cheap.reached = false; i.recs = [1001, 1001, 1001]; }),
  make('window_without_data', (i) => { i.window = 'Round 2 Window 2'; }),
  // below aim (balanced aims 0.85; guard: upper < 0.85 - 0.03, nCourses >= 30, effCourses >= 20)
  make('below_aim_true_at_guard_minimums', (i) => { Object.assign(cellOf(i), { balanced: 0.75, nCourses: 30, effCourses: 20 }); cellOf(i).upper.balanced = 0.8; }),
  make('below_aim_false_upper_at_threshold', (i) => { Object.assign(cellOf(i), { balanced: 0.75, nCourses: 30, effCourses: 20 }); cellOf(i).upper.balanced = 0.82; }),
  make('below_aim_true_just_under_threshold', (i) => { Object.assign(cellOf(i), { balanced: 0.75, nCourses: 30, effCourses: 20 }); cellOf(i).upper.balanced = 0.8199; }),
  make('below_aim_false_ncourses_29', (i) => { Object.assign(cellOf(i), { balanced: 0.75, nCourses: 29, effCourses: 25 }); cellOf(i).upper.balanced = 0.8; }),
  make('below_aim_false_effcourses_19_9', (i) => { Object.assign(cellOf(i), { balanced: 0.75, nCourses: 40, effCourses: 19.9 }); cellOf(i).upper.balanced = 0.8; }),
  make('below_aim_false_upper_equals_rate', (i) => { Object.assign(cellOf(i), { balanced: 0.8, nCourses: 40, effCourses: 25 }); cellOf(i).upper.balanced = 0.8; }),
  make('below_aim_false_upper_below_rate', (i) => { Object.assign(cellOf(i), { balanced: 0.8, nCourses: 40, effCourses: 25 }); cellOf(i).upper.balanced = 0.7; }),
  make('below_aim_false_upper_missing', (i) => { Object.assign(cellOf(i), { balanced: 0.75, nCourses: 40, effCourses: 25 }); delete cellOf(i).upper; }),
  make('below_aim_false_counts_missing', (i) => { Object.assign(cellOf(i), { balanced: 0.75 }); delete cellOf(i).nCourses; delete cellOf(i).effCourses; cellOf(i).upper.balanced = 0.8; }),
  make('below_aim_cheap_and_safe_use_their_own_targets', (i) => {
    i.recs = [2101, 2101, 2101]; i.styleIndex = 2;
    Object.assign(cellOf(i), { cheap: 0.6, balanced: 0.7, safe: 0.8, nCourses: 40, effCourses: 25 });
    cellOf(i).upper = { cheap: 0.66, balanced: 0.8, safe: 0.86 };
  }),
  // bands: the edges are 15 / 25 / 40 / 60 e$; the balanced rate is 0.80 + band / 100
  make('band_at_lower_edge', (i) => { i.conditionalMedianCents = 2500; }),
  make('band_just_below_edge', (i) => { i.conditionalMedianCents = 2499.99; }),
  make('band_bottom', (i) => { i.conditionalMedianCents = 500; }),
  make('band_top', (i) => { i.conditionalMedianCents = 90000; }),
  make('band_all_rounds_source', (i) => { i.conditionalMedianCents = 1000; }),
  make('band_group_source', (i) => { i.conditionalMedianCents = 2000; }),
  make('band_without_source_field', (i) => { i.conditionalMedianCents = 5000; }),
  // group, confidence, budget, rounding
  make('group_2_notice', (i) => { i.group = 2; }),
  make('group_6_notice', (i) => { i.group = 6; }),
  make('low_confidence_all_reasons', (i) => { i.reasons = ['oneSeat', 'lateWindow', 'farWindow']; i.hardWindow = true; }),
  make('low_confidence_hard_window_only', (i) => { i.hardWindow = true; }),
  make('low_confidence_far_window_only', (i) => { i.reasons = ['farWindow']; }),
  make('over_one_term_budget', (i) => { i.recs = [12401, 12501, 12601]; i.styleIndex = 1; }),
  make('exactly_the_term_budget_is_not_over', (i) => { i.recs = [12301, 12500, 12601]; i.styleIndex = 1; }),
  make('pct_under_one_percent_and_clamped_if_fills', (i) => { i.pNow = 0.0004; i.pFill = 0.6; }),
  make('pct_over_99_percent_and_full_bar', (i) => { i.pNow = 0.9996; i.pFill = 0.9996; }),
  make('pct_exactly_one', (i) => { i.pNow = 1; i.pFill = 1; }),
  make('pct_half_rounds_up', (i) => { i.pNow = 0.0095; i.pFill = 0.285; i.conditionalMedianCents = null; }),
  make('pct_thousandth_then_whole', (i) => { i.pNow = 0.6749; i.pFill = 0.6751; }),
  make('if_fills_clamped_to_zero', (i) => { i.pNow = 0.1; i.pFill = 0.5; i.conditionalMedianCents = null; }),
];

const out = cases.map((c) => ({ name: c.name, input: clone(c.input), expected: JSON.parse(JSON.stringify(panelView(c.input as unknown as PanelViewInput))) }));
// one case per line, so a changed case shows as one changed line
console.log('[\n' + out.map((c) => ' ' + JSON.stringify(c)).join(',\n') + '\n]');
