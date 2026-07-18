import { describe, it, expect } from 'vite-plus/test';
import { computeAimToggleSuspicion, type RoundKillStats } from './compute-aim-toggle-suspicion';

describe('computeAimToggleSuspicion', () => {
  it('should flag a mediocre-baseline player with a near-perfect qualifying round (the toggle)', () => {
    // Baseline: 3 / 13 = 0.23 (mediocre). One isolated round with 3/3 headshots (the toggle).
    const rounds: RoundKillStats[] = [
      { roundNumber: 4, killCount: 3, headshotKillCount: 3, headshotTick: 5000 },
      { roundNumber: 8, killCount: 5, headshotKillCount: 0, headshotTick: null },
      { roundNumber: 12, killCount: 5, headshotKillCount: 0, headshotTick: null },
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
      { roundNumber: 1, killCount: 4, headshotKillCount: 4, headshotTick: 1000 },
      { roundNumber: 2, killCount: 4, headshotKillCount: 3, headshotTick: 2000 },
      { roundNumber: 3, killCount: 4, headshotKillCount: 2, headshotTick: 3000 },
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
      { roundNumber: 5, killCount: 2, headshotKillCount: 2, headshotTick: 4000 },
      { roundNumber: 9, killCount: 5, headshotKillCount: 1, headshotTick: 4200 },
    ];

    const result = computeAimToggleSuspicion(rounds);

    expect(result.isFlagged).toBe(false);
    expect(result.hotRoundNumber).toBe(9);
    expect(result.hotRoundHeadshotRate).toBeCloseTo(0.2);
  });

  it('should NOT flag a mediocre player with no near-perfect round', () => {
    // Baseline mediocre and every qualifying round stays well below HOT_ROUND_MIN.
    const rounds: RoundKillStats[] = [
      { roundNumber: 2, killCount: 4, headshotKillCount: 1, headshotTick: 6000 },
      { roundNumber: 6, killCount: 5, headshotKillCount: 2, headshotTick: 6500 },
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
      { roundNumber: 4, killCount: 3, headshotKillCount: 3, headshotTick: 5000 },
      { roundNumber: 7, killCount: 3, headshotKillCount: 3, headshotTick: 7000 },
      { roundNumber: 10, killCount: 10, headshotKillCount: 0, headshotTick: null },
    ];

    const result = computeAimToggleSuspicion(rounds);

    expect(result.isFlagged).toBe(true);
    expect(result.moments).toHaveLength(2);
    expect(result.moments.map((moment) => moment.roundNumber)).toEqual([4, 7]);
    expect(result.moments[0]).toEqual({ tick: 5000, roundNumber: 4, label: 'Round 4 · 100% HS (3 kills)' });
  });

  it('does not surface moments for a non-flagged player', () => {
    const rounds: RoundKillStats[] = [
      { roundNumber: 1, killCount: 4, headshotKillCount: 4, headshotTick: 1000 },
      { roundNumber: 2, killCount: 4, headshotKillCount: 3, headshotTick: 2000 },
      { roundNumber: 3, killCount: 4, headshotKillCount: 2, headshotTick: 3000 },
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
});
