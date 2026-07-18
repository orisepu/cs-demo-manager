import { describe, it, expect } from 'vite-plus/test';
import {
  aimVectorFromAngles,
  angleBetweenDegrees,
  bearingDeltaDegrees,
  computeSmokeTrackingSuspicions,
  createCombatExclusion,
  distancePointToSegment,
  evaluateWindow,
  eyePosition,
  isSmokeOccluded,
  EYE_OFFSET_CROUCHED,
  EYE_OFFSET_STANDING,
  SMOKE_RADIUS,
  SMOKE_Z_OFFSET,
  type PositionSample,
  type QualifyingSample,
  type SmokeEvent,
} from './compute-smoke-tracking-suspicions';

// Team side numbers (see TeamNumber): T = 2, CT = 3.
const SIDE_T = 2;
const SIDE_CT = 3;

// A smoke on the ground at (1000, 0). Its sphere center is lifted by SMOKE_Z_OFFSET.
const SMOKE_GROUND = { x: 1000, y: 0, z: 0 };

function degrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

// Build a tracker sample at (x, y) that aims straight at the given enemy ground position. Both
// players stand (eye height EYE_OFFSET_STANDING) so the aim is purely horizontal (pitch 0).
function buildTracker(
  tick: number,
  roundNumber: number,
  x: number,
  y: number,
  enemyX: number,
  enemyY: number,
): PositionSample {
  const yaw = degrees(Math.atan2(enemyY - y, enemyX - x));

  return {
    tick,
    roundNumber,
    steamId: 'tracker',
    name: 'Tracker',
    side: SIDE_T,
    isAlive: true,
    isDucking: false,
    x,
    y,
    z: 0,
    yaw,
    pitch: 0,
  };
}

function buildEnemy(tick: number, roundNumber: number, x: number, y: number): PositionSample {
  return {
    tick,
    roundNumber,
    steamId: 'enemy',
    name: 'Enemy',
    side: SIDE_CT,
    isAlive: true,
    isDucking: false,
    x,
    y,
    z: 0,
    yaw: 90, // Looking away from the tracker so the reverse pair never qualifies.
    pitch: 0,
  };
}

const SMOKE: SmokeEvent = { roundNumber: 1, tick: 0, x: SMOKE_GROUND.x, y: SMOKE_GROUND.y, z: SMOKE_GROUND.z };

// A static tracker at the origin following an enemy that walks across the far side of the smoke.
// Enemy ground positions chosen so the tracker->enemy segment always grazes the smoke, the enemy
// clearly moves, and the bearing swings past the 8 degree threshold.
function buildTrackingRound(roundNumber: number, ticks: number[]): PositionSample[] {
  const enemyYByIndex = [-120, 0, 120];
  const samples: PositionSample[] = [];
  ticks.forEach((tick, index) => {
    const enemyX = 1500;
    const enemyY = enemyYByIndex[index];
    samples.push(buildTracker(tick, roundNumber, 0, 0, enemyX, enemyY));
    samples.push(buildEnemy(tick, roundNumber, enemyX, enemyY));
  });

  return samples;
}

describe('smoke-tracking geometry helpers', () => {
  it('eyePosition uses the standing offset when not ducking', () => {
    const eye = eyePosition({ x: 10, y: 20, z: 30, isDucking: false });
    expect(eye).toEqual({ x: 10, y: 20, z: 30 + EYE_OFFSET_STANDING });
  });

  it('eyePosition uses the crouched offset when ducking', () => {
    const eye = eyePosition({ x: 10, y: 20, z: 30, isDucking: true });
    expect(eye).toEqual({ x: 10, y: 20, z: 30 + EYE_OFFSET_CROUCHED });
  });

  it('distancePointToSegment returns the perpendicular distance for an interior projection', () => {
    const distance = distancePointToSegment({ x: 5, y: 10, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 });
    expect(distance).toBeCloseTo(10);
  });

  it('distancePointToSegment clamps to the nearest endpoint when the projection falls outside', () => {
    const distance = distancePointToSegment({ x: 20, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 });
    expect(distance).toBeCloseTo(10);
  });

  it('isSmokeOccluded is true when the segment grazes the smoke sphere', () => {
    const trackerEye = eyePosition({ x: 0, y: 0, z: 0, isDucking: false });
    const enemyEye = eyePosition({ x: 1500, y: 0, z: 0, isDucking: false });
    const smokeCenter = { x: 1000, y: 0, z: SMOKE_GROUND.z + SMOKE_Z_OFFSET };
    expect(isSmokeOccluded(trackerEye, enemyEye, [smokeCenter])).toBe(true);
  });

  it('isSmokeOccluded is false when the segment is far from every smoke', () => {
    const trackerEye = eyePosition({ x: 0, y: 0, z: 0, isDucking: false });
    const enemyEye = eyePosition({ x: 1500, y: 0, z: 0, isDucking: false });
    // Smoke offset well beyond SMOKE_RADIUS from the straight segment.
    const smokeCenter = { x: 1000, y: SMOKE_RADIUS + 200, z: SMOKE_GROUND.z + SMOKE_Z_OFFSET };
    expect(isSmokeOccluded(trackerEye, enemyEye, [smokeCenter])).toBe(false);
  });

  it('aimVectorFromAngles points along +X for yaw 0 pitch 0', () => {
    const vector = aimVectorFromAngles(0, 0);
    expect(vector.x).toBeCloseTo(1);
    expect(vector.y).toBeCloseTo(0);
    expect(vector.z).toBeCloseTo(0);
  });

  it('aimVectorFromAngles points up for a negative pitch', () => {
    const vector = aimVectorFromAngles(0, -90);
    expect(vector.z).toBeCloseTo(1);
  });

  it('angleBetweenDegrees returns 90 for orthogonal vectors', () => {
    const angle = angleBetweenDegrees({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    expect(angle).toBeCloseTo(90);
  });

  it('bearingDeltaDegrees returns the smallest wrap-around difference', () => {
    expect(bearingDeltaDegrees(350, 10)).toBeCloseTo(20);
    expect(bearingDeltaDegrees(10, 350)).toBeCloseTo(20);
  });

  it('createCombatExclusion flags ticks within the exclusion window of a kill', () => {
    const isCombat = createCombatExclusion([1000]);
    expect(isCombat(1000)).toBe(true);
    expect(isCombat(1100)).toBe(true);
    expect(isCombat(2000)).toBe(false);
  });
});

describe('evaluateWindow', () => {
  const trackerEye = { x: 0, y: 0, z: 64 };

  it('rejects a run shorter than the minimum duration', () => {
    const run: QualifyingSample[] = [
      { tick: 0, trackerEye, enemyEye: { x: 1500, y: -120, z: 64 } },
      { tick: 8, trackerEye, enemyEye: { x: 1500, y: 120, z: 64 } },
    ];
    // duration 8 < MIN_WINDOW_DURATION_TICKS
    expect(evaluateWindow(1, run)).toBeNull();
  });

  it('accepts a static tracker following a moving enemy', () => {
    const run: QualifyingSample[] = [
      { tick: 0, trackerEye, enemyEye: { x: 1500, y: -120, z: 64 } },
      { tick: 8, trackerEye, enemyEye: { x: 1500, y: 0, z: 64 } },
      { tick: 16, trackerEye, enemyEye: { x: 1500, y: 120, z: 64 } },
    ];
    const window = evaluateWindow(1, run);
    expect(window).not.toBeNull();
    expect(window?.durationTicks).toBe(16);
    expect(window?.startTick).toBe(0);
  });

  it('rejects a run where the enemy barely moved', () => {
    const run: QualifyingSample[] = [
      { tick: 0, trackerEye, enemyEye: { x: 1500, y: 0, z: 64 } },
      { tick: 8, trackerEye, enemyEye: { x: 1500, y: 5, z: 64 } },
      { tick: 16, trackerEye, enemyEye: { x: 1500, y: 10, z: 64 } },
    ];
    expect(evaluateWindow(1, run)).toBeNull();
  });

  it('rejects a run where the tracker walked too far', () => {
    const run: QualifyingSample[] = [
      { tick: 0, trackerEye: { x: 0, y: 0, z: 64 }, enemyEye: { x: 1500, y: -120, z: 64 } },
      { tick: 8, trackerEye: { x: 0, y: 45, z: 64 }, enemyEye: { x: 1500, y: 0, z: 64 } },
      { tick: 16, trackerEye: { x: 0, y: 90, z: 64 }, enemyEye: { x: 1500, y: 120, z: 64 } },
    ];
    // tracker cumulative path 90 >= MAX_TRACKER_PATH_XY
    expect(evaluateWindow(1, run)).toBeNull();
  });
});

describe('computeSmokeTrackingSuspicions', () => {
  it('flags nobody and reports every player when there is no smoke tracking', () => {
    const positions = buildTrackingRound(1, [8, 16, 24]);
    const suspicions = computeSmokeTrackingSuspicions(positions, [], []);
    // Both players are reported even with zero windows.
    expect(suspicions).toHaveLength(2);
    expect(suspicions.every((suspicion) => suspicion.windowCount === 0)).toBe(true);
  });

  it('detects a window for a static tracker following a moving smoke-occluded enemy', () => {
    const positions = buildTrackingRound(1, [8, 16, 24]);
    const suspicions = computeSmokeTrackingSuspicions(positions, [SMOKE], []);
    const tracker = suspicions.find((suspicion) => suspicion.playerSteamId === 'tracker');
    expect(tracker?.windowCount).toBe(1);
    expect(tracker?.representativeTick).toBe(8);
    expect(tracker?.roundNumber).toBe(1);
    expect(tracker?.isFlagged).toBe(false); // one window is below the flag threshold
  });

  it('does not create a window for the moving enemy (reverse pair)', () => {
    const positions = buildTrackingRound(1, [8, 16, 24]);
    const suspicions = computeSmokeTrackingSuspicions(positions, [SMOKE], []);
    const enemy = suspicions.find((suspicion) => suspicion.playerSteamId === 'enemy');
    expect(enemy?.windowCount).toBe(0);
  });

  it('does not create a window when the tracker is moving', () => {
    const ticks = [8, 16, 24];
    const enemyYByIndex = [-120, 0, 120];
    const trackerYByIndex = [0, 45, 90]; // cumulative path 90 >= MAX_TRACKER_PATH_XY
    const positions: PositionSample[] = [];
    ticks.forEach((tick, index) => {
      const enemyX = 1500;
      const enemyY = enemyYByIndex[index];
      positions.push(buildTracker(tick, 1, 0, trackerYByIndex[index], enemyX, enemyY));
      positions.push(buildEnemy(tick, 1, enemyX, enemyY));
    });
    const suspicions = computeSmokeTrackingSuspicions(positions, [SMOKE], []);
    const tracker = suspicions.find((suspicion) => suspicion.playerSteamId === 'tracker');
    expect(tracker?.windowCount).toBe(0);
  });

  it('does not create a window when the enemy is stationary', () => {
    const ticks = [8, 16, 24];
    const positions: PositionSample[] = [];
    ticks.forEach((tick) => {
      positions.push(buildTracker(tick, 1, 0, 0, 1500, 0));
      positions.push(buildEnemy(tick, 1, 1500, 0)); // never moves
    });
    const suspicions = computeSmokeTrackingSuspicions(positions, [SMOKE], []);
    const tracker = suspicions.find((suspicion) => suspicion.playerSteamId === 'tracker');
    expect(tracker?.windowCount).toBe(0);
  });

  it('does not create a window when the enemy is not smoke-occluded', () => {
    const positions = buildTrackingRound(1, [8, 16, 24]);
    // Smoke far away from the tracker->enemy segment.
    const farSmoke: SmokeEvent = { roundNumber: 1, tick: 0, x: 1000, y: 3000, z: 0 };
    const suspicions = computeSmokeTrackingSuspicions(positions, [farSmoke], []);
    const tracker = suspicions.find((suspicion) => suspicion.playerSteamId === 'tracker');
    expect(tracker?.windowCount).toBe(0);
  });

  it('excludes samples that fall inside the combat window of a kill', () => {
    const positions = buildTrackingRound(1, [8, 16, 24]);
    // A kill at tick 16 wipes out the middle sample, breaking the run below the minimum duration.
    const suspicions = computeSmokeTrackingSuspicions(positions, [SMOKE], [16]);
    const tracker = suspicions.find((suspicion) => suspicion.playerSteamId === 'tracker');
    expect(tracker?.windowCount).toBe(0);
  });

  it('flags a player once they reach two windows across rounds', () => {
    const smokeRound1: SmokeEvent = { roundNumber: 1, tick: 0, x: 1000, y: 0, z: 0 };
    const smokeRound2: SmokeEvent = { roundNumber: 2, tick: 0, x: 1000, y: 0, z: 0 };
    const positions = [...buildTrackingRound(1, [8, 16, 24]), ...buildTrackingRound(2, [8, 16, 24])];
    const suspicions = computeSmokeTrackingSuspicions(positions, [smokeRound1, smokeRound2], []);
    const tracker = suspicions.find((suspicion) => suspicion.playerSteamId === 'tracker');
    expect(tracker?.windowCount).toBe(2);
    expect(tracker?.isFlagged).toBe(true);
  });

  it('uses the start of the longest window as the representative moment', () => {
    // Round 1 window has 3 samples (duration 16); round 2 window has 4 samples (duration 24).
    const smokeRound1: SmokeEvent = { roundNumber: 1, tick: 0, x: 1000, y: 0, z: 0 };
    const smokeRound2: SmokeEvent = { roundNumber: 2, tick: 0, x: 1000, y: 0, z: 0 };
    const longRound: PositionSample[] = [];
    const enemyYByIndex = [-120, -40, 40, 120];
    [8, 16, 24, 32].forEach((tick, index) => {
      const enemyY = enemyYByIndex[index];
      longRound.push(buildTracker(tick, 2, 0, 0, 1500, enemyY));
      longRound.push(buildEnemy(tick, 2, 1500, enemyY));
    });
    const positions = [...buildTrackingRound(1, [8, 16, 24]), ...longRound];
    const suspicions = computeSmokeTrackingSuspicions(positions, [smokeRound1, smokeRound2], []);
    const tracker = suspicions.find((suspicion) => suspicion.playerSteamId === 'tracker');
    expect(tracker?.windowCount).toBe(2);
    expect(tracker?.roundNumber).toBe(2);
    expect(tracker?.representativeTick).toBe(8);
  });
});
