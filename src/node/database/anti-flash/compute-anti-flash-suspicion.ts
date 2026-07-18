// Remaining flash blindness, in seconds, that a killer must still have at the exact kill tick for
// that kill to count as a "flashed kill". flash_duration_remaining counts DOWN from the moment a
// flashbang detonates, so a high value means the attacker's screen is still heavily whited-out.
// Below this threshold the screen has mostly cleared and a skilled player can spray a known
// position (a lucky blind spray), which is not a cheat. Above it a legit human simply cannot see
// the enemy, so consistently landing kills there is the anti-flash signature. Validated against
// real demos: with this threshold no clean player and neither known suspect reaches the flag
// count, while the few blind-spray flukes each sit at exactly one such kill.
export const FLASH_DURATION_REMAINING_THRESHOLD_SECONDS = 1.9;

// Number of flashed kills (as defined above) at/above which a player is flagged as a suspected
// anti-flash cheater. A single flashed kill is an expected lucky spray; needing two guards against
// false positives while still catching a cheat that repeatedly kills through heavy blindness.
export const MIN_FLASHED_KILL_COUNT = 2;

export type AntiFlashSuspicionScore = {
  flashedKillCount: number;
  isFlagged: boolean;
};

// Pure scoring function extracted from the DB query so the anti-flash heuristic can be unit tested
// without a live database connection.
export function computeAntiFlashSuspicion(killCount: number, flashedKillCount: number): AntiFlashSuspicionScore {
  if (killCount <= 0) {
    return {
      flashedKillCount: 0,
      isFlagged: false,
    };
  }

  return {
    flashedKillCount,
    isFlagged: flashedKillCount >= MIN_FLASHED_KILL_COUNT,
  };
}
