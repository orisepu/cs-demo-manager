import type { DetectionMoment } from './detection-moment';

export type AimOutlierSuspicion = {
  playerSteamId: string;
  playerName: string;
  // Real-round, non-bot kills and shots used as the sample sizes behind the two metrics.
  killCount: number;
  shotCount: number;
  // Overall match-wide headshot rate (headshot kills / kills) and accuracy (landing shots / shots)
  // for this player.
  headshotRate: number;
  accuracy: number;
  // Match median across qualifying players for each metric (identical for every player in the match),
  // shown so the UI can display the contrast that defines the outlier. 0 when there was no baseline.
  baselineHeadshotRate: number;
  baselineAccuracy: number;
  // Which metric(s) made the player an outlier. A player can trip on either or both.
  isHeadshotOutlier: boolean;
  isAccuracyOutlier: boolean;
  // Representative moment = a kill/shot tick in the player's best qualifying round, so the UI can jump
  // the 2D viewer straight to it. Null when the player is not flagged or has no qualifying round.
  tick: number | null;
  roundNumber: number | null;
  // One moment per notably-high round (only populated for flagged players). Empty otherwise.
  moments: DetectionMoment[];
  isFlagged: boolean;
};
