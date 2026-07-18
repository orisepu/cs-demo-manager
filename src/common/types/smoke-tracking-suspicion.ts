export type SmokeTrackingSuspicion = {
  playerSteamId: string;
  playerName: string;
  // Number of qualifying "smoke-tracking" windows detected for this player across the whole match.
  windowCount: number;
  // Representative moment (start tick of the player's longest window) so the UI can jump the 2D
  // viewer straight to the most incriminating moment. Both are 0 when the player has no window.
  representativeTick: number;
  roundNumber: number;
  isFlagged: boolean;
};
