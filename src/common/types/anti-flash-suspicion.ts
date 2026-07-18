import type { DetectionMoment } from './detection-moment';

export type AntiFlashSuspicion = {
  playerSteamId: string;
  playerName: string;
  killCount: number;
  flashedKillCount: number;
  maxFlashDurationAtKill: number;
  // Representative moment (the most-flashed kill) so the UI can later jump the 2D viewer there.
  tick: number;
  roundNumber: number;
  // One moment per flashed kill (only populated for flagged players). Empty otherwise.
  moments: DetectionMoment[];
  isFlagged: boolean;
};
