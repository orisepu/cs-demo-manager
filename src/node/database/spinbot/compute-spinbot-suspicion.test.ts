import { describe, it, expect } from 'vite-plus/test';
import { computeSpinbotSuspicion } from './compute-spinbot-suspicion';

describe('computeSpinbotSuspicion', () => {
  it('should not flag a player with a low sustained yaw velocity', () => {
    const result = computeSpinbotSuspicion(10_000, 12);

    expect(result.maxRollingMeanYawDelta).toBe(12);
    expect(result.isFlagged).toBe(false);
  });

  it('should not flag a clean player just below the threshold', () => {
    // ~15 degrees/tick, matching the highest observed clean player in the validated dataset.
    const result = computeSpinbotSuspicion(10_000, 15.31);

    expect(result.maxRollingMeanYawDelta).toBeCloseTo(15.31, 2);
    expect(result.isFlagged).toBe(false);
  });

  it('should flag a player at the exact threshold', () => {
    const result = computeSpinbotSuspicion(10_000, 45);

    expect(result.maxRollingMeanYawDelta).toBe(45);
    expect(result.isFlagged).toBe(true);
  });

  it('should flag a spinning player far above the threshold', () => {
    const result = computeSpinbotSuspicion(10_000, 160);

    expect(result.maxRollingMeanYawDelta).toBe(160);
    expect(result.isFlagged).toBe(true);
  });

  it('should not flag a player with no analyzed alive ticks', () => {
    const result = computeSpinbotSuspicion(0, 0);

    expect(result.maxRollingMeanYawDelta).toBe(0);
    expect(result.isFlagged).toBe(false);
  });
});
