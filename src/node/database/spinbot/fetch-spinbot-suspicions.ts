import { sql } from 'kysely';
import { db } from '../database';
import type { SpinbotSuspicion } from 'csdm/common/types/spinbot-suspicion';
import { computeSpinbotSuspicion, SPINBOT_ROLLING_WINDOW_TICKS } from './compute-spinbot-suspicion';

export async function fetchSpinbotSuspicions(checksum: string): Promise<SpinbotSuspicion[]> {
  // Number of preceding ticks included in the rolling-mean window (window size minus the
  // current row). Inlined as a literal because SQL frame bounds cannot be bound parameters.
  const precedingTicks = SPINBOT_ROLLING_WINDOW_TICKS - 1;

  const rows = await db
    // Per-tick yaw angular velocity between CONSECUTIVE ticks, per player, per round. The
    // modulo folds the -180/+180 wraparound so a 179 -> -179 change reads as 2 degrees, not
    // 358. LAG() is partitioned by round so it never measures a delta across a round boundary
    // (a respawn/teleport between rounds would otherwise produce a bogus delta up to 360).
    .with('deltas', (db) => {
      return (
        db
          .selectFrom('player_positions as p')
          // Inner join on the rounds table so only ticks belonging to an actual played round
          // (as recorded by the analyzer) are counted, excluding warmup/pre-round noise.
          .innerJoin('rounds as r', (eb) => {
            return eb.onRef('r.match_checksum', '=', 'p.match_checksum').onRef('r.number', '=', 'p.round_number');
          })
          .where('p.match_checksum', '=', checksum)
          .where('p.is_alive', '=', true)
          .where('p.round_number', '>=', 1)
          // Exclude freeze time: while frozen at round start players spin their view around
          // freely, which mimics a spinbot but is not one. Only live-play ticks are analyzed.
          .whereRef('p.tick', '>', 'r.freeze_time_end_tick')
          .select([
            'p.player_steam_id as player_steam_id',
            'p.player_name as player_name',
            'p.round_number as round_number',
            'p.tick as tick',
            sql<number>`ABS(((p.yaw - LAG(p.yaw) OVER (PARTITION BY p.match_checksum, p.player_steam_id, p.round_number ORDER BY p.tick)) + 540)::numeric % 360 - 180)`.as(
              'yaw_delta',
            ),
            sql<number>`p.tick - LAG(p.tick) OVER (PARTITION BY p.match_checksum, p.player_steam_id, p.round_number ORDER BY p.tick)`.as(
              'tick_diff',
            ),
          ])
      );
    })
    // Keep only deltas measured between strictly consecutive ticks (tick difference of 1).
    // Any gap means the two samples are not adjacent and their delta is not a real velocity.
    .with('gated', (db) => {
      return db
        .selectFrom('deltas')
        .select(['player_steam_id', 'player_name', 'round_number', 'tick', 'yaw_delta'])
        .where('tick_diff', '=', 1);
    })
    // Rolling mean of the per-tick yaw velocity over a window of SPINBOT_ROLLING_WINDOW_TICKS
    // consecutive ticks, partitioned so the window never crosses a player or round boundary.
    // A spinbot sustains a high value across the whole window; a one-off flick is diluted.
    .with('rolling', (db) => {
      return db
        .selectFrom('gated')
        .select([
          'player_steam_id',
          'player_name',
          sql<number>`AVG(yaw_delta) OVER (PARTITION BY player_steam_id, round_number ORDER BY tick ROWS BETWEEN ${sql.raw(
            String(precedingTicks),
          )} PRECEDING AND CURRENT ROW)`.as('rolling_mean'),
        ]);
    })
    .selectFrom('rolling')
    .leftJoin('steam_account_overrides', 'steam_account_overrides.steam_id', 'rolling.player_steam_id')
    .select([
      'rolling.player_steam_id as playerSteamId',
      (eb) => {
        return eb.fn.coalesce('steam_account_overrides.name', 'rolling.player_name').as('playerName');
      },
      sql<number>`COUNT(*)`.as('aliveTickCount'),
      sql<number>`COALESCE(MAX(rolling.rolling_mean), 0)`.as('maxRollingMeanYawDelta'),
    ])
    .groupBy(['rolling.player_steam_id', 'playerName'])
    .orderBy('rolling.player_steam_id')
    .execute();

  const suspicions: SpinbotSuspicion[] = rows.map((row) => {
    const { maxRollingMeanYawDelta, isFlagged } = computeSpinbotSuspicion(
      row.aliveTickCount,
      row.maxRollingMeanYawDelta,
    );

    return {
      playerSteamId: row.playerSteamId,
      playerName: row.playerName,
      aliveTickCount: row.aliveTickCount,
      maxRollingMeanYawDelta,
      isFlagged,
    };
  });

  return suspicions;
}
