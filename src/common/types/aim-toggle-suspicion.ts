import type { DetectionMoment } from './detection-moment';

export type AimToggleSuspicion = {
  playerSteamId: string;
  playerName: string;
  // Total real-round, non-bot kills used to compute the baseline headshot rate.
  killCount: number;
  // Headshot kills / total kills over the whole match. A mediocre/normal baseline is what makes an
  // isolated near-perfect round look like a toggle rather than consistent skill.
  baselineHeadshotRate: number;
  // The hottest qualifying round (>= MIN_ROUND_KILLS kills) and its headshot rate. Together with the
  // baseline they let the UI show the contrast that defines the toggle. Null/0 when the player has no
  // qualifying round.
  hotRoundNumber: number | null;
  hotRoundHeadshotRate: number;
  // Overall match accuracy (landing shots / shots) and the hottest qualifying accuracy round, the
  // second independent trigger that catches a body-aimbot toggle. Null/0 when the player has no
  // qualifying accuracy round.
  baselineAccuracy: number;
  hotAccuracyRoundNumber: number | null;
  hotRoundAccuracy: number;
  // Representative moment = a headshot kill in the hottest qualifying round (or the first shot of the
  // hot accuracy round when the flag is accuracy-only), so the UI can jump the 2D viewer straight to
  // it. Null when there is no qualifying round.
  tick: number | null;
  // Mirrors the other detectors' viewer-jump contract; equals hotRoundNumber (the round to open).
  roundNumber: number | null;
  // One moment per qualifying "hot" round (only populated for flagged players). Empty otherwise.
  moments: DetectionMoment[];
  isFlagged: boolean;
};
