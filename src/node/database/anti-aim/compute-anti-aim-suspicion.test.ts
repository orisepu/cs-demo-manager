import { describe, it, expect } from 'vite-plus/test';
import { computeAntiAimSuspicion } from './compute-anti-aim-suspicion';

describe('computeAntiAimSuspicion', () => {
  it('should not flag a player with no suspicious ticks', () => {
    const result = computeAntiAimSuspicion(10_000, 0);

    expect(result.suspiciousFraction).toBe(0);
    expect(result.isFlagged).toBe(false);
  });

  it('should not flag a clean player below the threshold', () => {
    // ~0.04% suspicious ticks, matching observed clean player data.
    const result = computeAntiAimSuspicion(10_000, 4);

    expect(result.suspiciousFraction).toBeCloseTo(0.0004, 6);
    expect(result.isFlagged).toBe(false);
  });

  it('should flag a player at the exact threshold', () => {
    const result = computeAntiAimSuspicion(10_000, 35);

    expect(result.suspiciousFraction).toBeCloseTo(0.0035, 6);
    expect(result.isFlagged).toBe(true);
  });

  it('should flag a cheating player matching observed cheat data', () => {
    // ~0.6% suspicious ticks, matching the confirmed cheater in the validated dataset.
    const result = computeAntiAimSuspicion(10_000, 60);

    expect(result.suspiciousFraction).toBeCloseTo(0.006, 6);
    expect(result.isFlagged).toBe(true);
  });

  it('should not divide by zero when a player has no alive ticks', () => {
    const result = computeAntiAimSuspicion(0, 0);

    expect(result.suspiciousFraction).toBe(0);
    expect(result.isFlagged).toBe(false);
  });
});
