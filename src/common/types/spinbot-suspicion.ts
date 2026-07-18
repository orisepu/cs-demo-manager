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
  isFlagged: boolean;
};
