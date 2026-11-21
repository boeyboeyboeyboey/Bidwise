import { afterEach, describe, expect, it, vi } from 'vitest';
import forecastMeta from '../../data/real/forecast-meta.json';
import type { ForecastMeta } from '../data/types';

// Guard on the bid levels the site actually ships (data/real/forecast-meta.json). The Planner passes a style as its pooled
// numeric level and `presetFor` finds the style by that number, so two styles sharing a level, or levels out of order, would
// make the Planner treat them as one. The site stage runs `npm test` before going live, so a bad refit stops here.
// Not mocked: test-setup.ts forces calibrated levels under BIDWISE_FORCE_BIDLEVELS, so the real loader is taken with importActual.

afterEach(() => vi.doUnmock('../data/bidLevels'));

async function shipped() {
  vi.resetModules();
  const actual = await vi.importActual<typeof import('../data/bidLevels')>('../data/bidLevels');
  vi.doMock('../data/bidLevels', () => actual);
  const presets = await import('./presets');
  return { actual, presets };
}

describe('shipped bid levels', () => {
  it('the pooled levels rise strictly from Cheap to Balanced to Safe, when calibrated', async () => {
    const { actual } = await shipped();
    const lv = actual.bidLevels(forecastMeta as unknown as ForecastMeta);
    if (!lv) return; // not calibrated: the plain 80 / 90 / 95% presets apply (checked below)
    expect(lv.cheap.level).toBeLessThan(lv.balanced.level);
    expect(lv.balanced.level).toBeLessThan(lv.safe.level);
  });

  it('the shipped presets are three distinct styles in rising order, and each resolves from its own level', async () => {
    const { presets } = await shipped();
    const ps = presets.bidPresets();
    expect(ps).toHaveLength(3);
    expect(new Set(ps.map((p) => p.key)).size).toBe(3);
    expect(ps[0].level).toBeLessThan(ps[1].level);
    expect(ps[1].level).toBeLessThan(ps[2].level);
    for (const p of ps) expect(presets.presetFor(p.level)?.key).toBe(p.key);
  });
});
