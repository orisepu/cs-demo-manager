import type { DetectionMoment } from './detection-moment';

export type SpinbotSuspicion = {
  playerSteamId: string;
  playerName: string;
  aliveTickCount: number;
  maxRollingMeanYawDelta: number;
  // Representative moment (the tick where the rolling-mean yaw velocity peaks, i.e. the center of
  // the most sustained spin) so the UI can jump the 2D viewer there. Null when no live-play delta
  // could be measured for the player.
  tick: number | null;
  roundNumber: number | null;
  // One moment per round whose peak rolling-mean yaw crossed the flag threshold (only populated for
  // flagged players). Empty otherwise.
  moments: DetectionMoment[];
  isFlagged: boolean;
};
