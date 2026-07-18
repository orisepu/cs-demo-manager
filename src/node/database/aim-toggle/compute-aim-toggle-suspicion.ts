// Minimum number of kills a round must contain for its headshot rate to be trusted. Below this a
// 100% headshot round is just one or two lucky headshots, not a signal. Keeping it at three means a
// "hot" round is at least 3/3 headshots.
export const MIN_ROUND_KILLS = 3;

// Upper bound on the OVERALL (baseline) headshot rate for a player to still be considered "mediocre".
// The aim-toggle signature is a CONTRAST: a normal overall aim with one isolated near-perfect round.
// A player whose baseline is already above this is simply a consistently-good shot, so a 100% round
// is skill, not a toggle, and must NOT be flagged.
export const BASELINE_MAX = 0.45;

// Lower bound on a single qualifying round's headshot rate for that round to count as "near-perfect"
// (the toggled-on moment). Combined with a mediocre baseline this is the toggle signature.
export const HOT_ROUND_MIN = 0.85;

export type RoundKillStats = {
  roundNumber: number;
  killCount: number;
  headshotKillCount: number;
  // Tick of a headshot kill in this round, for the 2D-viewer jump. Null when the round has no
  // headshot kill (it can never be the hot round in that case).
  headshotTick: number | null;
};

export type AimToggleSuspicionScore = {
  baselineHeadshotRate: number;
  hotRoundNumber: number | null;
  hotRoundHeadshotRate: number;
  tick: number | null;
  isFlagged: boolean;
};

// Pure scoring function extracted from the DB query so the aim-toggle heuristic can be unit tested
// without a live database connection.
//
// Toggle logic: flag a player only when BOTH the overall baseline headshot rate is mediocre
// (<= BASELINE_MAX) AND at least one qualifying round (>= MIN_ROUND_KILLS kills) reaches a
// near-perfect headshot rate (>= HOT_ROUND_MIN). The hot round returned is the qualifying round with
// the highest headshot rate; ties keep the first (lowest round number) since the input is ordered.
export function computeAimToggleSuspicion(rounds: RoundKillStats[]): AimToggleSuspicionScore {
  let totalKillCount = 0;
  let totalHeadshotKillCount = 0;
  for (const round of rounds) {
    totalKillCount += round.killCount;
    totalHeadshotKillCount += round.headshotKillCount;
  }

  const baselineHeadshotRate = totalKillCount > 0 ? totalHeadshotKillCount / totalKillCount : 0;

  let hotRoundNumber: number | null = null;
  let hotRoundHeadshotRate = 0;
  let tick: number | null = null;
  for (const round of rounds) {
    if (round.killCount < MIN_ROUND_KILLS) {
      continue;
    }

    const roundHeadshotRate = round.headshotKillCount / round.killCount;
    if (hotRoundNumber === null || roundHeadshotRate > hotRoundHeadshotRate) {
      hotRoundNumber = round.roundNumber;
      hotRoundHeadshotRate = roundHeadshotRate;
      tick = round.headshotTick;
    }
  }

  const hasHotRound = hotRoundNumber !== null && hotRoundHeadshotRate >= HOT_ROUND_MIN;
  const isFlagged = baselineHeadshotRate <= BASELINE_MAX && hasHotRound;

  return {
    baselineHeadshotRate,
    hotRoundNumber,
    hotRoundHeadshotRate,
    tick,
    isFlagged,
  };
}
