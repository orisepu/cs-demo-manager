export type AntiAimSuspicion = {
  playerSteamId: string;
  playerName: string;
  aliveTickCount: number;
  suspiciousTickCount: number;
  suspiciousFraction: number;
  isFlagged: boolean;
};
