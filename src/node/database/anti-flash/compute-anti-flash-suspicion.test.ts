import { describe, it, expect } from 'vite-plus/test';
import { computeAntiFlashSuspicion } from './compute-anti-flash-suspicion';

describe('computeAntiFlashSuspicion', () => {
  it('should not flag a player with no flashed kills', () => {
    const result = computeAntiFlashSuspicion(20, 0);

    expect(result.flashedKillCount).toBe(0);
    expect(result.isFlagged).toBe(false);
  });

  it('should not flag a player with a single flashed kill (lucky blind spray)', () => {
    // Matches the real dataset: clean players peaked at exactly one flashed kill.
    const result = computeAntiFlashSuspicion(18, 1);

    expect(result.flashedKillCount).toBe(1);
    expect(result.isFlagged).toBe(false);
  });

  it('should flag a player at the exact flag count', () => {
    const result = computeAntiFlashSuspicion(15, 2);

    expect(result.flashedKillCount).toBe(2);
    expect(result.isFlagged).toBe(true);
  });

  it('should flag a player far above the flag count', () => {
    const result = computeAntiFlashSuspicion(30, 7);

    expect(result.flashedKillCount).toBe(7);
    expect(result.isFlagged).toBe(true);
  });

  it('should not flag a player with no kills', () => {
    const result = computeAntiFlashSuspicion(0, 0);

    expect(result.flashedKillCount).toBe(0);
    expect(result.isFlagged).toBe(false);
  });
});
