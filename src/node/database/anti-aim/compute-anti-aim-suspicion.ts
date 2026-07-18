// Absolute pitch (vertical view angle), in degrees, above which a player is considered
// to be looking almost straight up/down. Legit players almost never hold this angle
// while alive since it makes it impossible to see or fight opponents.
export const SUSPICIOUS_PITCH_ABSOLUTE_DEGREES = 85;

// Fraction of alive, in-round ticks spent with |pitch| above SUSPICIOUS_PITCH_ABSOLUTE_DEGREES
// at/above which a player is flagged as a suspected anti-aim cheater.
// Validated against real demos: a confirmed cheater sat around 0.6% while clean players
// were in the 0.0-0.04% range.
const ANTI_AIM_SUSPICIOUS_FRACTION_THRESHOLD = 0.0035;

export type AntiAimSuspicionScore = {
  suspiciousFraction: number;
  isFlagged: boolean;
};

// Pure scoring function extracted from the DB query so the anti-aim heuristic can be
// unit tested without a live database connection.
export function computeAntiAimSuspicion(aliveTickCount: number, suspiciousTickCount: number): AntiAimSuspicionScore {
  const suspiciousFraction = aliveTickCount > 0 ? suspiciousTickCount / aliveTickCount : 0;

  return {
    suspiciousFraction,
    isFlagged: suspiciousFraction >= ANTI_AIM_SUSPICIOUS_FRACTION_THRESHOLD,
  };
}
