import { describe, it, expect } from 'vite-plus/test';
import {
  computeAimOutlierSuspicions,
  MIN_KILLS,
  MIN_SHOTS,
  type PlayerAimStats,
} from './compute-aim-outlier-suspicion';

// Builds a player with the given match-wide totals and no per-round detail (moments are covered in a
// dedicated test). Kills/shots default above the minimum sample sizes so the player qualifies.
function makePlayer(
  playerSteamId: string,
  { killCount = MIN_KILLS, headshotKillCount = 0, shotCount = MIN_SHOTS, hitCount = 0 }: Partial<PlayerAimStats>,
): PlayerAimStats {
  return {
    playerSteamId,
    playerName: playerSteamId,
    killCount,
    headshotKillCount,
    shotCount,
    hitCount,
    rounds: [],
  };
}

// Five baseline players with a ~40% headshot rate and ~20% accuracy, enough to seed a stable median.
function baselineLobby(): PlayerAimStats[] {
  return [
    makePlayer('b1', { killCount: 15, headshotKillCount: 6, shotCount: 100, hitCount: 20 }),
    makePlayer('b2', { killCount: 15, headshotKillCount: 6, shotCount: 100, hitCount: 20 }),
    makePlayer('b3', { killCount: 15, headshotKillCount: 6, shotCount: 100, hitCount: 20 }),
    makePlayer('b4', { killCount: 15, headshotKillCount: 6, shotCount: 100, hitCount: 20 }),
    makePlayer('b5', { killCount: 15, headshotKillCount: 6, shotCount: 100, hitCount: 20 }),
  ];
}

describe('computeAimOutlierSuspicions', () => {
  it('flags a headshot-rate outlier above baseline + HS_MARGIN', () => {
    // Baseline HS median = 0.40. Outlier at 12/16 = 0.75 >= 0.40 + 0.15 = 0.55.
    const players = [
      ...baselineLobby(),
      makePlayer('cheater', { killCount: 16, headshotKillCount: 12, shotCount: 100, hitCount: 20 }),
    ];

    const scores = computeAimOutlierSuspicions(players);
    const cheater = scores.find((score) => score.playerSteamId === 'cheater');

    expect(cheater?.isHeadshotOutlier).toBe(true);
    expect(cheater?.isAccuracyOutlier).toBe(false);
    expect(cheater?.isFlagged).toBe(true);
    expect(cheater?.baselineHeadshotRate).toBeCloseTo(0.4);
  });

  it('flags an accuracy outlier above baseline + ACC_MARGIN (body-aimbot shape)', () => {
    // Baseline accuracy median = 0.20. Outlier at 80/100 = 0.80 >= 0.20 + 0.15 = 0.35, with a normal
    // headshot rate so it trips ONLY on accuracy.
    const players = [
      ...baselineLobby(),
      makePlayer('bodyaim', { killCount: 15, headshotKillCount: 6, shotCount: 100, hitCount: 80 }),
    ];

    const scores = computeAimOutlierSuspicions(players);
    const bodyaim = scores.find((score) => score.playerSteamId === 'bodyaim');

    expect(bodyaim?.isAccuracyOutlier).toBe(true);
    expect(bodyaim?.isHeadshotOutlier).toBe(false);
    expect(bodyaim?.isFlagged).toBe(true);
    expect(bodyaim?.baselineAccuracy).toBeCloseTo(0.2);
  });

  it('does NOT flag a player level with the pack', () => {
    const players = baselineLobby();

    const scores = computeAimOutlierSuspicions(players);

    expect(scores.every((score) => !score.isFlagged)).toBe(true);
  });

  it('does NOT flag a player below the minimum sample sizes even with perfect ratios', () => {
    // A perfect 3/3 headshots and 5/5 accuracy but below MIN_KILLS/MIN_SHOTS, so neither metric
    // qualifies and the player is never an outlier.
    const players = [
      ...baselineLobby(),
      makePlayer('smallsample', { killCount: 3, headshotKillCount: 3, shotCount: 5, hitCount: 5 }),
    ];

    const scores = computeAimOutlierSuspicions(players);
    const smallSample = scores.find((score) => score.playerSteamId === 'smallsample');

    expect(smallSample?.isFlagged).toBe(false);
  });

  it('flags nobody when there are too few qualifying players for a baseline', () => {
    // Only two qualifying players (< MIN_BASELINE_PLAYERS): no trustworthy median, so no flags even
    // though one is far above the other.
    const players = [
      makePlayer('a', { killCount: 15, headshotKillCount: 3, shotCount: 100, hitCount: 15 }),
      makePlayer('b', { killCount: 15, headshotKillCount: 14, shotCount: 100, hitCount: 90 }),
    ];

    const scores = computeAimOutlierSuspicions(players);

    expect(scores.every((score) => !score.isFlagged)).toBe(true);
  });

  it('surfaces headshot and accuracy moments for a flagged player, ordered by round', () => {
    const cheater: PlayerAimStats = {
      playerSteamId: 'cheater',
      playerName: 'cheater',
      killCount: 16,
      headshotKillCount: 12,
      shotCount: 100,
      hitCount: 20,
      rounds: [
        {
          roundNumber: 3,
          killCount: 3,
          headshotKillCount: 3,
          headshotTick: 3000,
          shotCount: 8,
          hitCount: 3,
          shotTick: 2900,
        },
        {
          roundNumber: 8,
          killCount: 1,
          headshotKillCount: 0,
          headshotTick: null,
          shotCount: 20,
          hitCount: 16,
          shotTick: 8000,
        },
      ],
    };
    const players = [...baselineLobby(), cheater];

    const scores = computeAimOutlierSuspicions(players);
    const flagged = scores.find((score) => score.playerSteamId === 'cheater');

    expect(flagged?.isFlagged).toBe(true);
    expect(flagged?.moments.map((moment) => moment.roundNumber)).toEqual([3, 8]);
    expect(flagged?.moments[0].label).toBe('Round 3 · 100% HS (3 kills)');
    expect(flagged?.moments[1].label).toBe('Round 8 · 80% accuracy (16/20)');
    expect(flagged?.tick).toBe(3000);
  });

  it('does not surface moments for a non-flagged player', () => {
    const players = baselineLobby();

    const scores = computeAimOutlierSuspicions(players);

    expect(scores.every((score) => score.moments.length === 0)).toBe(true);
  });
});
