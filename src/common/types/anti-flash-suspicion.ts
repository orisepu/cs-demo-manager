export type AntiFlashSuspicion = {
  playerSteamId: string;
  playerName: string;
  killCount: number;
  flashedKillCount: number;
  maxFlashDurationAtKill: number;
  // Representative moment (the most-flashed kill) so the UI can later jump the 2D viewer there.
  tick: number;
  roundNumber: number;
  isFlagged: boolean;
};
