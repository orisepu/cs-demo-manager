import { MAX_DETECTION_MOMENTS, type DetectionMoment } from 'csdm/common/types/detection-moment';

// Minimum match-wide kills a player needs before their headshot rate is trusted as a sample. Below
// this a high headshot rate is just a couple of lucky headshots, not a stable signal.
export const MIN_KILLS = 10;

// Minimum match-wide trigger pulls (shots) a player needs before their accuracy is trusted.
export const MIN_SHOTS = 30;

// How far ABOVE the match median a player's headshot rate must sit to be flagged as an outlier. The
// baseline is the median across the OTHER qualifying players in the same match, so the bar
// self-adjusts to the lobby's skill. 0.15 (15 percentage points over the median) is deliberately
// wide: it only trips on a player who is clearly detached from the pack, never one barely above it.
export const HS_MARGIN = 0.15;

// How far above the match median accuracy a player must sit to be flagged. Accuracy (landing shots /
// shots) clusters tightly (~15-35% in real lobbies) and is noisier than headshot rate (shotgun/spray
// inflation), so a full 15-point gap above the median is a conservative "blatant only" bar: a real
// body-aimbot lands 60%+, far past any legit top-fragger.
export const ACC_MARGIN = 0.15;

// Minimum number of qualifying players required before a match median is trusted as a baseline. With
// fewer than this the median is unstable (you cannot call someone an outlier against an almost empty
// pool), so the corresponding metric flags nobody in that match.
export const MIN_BASELINE_PLAYERS = 4;

// A round needs at least this many kills before its headshot rate can seed a "notable round" moment.
export const MIN_ROUND_KILLS = 3;

// A round needs at least this many shots before its accuracy can seed a "notable round" moment.
export const MIN_ROUND_SHOTS = 15;

// Per-round headshot rate at or above this surfaces the round as a moment (flagged players only).
export const HOT_ROUND_HEADSHOT_RATE = 0.7;

// Per-round accuracy at or above this surfaces the round as a moment (flagged players only).
export const HOT_ROUND_ACCURACY = 0.5;

export type PlayerRoundAim = {
  roundNumber: number;
  killCount: number;
  headshotKillCount: number;
  // Tick of a headshot kill in this round, for the 2D-viewer jump. Null when the round has none.
  headshotTick: number | null;
  shotCount: number;
  // Landing shots in this round (distinct-tick damage events, so a shotgun blast counts once).
  hitCount: number;
  // Tick of the first shot in this round, for the 2D-viewer jump. Null when the player did not shoot.
  shotTick: number | null;
};

export type PlayerAimStats = {
  playerSteamId: string;
  playerName: string;
  killCount: number;
  headshotKillCount: number;
  shotCount: number;
  hitCount: number;
  rounds: PlayerRoundAim[];
};

export type AimOutlierSuspicionScore = {
  playerSteamId: string;
  playerName: string;
  killCount: number;
  shotCount: number;
  // Match-wide overall metrics for this player.
  headshotRate: number;
  accuracy: number;
  // Match median across qualifying players (same value for every player in the match); 0 when there
  // was no trustworthy baseline for that metric.
  baselineHeadshotRate: number;
  baselineAccuracy: number;
  isHeadshotOutlier: boolean;
  isAccuracyOutlier: boolean;
  // Representative moment (a kill/shot tick in the player's best qualifying round) for the viewer
  // jump. Null when the player is not flagged or has no qualifying round.
  tick: number | null;
  roundNumber: number | null;
  // One moment per notably-high round (only populated for flagged players). Empty otherwise.
  moments: DetectionMoment[];
  isFlagged: boolean;
};

// Median matching PostgreSQL percentile_cont(0.5): the average of the two middle values on an even
// count. Assumes a non-empty, caller-provided list.
function median(values: number[]): number {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }

  return sorted[middle];
}

// Pure scoring function extracted from the DB query so the aim-outlier heuristic can be unit tested
// without a live database connection.
//
// Baseline-relative logic (like first-contact detectors): a player is flagged when their OVERALL aim
// quality is a strong statistical outlier versus the OTHER players in the SAME match, never against a
// fixed absolute threshold. The baseline is the median across qualifying players (>= MIN_KILLS for
// headshot rate, >= MIN_SHOTS for accuracy); a player trips when their headshot rate reaches
// baseline + HS_MARGIN OR their accuracy reaches baseline + ACC_MARGIN. This self-adjusts to the
// lobby skill, so an elite legit player CAN be a genuine outlier: the flag is triage, not proof.
export function computeAimOutlierSuspicions(players: PlayerAimStats[]): AimOutlierSuspicionScore[] {
  const headshotSamples = players
    .filter((player) => player.killCount >= MIN_KILLS)
    .map((player) => {
      return player.headshotKillCount / player.killCount;
    });
  const accuracySamples = players
    .filter((player) => player.shotCount >= MIN_SHOTS)
    .map((player) => {
      return player.hitCount / player.shotCount;
    });

  const baselineHeadshotRate = headshotSamples.length >= MIN_BASELINE_PLAYERS ? median(headshotSamples) : null;
  const baselineAccuracy = accuracySamples.length >= MIN_BASELINE_PLAYERS ? median(accuracySamples) : null;

  return players.map((player) => {
    const headshotRate = player.killCount > 0 ? player.headshotKillCount / player.killCount : 0;
    const accuracy = player.shotCount > 0 ? player.hitCount / player.shotCount : 0;

    const isHeadshotOutlier =
      player.killCount >= MIN_KILLS &&
      baselineHeadshotRate !== null &&
      headshotRate >= baselineHeadshotRate + HS_MARGIN;
    const isAccuracyOutlier =
      player.shotCount >= MIN_SHOTS && baselineAccuracy !== null && accuracy >= baselineAccuracy + ACC_MARGIN;
    const isFlagged = isHeadshotOutlier || isAccuracyOutlier;

    let tick: number | null = null;
    let roundNumber: number | null = null;
    let moments: DetectionMoment[] = [];

    if (isFlagged) {
      // Representative jump target: the best round of whichever metric tripped (headshot first).
      if (isHeadshotOutlier) {
        const bestHeadshotRound = player.rounds
          .filter((round) => round.killCount >= MIN_ROUND_KILLS && round.headshotTick !== null)
          .reduce<PlayerRoundAim | null>((best, round) => {
            const rate = round.headshotKillCount / round.killCount;
            return best === null || rate > best.headshotKillCount / best.killCount ? round : best;
          }, null);
        if (bestHeadshotRound !== null) {
          tick = bestHeadshotRound.headshotTick;
          roundNumber = bestHeadshotRound.roundNumber;
        }
      }
      if (tick === null && isAccuracyOutlier) {
        const bestAccuracyRound = player.rounds
          .filter((round) => round.shotCount >= MIN_ROUND_SHOTS && round.shotTick !== null)
          .reduce<PlayerRoundAim | null>((best, round) => {
            const rate = round.hitCount / round.shotCount;
            return best === null || rate > best.hitCount / best.shotCount ? round : best;
          }, null);
        if (bestAccuracyRound !== null) {
          tick = bestAccuracyRound.shotTick;
          roundNumber = bestAccuracyRound.roundNumber;
        }
      }

      const headshotMoments: DetectionMoment[] = player.rounds
        .filter((round) => {
          return (
            round.killCount >= MIN_ROUND_KILLS &&
            round.headshotTick !== null &&
            round.headshotKillCount / round.killCount >= HOT_ROUND_HEADSHOT_RATE
          );
        })
        .map((round) => {
          const percentage = Math.round((round.headshotKillCount / round.killCount) * 100);
          return {
            tick: round.headshotTick as number,
            roundNumber: round.roundNumber,
            label: `Round ${round.roundNumber} · ${percentage}% HS (${round.killCount} kills)`,
          };
        });

      const accuracyMoments: DetectionMoment[] = player.rounds
        .filter((round) => {
          return (
            round.shotCount >= MIN_ROUND_SHOTS &&
            round.shotTick !== null &&
            round.hitCount / round.shotCount >= HOT_ROUND_ACCURACY
          );
        })
        .map((round) => {
          const percentage = Math.round((round.hitCount / round.shotCount) * 100);
          return {
            tick: round.shotTick as number,
            roundNumber: round.roundNumber,
            label: `Round ${round.roundNumber} · ${percentage}% accuracy (${round.hitCount}/${round.shotCount})`,
          };
        });

      moments = [...headshotMoments, ...accuracyMoments]
        .toSorted((a, b) => a.roundNumber - b.roundNumber)
        .slice(0, MAX_DETECTION_MOMENTS);
    }

    return {
      playerSteamId: player.playerSteamId,
      playerName: player.playerName,
      killCount: player.killCount,
      shotCount: player.shotCount,
      headshotRate,
      accuracy,
      baselineHeadshotRate: baselineHeadshotRate ?? 0,
      baselineAccuracy: baselineAccuracy ?? 0,
      isHeadshotOutlier,
      isAccuracyOutlier,
      tick,
      roundNumber,
      moments,
      isFlagged,
    };
  });
}
