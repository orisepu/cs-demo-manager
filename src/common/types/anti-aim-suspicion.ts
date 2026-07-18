export type AntiAimSuspicion = {
  playerSteamId: string;
  playerName: string;
  aliveTickCount: number;
  suspiciousTickCount: number;
  suspiciousFraction: number;
  // Representative moment (a tick where the player's pitch was the most extreme) so the UI can
  // jump the 2D viewer there. Null when the player has no suspicious tick at all.
  tick: number | null;
  roundNumber: number | null;
  isFlagged: boolean;
};
