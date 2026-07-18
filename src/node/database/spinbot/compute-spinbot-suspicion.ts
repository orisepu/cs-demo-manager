// Number of consecutive, alive, in-round ticks averaged together when measuring how
// sustained a player's per-tick yaw (horizontal view angle) angular velocity is.
// A spinbot keeps spinning for many ticks in a row, so averaging over a short rolling
// window separates a sustained spin from a one-off flick (which a legit player performs
// when snapping their aim to an enemy).
export const SPINBOT_ROLLING_WINDOW_TICKS = 14;

// Rolling-mean per-tick yaw angular velocity, in degrees/tick, at/above which a player is
// flagged as a suspected spinbot. A human never sustains anything close to this over a full
// window; a spinbot sits far above it. Validated against real demos: clean players peaked in
// the single digits / low tens while nothing legit reaches this threshold.
const SPINBOT_SUSPICIOUS_YAW_DELTA_DEGREES = 45;

export type SpinbotSuspicionScore = {
  maxRollingMeanYawDelta: number;
  isFlagged: boolean;
};

// Pure scoring function extracted from the DB query so the spinbot heuristic can be
// unit tested without a live database connection.
export function computeSpinbotSuspicion(aliveTickCount: number, maxRollingMeanYawDelta: number): SpinbotSuspicionScore {
  if (aliveTickCount <= 0) {
    return {
      maxRollingMeanYawDelta: 0,
      isFlagged: false,
    };
  }

  return {
    maxRollingMeanYawDelta,
    isFlagged: maxRollingMeanYawDelta >= SPINBOT_SUSPICIOUS_YAW_DELTA_DEGREES,
  };
}
