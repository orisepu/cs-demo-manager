import type { SmokeTrackingSuspicion } from 'csdm/common/types/smoke-tracking-suspicion';
import { MAX_DETECTION_MOMENTS, type DetectionMoment } from 'csdm/common/types/detection-moment';

// Fallback tickrate used to convert a window duration in ticks into seconds for its label when the
// real match tickrate is not provided (e.g. unit tests). Every supported CS2/CS:GO demo is 64 tick.
export const DEFAULT_TICKRATE = 64;

// ---------------------------------------------------------------------------
// Constants (all validated against the sibling Python project on real demos)
// ---------------------------------------------------------------------------

// A smoke cloud is modelled as a sphere. A segment tracker_eye -> enemy_eye that passes within this
// many units of the sphere center is treated as "the enemy is smoke-occluded from the tracker".
export const SMOKE_RADIUS = 150;

// Ticks a smoke is assumed to stay active from its `smokes_start` tick (~18s at 64 tick).
export const ASSUMED_SMOKE_DURATION_TICKS = 1152;

// The smoke sphere center sits above the recorded ground position (x, y, z) by this many units.
export const SMOKE_Z_OFFSET = 60;

// Eye height added to a player's origin z, depending on stance.
export const EYE_OFFSET_STANDING = 64;
export const EYE_OFFSET_CROUCHED = 46;

// Maximum angle (degrees) between the tracker's 3D aim vector and the direction tracker_eye ->
// enemy_eye for the tracker to be considered "aiming at" the (invisible) enemy.
export const AIM_ERROR_MAX_DEGREES = 5;

// Positions are sampled every game tick; we only evaluate one sample every N ticks.
export const TICK_SUBSAMPLE = 8;

// Ticks around every kill (both sides) excluded as "combat" (~2s at 64 tick each side).
export const COMBAT_EXCLUSION_TICKS = 128;

// A window is a run of consecutive qualifying subsamples. To count it must satisfy ALL of:
export const MIN_WINDOW_DURATION_TICKS = 16; // window must span at least this many ticks
export const MIN_ENEMY_MOVE_XY = 40; // enemy net XY displacement over the window
export const MIN_BEARING_CHANGE_DEGREES = 8; // change of tracker->enemy bearing over the window
export const MAX_TRACKER_PATH_XY = 60; // cumulative XY path of the tracker over the window (stillness)

// Players with at least this many qualifying windows are flagged.
export const MIN_WINDOWS_TO_FLAG = 2;

// Team side numbers exported by the analyzer (see TeamNumber): T = 2, CT = 3.
const SIDE_T = 2;
const SIDE_CT = 3;

// ---------------------------------------------------------------------------
// Input shapes (kept DB-free so the whole heuristic is unit testable)
// ---------------------------------------------------------------------------

export type PositionSample = {
  tick: number;
  roundNumber: number;
  steamId: string;
  name: string;
  side: number;
  isAlive: boolean;
  isDucking: boolean;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
};

export type SmokeEvent = {
  roundNumber: number;
  tick: number;
  x: number;
  y: number;
  z: number;
};

type Vec3 = { x: number; y: number; z: number };

// ---------------------------------------------------------------------------
// Pure geometry helpers
// ---------------------------------------------------------------------------

export function eyePosition(sample: Pick<PositionSample, 'x' | 'y' | 'z' | 'isDucking'>): Vec3 {
  return {
    x: sample.x,
    y: sample.y,
    z: sample.z + (sample.isDucking ? EYE_OFFSET_CROUCHED : EYE_OFFSET_STANDING),
  };
}

// Shortest distance from point `p` to the 3D segment [a, b].
export function distancePointToSegment(p: Vec3, a: Vec3, b: Vec3): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const apz = p.z - a.z;
  const abLengthSquared = abx * abx + aby * aby + abz * abz;

  let t = 0;
  if (abLengthSquared > 0) {
    t = (apx * abx + apy * aby + apz * abz) / abLengthSquared;
    t = Math.max(0, Math.min(1, t));
  }

  const closestX = a.x + abx * t;
  const closestY = a.y + aby * t;
  const closestZ = a.z + abz * t;
  const dx = p.x - closestX;
  const dy = p.y - closestY;
  const dz = p.z - closestZ;

  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// True when the segment trackerEye -> enemyEye grazes at least one active smoke sphere.
export function isSmokeOccluded(trackerEye: Vec3, enemyEye: Vec3, activeSmokeCenters: Vec3[]): boolean {
  for (const center of activeSmokeCenters) {
    if (distancePointToSegment(center, trackerEye, enemyEye) <= SMOKE_RADIUS) {
      return true;
    }
  }

  return false;
}

// 3D unit aim vector from Source engine view angles (degrees). Positive pitch looks down.
export function aimVectorFromAngles(yawDegrees: number, pitchDegrees: number): Vec3 {
  const yaw = (yawDegrees * Math.PI) / 180;
  const pitch = (pitchDegrees * Math.PI) / 180;
  const cosPitch = Math.cos(pitch);

  return {
    x: cosPitch * Math.cos(yaw),
    y: cosPitch * Math.sin(yaw),
    z: -Math.sin(pitch),
  };
}

// Angle (degrees) between two vectors. Inputs need not be normalized.
export function angleBetweenDegrees(a: Vec3, b: Vec3): number {
  const dot = a.x * b.x + a.y * b.y + a.z * b.z;
  const magA = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
  const magB = Math.sqrt(b.x * b.x + b.y * b.y + b.z * b.z);
  if (magA === 0 || magB === 0) {
    return 180;
  }

  const cosine = Math.max(-1, Math.min(1, dot / (magA * magB)));

  return (Math.acos(cosine) * 180) / Math.PI;
}

// Horizontal (XY) bearing in degrees of the vector from -> to.
export function bearingDegrees(from: Vec3, to: Vec3): number {
  return (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
}

// Smallest absolute difference between two bearings, in [0, 180].
export function bearingDeltaDegrees(a: number, b: number): number {
  let delta = Math.abs(a - b) % 360;
  if (delta > 180) {
    delta = 360 - delta;
  }

  return delta;
}

function distanceXY(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;

  return Math.sqrt(dx * dx + dy * dy);
}

// ---------------------------------------------------------------------------
// Windowing
// ---------------------------------------------------------------------------

// A single qualifying subsample: the enemy was smoke-occluded and the tracker was aiming at it.
export type QualifyingSample = {
  tick: number;
  trackerEye: Vec3;
  enemyEye: Vec3;
};

export type TrackingWindow = {
  roundNumber: number;
  startTick: number;
  endTick: number;
  durationTicks: number;
  // Steam id of the enemy that was tracked through the smoke during this window. Empty when unknown
  // (only in unit tests that call evaluateWindow directly without passing it).
  enemySteamId: string;
};

// Validate a run of consecutive qualifying subsamples against the window rules. Returns the window
// when it qualifies, otherwise null.
export function evaluateWindow(roundNumber: number, run: QualifyingSample[], enemySteamId = ''): TrackingWindow | null {
  if (run.length < 2) {
    return null;
  }

  const first = run[0];
  const last = run.at(-1)!;
  const durationTicks = last.tick - first.tick;
  if (durationTicks < MIN_WINDOW_DURATION_TICKS) {
    return null;
  }

  // Enemy must have relocated (net XY displacement).
  const enemyMove = distanceXY(first.enemyEye, last.enemyEye);
  if (enemyMove < MIN_ENEMY_MOVE_XY) {
    return null;
  }

  // The tracker->enemy bearing must have swung, proving the tracker followed a moving target rather
  // than holding a fixed pre-aimed angle.
  const startBearing = bearingDegrees(first.trackerEye, first.enemyEye);
  const endBearing = bearingDegrees(last.trackerEye, last.enemyEye);
  if (bearingDeltaDegrees(startBearing, endBearing) < MIN_BEARING_CHANGE_DEGREES) {
    return null;
  }

  // The tracker must have stayed nearly still (small cumulative XY path).
  let trackerPath = 0;
  for (let i = 1; i < run.length; i++) {
    trackerPath += distanceXY(run[i - 1].trackerEye, run[i].trackerEye);
  }
  if (trackerPath >= MAX_TRACKER_PATH_XY) {
    return null;
  }

  return {
    roundNumber,
    startTick: first.tick,
    endTick: last.tick,
    durationTicks,
    enemySteamId,
  };
}

// ---------------------------------------------------------------------------
// Combat exclusion
// ---------------------------------------------------------------------------

// Returns a predicate telling whether a tick falls inside the +/- COMBAT_EXCLUSION_TICKS window of
// any kill. Kill ticks are sorted once and probed with a binary search.
export function createCombatExclusion(killTicks: number[]): (tick: number) => boolean {
  const sorted = killTicks.toSorted((a, b) => a - b);

  return (tick: number): boolean => {
    let low = 0;
    let high = sorted.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const killTick = sorted[mid];
      if (Math.abs(killTick - tick) <= COMBAT_EXCLUSION_TICKS) {
        return true;
      }
      if (killTick < tick) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    return false;
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

type PlayerAccumulator = {
  steamId: string;
  name: string;
  windows: TrackingWindow[];
};

function activeSmokeCentersAtTick(smokes: SmokeEvent[], roundNumber: number, tick: number): Vec3[] {
  const centers: Vec3[] = [];
  for (const smoke of smokes) {
    if (smoke.roundNumber === roundNumber && tick >= smoke.tick && tick < smoke.tick + ASSUMED_SMOKE_DURATION_TICKS) {
      centers.push({ x: smoke.x, y: smoke.y, z: smoke.z + SMOKE_Z_OFFSET });
    }
  }

  return centers;
}

function isPlayingSide(side: number): boolean {
  return side === SIDE_T || side === SIDE_CT;
}

/**
 * Detect smoke-tracking wallhack windows for every player of a single match.
 *
 * A window is a stretch of gameplay (outside combat) where a nearly-static tracker keeps its aim
 * locked on a moving enemy that is hidden behind a smoke — something impossible without seeing
 * through the smoke. Players with MIN_WINDOWS_TO_FLAG or more such windows are flagged.
 *
 * `positions` MUST already be filtered to alive, real-round (round_number >= 1) samples. The
 * function groups them per round and per subsampled tick, evaluates every opposite-team
 * (tracker, enemy) pair, groups consecutive qualifying subsamples into windows, and aggregates.
 */
export function computeSmokeTrackingSuspicions(
  positions: PositionSample[],
  smokes: SmokeEvent[],
  killTicks: number[],
  tickrate: number = DEFAULT_TICKRATE,
): SmokeTrackingSuspicion[] {
  const isCombatTick = createCombatExclusion(killTicks);

  // Group positions per round, then per subsampled tick -> list of player samples.
  // Map<roundNumber, Map<tick, PositionSample[]>>
  const rounds = new Map<number, Map<number, PositionSample[]>>();
  // Track every player seen so clean players still appear (with a 0 count) in the results.
  const players = new Map<string, PlayerAccumulator>();

  for (const sample of positions) {
    if (!players.has(sample.steamId)) {
      players.set(sample.steamId, { steamId: sample.steamId, name: sample.name, windows: [] });
    } else {
      // Keep the latest non-empty name.
      const accumulator = players.get(sample.steamId);
      if (accumulator !== undefined && sample.name !== '') {
        accumulator.name = sample.name;
      }
    }

    if (sample.tick % TICK_SUBSAMPLE !== 0) {
      continue;
    }
    if (isCombatTick(sample.tick)) {
      continue;
    }

    let ticks = rounds.get(sample.roundNumber);
    if (ticks === undefined) {
      ticks = new Map<number, PositionSample[]>();
      rounds.set(sample.roundNumber, ticks);
    }
    let samplesAtTick = ticks.get(sample.tick);
    if (samplesAtTick === undefined) {
      samplesAtTick = [];
      ticks.set(sample.tick, samplesAtTick);
    }
    samplesAtTick.push(sample);
  }

  for (const [roundNumber, ticks] of rounds) {
    const sortedTicks = [...ticks.keys()].toSorted((a, b) => a - b);

    // Per (tracker, enemy) pair, the currently open run of consecutive qualifying subsamples.
    // Key: `${trackerSteamId}|${enemySteamId}`.
    const openRuns = new Map<string, { previousTick: number; run: QualifyingSample[] }>();

    const flushRun = (key: string, trackerSteamId: string) => {
      const open = openRuns.get(key);
      if (open === undefined) {
        return;
      }
      const enemySteamId = key.slice(key.indexOf('|') + 1);
      const window = evaluateWindow(roundNumber, open.run, enemySteamId);
      if (window !== null) {
        players.get(trackerSteamId)?.windows.push(window);
      }
      openRuns.delete(key);
    };

    for (const tick of sortedTicks) {
      const samplesAtTick = ticks.get(tick);
      if (samplesAtTick === undefined) {
        continue;
      }
      const smokeCenters = activeSmokeCentersAtTick(smokes, roundNumber, tick);
      const qualifiedKeys = new Set<string>();

      if (smokeCenters.length > 0) {
        for (const tracker of samplesAtTick) {
          if (!tracker.isAlive || !isPlayingSide(tracker.side)) {
            continue;
          }
          const trackerEye = eyePosition(tracker);
          const aimVector = aimVectorFromAngles(tracker.yaw, tracker.pitch);

          for (const enemy of samplesAtTick) {
            if (enemy === tracker || !enemy.isAlive || !isPlayingSide(enemy.side)) {
              continue;
            }
            if (enemy.side === tracker.side) {
              continue;
            }

            const enemyEye = eyePosition(enemy);
            if (!isSmokeOccluded(trackerEye, enemyEye, smokeCenters)) {
              continue;
            }

            const directionToEnemy: Vec3 = {
              x: enemyEye.x - trackerEye.x,
              y: enemyEye.y - trackerEye.y,
              z: enemyEye.z - trackerEye.z,
            };
            if (angleBetweenDegrees(aimVector, directionToEnemy) > AIM_ERROR_MAX_DEGREES) {
              continue;
            }

            const key = `${tracker.steamId}|${enemy.steamId}`;
            qualifiedKeys.add(key);
            const open = openRuns.get(key);
            const qualifyingSample: QualifyingSample = { tick, trackerEye, enemyEye };
            if (open !== undefined && open.previousTick === tick - TICK_SUBSAMPLE) {
              open.run.push(qualifyingSample);
              open.previousTick = tick;
            } else {
              // A gap (or first ever) breaks the previous run before starting a fresh one.
              flushRun(key, tracker.steamId);
              openRuns.set(key, { previousTick: tick, run: [qualifyingSample] });
            }
          }
        }
      }

      // Any run that did not get extended at this tick is finished.
      for (const key of openRuns.keys()) {
        if (!qualifiedKeys.has(key)) {
          const trackerSteamId = key.slice(0, key.indexOf('|'));
          flushRun(key, trackerSteamId);
        }
      }
    }

    // Flush whatever remained open at the end of the round.
    for (const key of openRuns.keys()) {
      const trackerSteamId = key.slice(0, key.indexOf('|'));
      flushRun(key, trackerSteamId);
    }
  }

  const effectiveTickrate = tickrate > 0 ? tickrate : DEFAULT_TICKRATE;
  const suspicions: SmokeTrackingSuspicion[] = [];
  for (const accumulator of players.values()) {
    let representativeTick = 0;
    let roundNumber = 0;
    let longestDuration = -1;
    for (const window of accumulator.windows) {
      if (window.durationTicks > longestDuration) {
        longestDuration = window.durationTicks;
        representativeTick = window.startTick;
        roundNumber = window.roundNumber;
      }
    }

    const isFlagged = accumulator.windows.length >= MIN_WINDOWS_TO_FLAG;
    // One moment per qualifying window, ordered chronologically, only for flagged players. The label
    // names the tracked enemy and the window length in seconds, e.g. "Round 3 · tracked s0ad113 · 1.0s".
    let moments: DetectionMoment[] = [];
    if (isFlagged) {
      moments = accumulator.windows
        .toSorted((a, b) => a.roundNumber - b.roundNumber || a.startTick - b.startTick)
        .map((window) => {
          const enemyName = players.get(window.enemySteamId)?.name || window.enemySteamId;
          const seconds = (window.durationTicks / effectiveTickrate).toFixed(1);

          return {
            tick: window.startTick,
            roundNumber: window.roundNumber,
            label: `Round ${window.roundNumber} · tracked ${enemyName} · ${seconds}s`,
          };
        })
        .slice(0, MAX_DETECTION_MOMENTS);
    }

    suspicions.push({
      playerSteamId: accumulator.steamId,
      playerName: accumulator.name,
      windowCount: accumulator.windows.length,
      representativeTick,
      roundNumber,
      moments,
      isFlagged,
    });
  }

  suspicions.sort((a, b) => {
    if (b.windowCount !== a.windowCount) {
      return b.windowCount - a.windowCount;
    }

    return a.playerSteamId.localeCompare(b.playerSteamId);
  });

  return suspicions;
}
