import { db } from 'csdm/node/database/database';
import type { SmokeTrackingSuspicion } from 'csdm/common/types/smoke-tracking-suspicion';
import {
  computeSmokeTrackingSuspicions,
  type PositionSample,
  type SmokeEvent,
} from './compute-smoke-tracking-suspicions';

async function fetchCachedSuspicions(checksum: string): Promise<SmokeTrackingSuspicion[]> {
  const rows = await db
    .selectFrom('smoke_tracking_suspicions as s')
    .leftJoin('steam_account_overrides', 'steam_account_overrides.steam_id', 's.player_steam_id')
    .select([
      's.player_steam_id as playerSteamId',
      (eb) => {
        return eb.fn.coalesce('steam_account_overrides.name', 's.player_name').as('playerName');
      },
      's.window_count as windowCount',
      's.representative_tick as representativeTick',
      's.round_number as roundNumber',
      's.moments as moments',
      's.is_flagged as isFlagged',
    ])
    .where('s.match_checksum', '=', checksum)
    .orderBy('s.window_count', 'desc')
    .orderBy('s.player_steam_id')
    .execute();

  return rows.map((row) => {
    return {
      playerSteamId: row.playerSteamId,
      playerName: row.playerName,
      windowCount: row.windowCount,
      representativeTick: row.representativeTick,
      roundNumber: row.roundNumber,
      moments: row.moments,
      isFlagged: row.isFlagged,
    };
  });
}

async function computeAndCacheSuspicions(checksum: string): Promise<SmokeTrackingSuspicion[]> {
  // Only alive samples of real rounds (round_number >= 1) that actually exist in the rounds table.
  const positionRows = await db
    .selectFrom('player_positions as p')
    .innerJoin('rounds as r', (join) => {
      return join.onRef('r.match_checksum', '=', 'p.match_checksum').onRef('r.number', '=', 'p.round_number');
    })
    .select([
      'p.tick',
      'p.round_number as roundNumber',
      'p.player_steam_id as steamId',
      'p.player_name as name',
      'p.side',
      'p.is_alive as isAlive',
      'p.is_ducking as isDucking',
      'p.x',
      'p.y',
      'p.z',
      'p.yaw',
      'p.pitch',
    ])
    .where('p.match_checksum', '=', checksum)
    .where('p.is_alive', '=', true)
    .where('p.round_number', '>=', 1)
    .execute();

  const smokeRows = await db
    .selectFrom('smokes_start')
    .select(['round_number as roundNumber', 'tick', 'x', 'y', 'z'])
    .where('match_checksum', '=', checksum)
    .execute();

  const killRows = await db
    .selectFrom('kills')
    .select(['tick'])
    .where('match_checksum', '=', checksum)
    .where('round_number', '>=', 1)
    .execute();

  // Tickrate lives on the demo (joined to the match by checksum). Used to turn window durations into
  // seconds for the moment labels. Falls back to the compute default when the demo row is missing.
  const demoRow = await db.selectFrom('demos').select(['tickrate']).where('checksum', '=', checksum).executeTakeFirst();

  const positions: PositionSample[] = positionRows.map((row) => {
    return {
      tick: row.tick,
      roundNumber: row.roundNumber,
      steamId: row.steamId,
      name: row.name,
      side: row.side,
      isAlive: row.isAlive,
      isDucking: row.isDucking,
      x: row.x,
      y: row.y,
      z: row.z,
      yaw: row.yaw,
      pitch: row.pitch,
    };
  });
  const smokes: SmokeEvent[] = smokeRows.map((row) => {
    return { roundNumber: row.roundNumber, tick: row.tick, x: row.x, y: row.y, z: row.z };
  });
  const killTicks = killRows.map((row) => row.tick);

  const suspicions = computeSmokeTrackingSuspicions(positions, smokes, killTicks, demoRow?.tickrate);

  if (suspicions.length > 0) {
    await db
      .insertInto('smoke_tracking_suspicions')
      .values(
        suspicions.map((suspicion) => {
          return {
            match_checksum: checksum,
            player_steam_id: suspicion.playerSteamId,
            player_name: suspicion.playerName,
            window_count: suspicion.windowCount,
            representative_tick: suspicion.representativeTick,
            round_number: suspicion.roundNumber,
            moments: JSON.stringify(suspicion.moments),
            is_flagged: suspicion.isFlagged,
          };
        }),
      )
      .execute();
  }

  return suspicions;
}

// Returns the smoke-tracking suspicions for a match, computing them once (heavy) and serving the
// cached rows on every subsequent call. The first open of a match is therefore slow while later
// opens are instant.
export async function fetchSmokeTrackingSuspicions(checksum: string): Promise<SmokeTrackingSuspicion[]> {
  const hasCachedRow = await db
    .selectFrom('smoke_tracking_suspicions')
    .select('id')
    .where('match_checksum', '=', checksum)
    .limit(1)
    .executeTakeFirst();

  if (hasCachedRow !== undefined) {
    return fetchCachedSuspicions(checksum);
  }

  return computeAndCacheSuspicions(checksum);
}
