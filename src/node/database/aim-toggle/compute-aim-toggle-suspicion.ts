import { MAX_DETECTION_MOMENTS, type DetectionMoment } from 'csdm/common/types/detection-moment';

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

// Minimum number of shots a round must contain for its accuracy to be trusted. Per-round accuracy
// over a handful of shots is extremely noisy (a couple of point-blank sprays reads as 100%), so the
// accuracy trigger only looks at rounds where the player pulled the trigger a substantial number of
// times.
export const MIN_ROUND_SHOTS = 15;

// Upper bound on the OVERALL (baseline) accuracy for a player to still be considered "mediocre". The
// accuracy toggle is the same CONTRAST shape as the headshot one: a normal overall accuracy with one
// isolated superhuman round. A consistently accurate player is skill, not a body-aimbot toggle.
export const BASELINE_ACCURACY_MAX = 0.35;

// Lower bound on a single qualifying round's accuracy (landing shots / shots) for it to count as
// "superhuman" (the toggled-on moment). Set ABOVE the legit per-round ceiling observed in real
// lobbies (~85% over 15+ shots) so a genuine body-aimbot round (lands ~95-100%) trips it while a hot
// legit spray-down round does not.
export const HOT_ACCURACY = 0.9;

export type RoundKillStats = {
  roundNumber: number;
  killCount: number;
  headshotKillCount: number;
  // Tick of a headshot kill in this round, for the 2D-viewer jump. Null when the round has no
  // headshot kill (it can never be the hot round in that case).
  headshotTick: number | null;
  // Trigger pulls in this round and landing shots (distinct-tick damage events, so a shotgun blast
  // counts once). Default to 0 for rounds with no shot/damage data.
  shotCount: number;
  hitCount: number;
  // Tick of the first shot in this round, for the accuracy-moment viewer jump. Null when the player
  // did not shoot in the round.
  shotTick: number | null;
};

export type AimToggleSuspicionScore = {
  baselineHeadshotRate: number;
  hotRoundNumber: number | null;
  hotRoundHeadshotRate: number;
  // Overall match accuracy and the hottest qualifying accuracy round (the second, independent
  // trigger). Null/0 when the player has no qualifying accuracy round.
  baselineAccuracy: number;
  hotAccuracyRoundNumber: number | null;
  hotRoundAccuracy: number;
  tick: number | null;
  // One moment per qualifying "hot" round: near-perfect headshot rounds AND superhuman accuracy
  // rounds. Only populated when the player is flagged. Empty otherwise.
  moments: DetectionMoment[];
  isFlagged: boolean;
};

// Pure scoring function extracted from the DB query so the aim-toggle heuristic can be unit tested
// without a live database connection.
//
// Two independent toggle triggers, either of which flags the player:
//  - Headshot trigger (original): mediocre overall headshot rate (<= BASELINE_MAX) AND at least one
//    qualifying round (>= MIN_ROUND_KILLS kills) reaching a near-perfect headshot rate
//    (>= HOT_ROUND_MIN). Catches a headshot aimbot toggled on and off.
//  - Accuracy trigger (added): mediocre overall accuracy (<= BASELINE_ACCURACY_MAX) AND at least one
//    qualifying round (>= MIN_ROUND_SHOTS shots) reaching a superhuman accuracy (>= HOT_ACCURACY).
//    Catches a body-aimbot toggle that lands shots without necessarily hitting heads.
// The hot round returned for each metric is the qualifying round with the highest rate; ties keep the
// first (lowest round number) since the input is ordered.
export function computeAimToggleSuspicion(rounds: RoundKillStats[]): AimToggleSuspicionScore {
  let totalKillCount = 0;
  let totalHeadshotKillCount = 0;
  let totalShotCount = 0;
  let totalHitCount = 0;
  for (const round of rounds) {
    totalKillCount += round.killCount;
    totalHeadshotKillCount += round.headshotKillCount;
    totalShotCount += round.shotCount;
    totalHitCount += round.hitCount;
  }

  const baselineHeadshotRate = totalKillCount > 0 ? totalHeadshotKillCount / totalKillCount : 0;
  const baselineAccuracy = totalShotCount > 0 ? totalHitCount / totalShotCount : 0;

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

  let hotAccuracyRoundNumber: number | null = null;
  let hotRoundAccuracy = 0;
  for (const round of rounds) {
    if (round.shotCount < MIN_ROUND_SHOTS) {
      continue;
    }

    const roundAccuracy = round.hitCount / round.shotCount;
    if (hotAccuracyRoundNumber === null || roundAccuracy > hotRoundAccuracy) {
      hotAccuracyRoundNumber = round.roundNumber;
      hotRoundAccuracy = roundAccuracy;
    }
  }

  const hasHotHeadshotRound = hotRoundNumber !== null && hotRoundHeadshotRate >= HOT_ROUND_MIN;
  const isHeadshotToggle = baselineHeadshotRate <= BASELINE_MAX && hasHotHeadshotRound;

  const hasHotAccuracyRound = hotAccuracyRoundNumber !== null && hotRoundAccuracy >= HOT_ACCURACY;
  const isAccuracyToggle = baselineAccuracy <= BASELINE_ACCURACY_MAX && hasHotAccuracyRound;

  const isFlagged = isHeadshotToggle || isAccuracyToggle;

  // The viewer-jump target prefers the headshot hot round (keeps the original behavior); if the flag
  // came only from the accuracy trigger, fall back to the hot accuracy round's first shot tick.
  if (tick === null && isAccuracyToggle) {
    const hotAccuracyRound = rounds.find((round) => round.roundNumber === hotAccuracyRoundNumber);
    tick = hotAccuracyRound?.shotTick ?? null;
  }

  // Every qualifying near-perfect headshot round and every superhuman accuracy round becomes a
  // clickable moment (only surfaced for flagged players), ordered by round number.
  let moments: DetectionMoment[] = [];
  if (isFlagged) {
    const headshotMoments: DetectionMoment[] = rounds
      .filter((round) => {
        return (
          round.killCount >= MIN_ROUND_KILLS &&
          round.headshotTick !== null &&
          round.headshotKillCount / round.killCount >= HOT_ROUND_MIN
        );
      })
      .map((round) => {
        const headshotPercentage = Math.round((round.headshotKillCount / round.killCount) * 100);
        return {
          tick: round.headshotTick as number,
          roundNumber: round.roundNumber,
          label: `Round ${round.roundNumber} · ${headshotPercentage}% HS (${round.killCount} kills)`,
        };
      });

    const accuracyMoments: DetectionMoment[] = rounds
      .filter((round) => {
        return (
          round.shotCount >= MIN_ROUND_SHOTS &&
          round.shotTick !== null &&
          round.hitCount / round.shotCount >= HOT_ACCURACY
        );
      })
      .map((round) => {
        const accuracyPercentage = Math.round((round.hitCount / round.shotCount) * 100);
        return {
          tick: round.shotTick as number,
          roundNumber: round.roundNumber,
          label: `Round ${round.roundNumber} · ${accuracyPercentage}% accuracy (${round.hitCount}/${round.shotCount})`,
        };
      });

    moments = [...headshotMoments, ...accuracyMoments]
      .toSorted((a, b) => a.roundNumber - b.roundNumber)
      .slice(0, MAX_DETECTION_MOMENTS);
  }

  return {
    baselineHeadshotRate,
    hotRoundNumber,
    hotRoundHeadshotRate,
    baselineAccuracy,
    hotAccuracyRoundNumber,
    hotRoundAccuracy,
    tick,
    moments,
    isFlagged,
  };
}
