// vite-node config for forecast_bid_parity_gen.ts: replaces the bid-level loader (it reads the private forecast-meta.json) with
// fixed calibrated levels, so presets.ts runs in calibrated mode whatever data is on this machine.
const lv = (level: number) => ({ level, lossFilled: 0.1, lossAll: 0.07, winAboveFloor: 0.86, meanOverpay: 6.6, reached: true });
const STUB = `export const bidLevels = () => ({ cheap: ${JSON.stringify(lv(0.9))}, balanced: ${JSON.stringify(lv(0.975))}, safe: ${JSON.stringify(lv(0.99))} });
export const bidWindowData = () => null;`;

// run from repo/site (the root is the working directory)
export default {
  server: { fs: { strict: false } }, // this file and the generator live outside repo/site
  plugins: [{
    name: 'stub-bid-levels',
    enforce: 'pre',
    resolveId(id, importer) {
      if (id.endsWith('/data/bidLevels') && importer?.includes('/lib/sim/presets')) return '\0stub-bid-levels';
      return null;
    },
    load(id) { return id === '\0stub-bid-levels' ? STUB : null; },
  }],
};
