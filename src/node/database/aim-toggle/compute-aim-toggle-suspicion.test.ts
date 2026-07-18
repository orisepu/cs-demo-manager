import { describe, it, expect } from 'vite-plus/test';
import { computeAimToggleSuspicion, type RoundKillStats } from './compute-aim-toggle-suspicion';

// Round factory with sensible defaults so a test only spells out the fields it cares about. Shot
// fields default to "no shooting" so the headshot cases below are unaffected by the accuracy trigger.
function round(partial: Partial<RoundKillStats> & { roundNumber: number }): RoundKillStats {
  return {
    killCount: 0,
    headshotKillCount: 0,
    headshotTick: null,
    shotCount: 0,
    hitCount: 0,
    shotTick: null,
    ...partial,
  };
}

describe('computeAimToggleSuspicion', () => {
  it('should flag a mediocre-baseline player with a near-perfect qualifying round (the toggle)', () => {
    // Baseline: 3 / 13 = 0.23 (mediocre). One isolated round with 3/3 headshots (the toggle).
    const rounds: RoundKillStats[] = [
      round({ roundNumber: 4, killCount: 3, headshotKillCount: 3, headshotTick: 5000 }),
      round({ roundNumber: 8, killCount: 5, headshotKillCount: 0 }),
      round({ roundNumber: 12, killCount: 5, headshotKillCount: 0 }),
    ];

    const result = computeAimToggleSuspicion(rounds);

    expect(result.isFlagged).toBe(true);
    expect(result.baselineHeadshotRate).toBeCloseTo(3 / 13);
    expect(result.hotRoundNumber).toBe(4);
    expect(result.hotRoundHeadshotRate).toBe(1);
    expect(result.tick).toBe(5000);
  });

  it('should NOT flag a consistently-good player with a 100% round (skill, not a toggle)', () => {
    // Baseline: 9 / 12 = 0.75 (high). The 100% round is just this player's normal level.
    const rounds: RoundKillStats[] = [
      round({ roundNumber: 1, killCount: 4, headshotKillCount: 4, headshotTick: 1000 }),
      round({ roundNumber: 2, killCount: 4, headshotKillCount: 3, headshotTick: 2000 }),
      round({ roundNumber: 3, killCount: 4, headshotKillCount: 2, headshotTick: 3000 }),
    ];

    const result = computeAimToggleSuspicion(rounds);

    expect(result.isFlagged).toBe(false);
    expect(result.baselineHeadshotRate).toBeCloseTo(0.75);
    expect(result.hotRoundHeadshotRate).toBe(1);
  });

  it('should NOT flag a mediocre player whose best round is below MIN_ROUND_KILLS kills', () => {
    // The perfect round has only 2 kills (below the 3-kill floor) so it never qualifies. The only
    // qualifying round is a low-headshot one.
    const rounds: RoundKillStats[] = [
      round({ roundNumber: 5, killCount: 2, headshotKillCount: 2, headshotTick: 4000 }),
      round({ roundNumber: 9, killCount: 5, headshotKillCount: 1, headshotTick: 4200 }),
    ];

    const result = computeAimToggleSuspicion(rounds);

    expect(result.isFlagged).toBe(false);
    expect(result.hotRoundNumber).toBe(9);
    expect(result.hotRoundHeadshotRate).toBeCloseTo(0.2);
  });

  it('should NOT flag a mediocre player with no near-perfect round', () => {
    // Baseline mediocre and every qualifying round stays well below HOT_ROUND_MIN.
    const rounds: RoundKillStats[] = [
      round({ roundNumber: 2, killCount: 4, headshotKillCount: 1, headshotTick: 6000 }),
      round({ roundNumber: 6, killCount: 5, headshotKillCount: 2, headshotTick: 6500 }),
    ];

    const result = computeAimToggleSuspicion(rounds);

    expect(result.isFlagged).toBe(false);
    expect(result.baselineHeadshotRate).toBeCloseTo(3 / 9);
    expect(result.hotRoundHeadshotRate).toBeCloseTo(0.4);
  });

  it('surfaces one moment per qualifying hot round for a flagged player', () => {
    // Mediocre baseline (6 / 16 = 0.375) with two isolated near-perfect rounds (the toggle fired
    // twice). Both qualifying rounds should become moments, ordered by round number.
    const rounds: RoundKillStats[] = [
      round({ roundNumber: 4, killCount: 3, headshotKillCount: 3, headshotTick: 5000 }),
      round({ roundNumber: 7, killCount: 3, headshotKillCount: 3, headshotTick: 7000 }),
      round({ roundNumber: 10, killCount: 10, headshotKillCount: 0 }),
    ];

    const result = computeAimToggleSuspicion(rounds);

    expect(result.isFlagged).toBe(true);
    expect(result.moments).toHaveLength(2);
    expect(result.moments.map((moment) => moment.roundNumber)).toEqual([4, 7]);
    expect(result.moments[0]).toEqual({ tick: 5000, roundNumber: 4, label: 'Round 4 · 100% HS (3 kills)' });
  });

  it('does not surface moments for a non-flagged player', () => {
    const rounds: RoundKillStats[] = [
      round({ roundNumber: 1, killCount: 4, headshotKillCount: 4, headshotTick: 1000 }),
      round({ roundNumber: 2, killCount: 4, headshotKillCount: 3, headshotTick: 2000 }),
      round({ roundNumber: 3, killCount: 4, headshotKillCount: 2, headshotTick: 3000 }),
    ];

    const result = computeAimToggleSuspicion(rounds);

    expect(result.isFlagged).toBe(false);
    expect(result.moments).toEqual([]);
  });

  it('should not flag a player with no kills', () => {
    const result = computeAimToggleSuspicion([]);

    expect(result.isFlagged).toBe(false);
    expect(result.baselineHeadshotRate).toBe(0);
    expect(result.hotRoundNumber).toBe(null);
    expect(result.tick).toBe(null);
  });

  it('should flag a mediocre-accuracy player with a superhuman accuracy round (body-aimbot toggle)', () => {
    // Overall accuracy 30 / 130 = 0.23 (mediocre) with no headshots at all, so ONLY the accuracy
    // trigger fires: round 5 lands 19 / 20 = 0.95 shots (>= HOT_ACCURACY over >= MIN_ROUND_SHOTS).
    const rounds: RoundKillStats[] = [
      round({ roundNumber: 5, killCount: 4, headshotKillCount: 0, shotCount: 20, hitCount: 19, shotTick: 4900 }),
      round({ roundNumber: 9, killCount: 4, headshotKillCount: 0, shotCount: 60, hitCount: 6, shotTick: 8800 }),
      round({ roundNumber: 12, killCount: 3, headshotKillCount: 0, shotCount: 50, hitCount: 5, shotTick: 11500 }),
    ];

    const result = computeAimToggleSuspicion(rounds);

    expect(result.isFlagged).toBe(true);
    expect(result.baselineAccuracy).toBeCloseTo(30 / 130);
    expect(result.hotAccuracyRoundNumber).toBe(5);
    expect(result.hotRoundAccuracy).toBeCloseTo(0.95);
    // Headshot trigger did not fire (no near-perfect HS round).
    expect(result.hotRoundHeadshotRate).toBeLessThan(0.85);
    // With no headshot round to jump to, the accuracy round supplies both the viewer tick and moment.
    expect(result.tick).toBe(4900);
    expect(result.moments).toEqual([{ tick: 4900, roundNumber: 5, label: 'Round 5 · 95% accuracy (19/20)' }]);
  });

  it('should NOT flag a superhuman accuracy round that is below MIN_ROUND_SHOTS shots', () => {
    // 10 / 10 = 100% accuracy but only 10 shots (< MIN_ROUND_SHOTS), so it never qualifies; the only
    // qualifying accuracy round (round 7) is unremarkable.
    const rounds: RoundKillStats[] = [
      round({
        roundNumber: 3,
        killCount: 3,
        headshotKillCount: 1,
        headshotTick: 3000,
        shotCount: 10,
        hitCount: 10,
        shotTick: 2900,
      }),
      round({
        roundNumber: 7,
        killCount: 4,
        headshotKillCount: 1,
        headshotTick: 7000,
        shotCount: 60,
        hitCount: 9,
        shotTick: 6900,
      }),
    ];

    const result = computeAimToggleSuspicion(rounds);

    expect(result.isFlagged).toBe(false);
    expect(result.hotAccuracyRoundNumber).toBe(7);
    expect(result.hotRoundAccuracy).toBeCloseTo(0.15);
  });

  it('should NOT flag a consistently-accurate player via the accuracy trigger (skill, not a toggle)', () => {
    // Overall accuracy 40 / 60 = 0.67 (> BASELINE_ACCURACY_MAX), so a superhuman round is skill.
    const rounds: RoundKillStats[] = [
      round({
        roundNumber: 1,
        killCount: 4,
        headshotKillCount: 1,
        headshotTick: 1000,
        shotCount: 30,
        hitCount: 28,
        shotTick: 900,
      }),
      round({
        roundNumber: 2,
        killCount: 4,
        headshotKillCount: 1,
        headshotTick: 2000,
        shotCount: 30,
        hitCount: 12,
        shotTick: 1900,
      }),
    ];

    const result = computeAimToggleSuspicion(rounds);

    expect(result.isFlagged).toBe(false);
    expect(result.baselineAccuracy).toBeCloseTo(40 / 60);
  });

  it('flags on the headshot trigger even when accuracy is unremarkable', () => {
    // Confirms the two triggers are independent: near-perfect HS round + mediocre HS baseline flags
    // regardless of the (mediocre) accuracy numbers.
    const rounds: RoundKillStats[] = [
      round({
        roundNumber: 4,
        killCount: 3,
        headshotKillCount: 3,
        headshotTick: 5000,
        shotCount: 10,
        hitCount: 2,
        shotTick: 4900,
      }),
      round({ roundNumber: 8, killCount: 5, headshotKillCount: 0, shotCount: 12, hitCount: 3, shotTick: 8900 }),
    ];

    const result = computeAimToggleSuspicion(rounds);

    expect(result.isFlagged).toBe(true);
    expect(result.hotRoundNumber).toBe(4);
    // No round reaches MIN_ROUND_SHOTS, so the accuracy trigger has no qualifying round.
    expect(result.hotAccuracyRoundNumber).toBe(null);
  });
});
