// Vitest setup, test-only. With BIDWISE_FORCE_BIDLEVELS=calibrated every test file sees calibrated bid levels,
// unless it mocks the bidLevels loader itself. Used to prove the suite passes in both modes; production code never reads this.
// vi.doMock, not vi.mock: vi.mock is hoisted out of the if.
import { vi } from 'vitest';

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;

if (env?.BIDWISE_FORCE_BIDLEVELS === 'calibrated') {
  const lv = (level: number, lossFilled: number) => ({ level, lossFilled, lossAll: 0.07, winAboveFloor: 0.86, meanOverpay: 6.6, reached: true });
  vi.doMock('./lib/data/bidLevels', () => ({
    bidLevels: () => ({ cheap: lv(0.9, 0.304), balanced: lv(0.975, 0.157), safe: lv(0.99, 0.106) }),
    bidWindowData: () => null,
  }));
}
