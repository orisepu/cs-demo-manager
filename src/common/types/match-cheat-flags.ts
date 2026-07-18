// Per-player aggregate of the cheat detectors that flagged a player for a given match.
// `flaggedBy` holds the human-readable names of the detectors that flagged the player
// (e.g. "Anti-aim", "Spinbot"). Only players flagged by at least one detector are returned.
export type PlayerCheatFlags = {
  steamId: string;
  flaggedBy: string[];
};
