import { sql } from 'kysely';
import { db } from '../database';
import type { SpinbotSuspicion } from 'csdm/common/types/spinbot-suspicion';
import { MAX_DETECTION_MOMENTS, type DetectionMoment } from 'csdm/common/types/detection-moment';
import {
  computeSpinbotSuspicion,
  SPINBOT_ROLLING_WINDOW_TICKS,
  SPINBOT_SUSPICIOUS_YAW_DELTA_DEGREES,
} from './compute-spinbot-suspicion';

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
      return db.selectFrom('gated').select([
        'player_steam_id',
        'player_name',
        // Carry the round and tick of each windowed row through so the final aggregate can
        // recover WHERE the rolling-mean peak occurred, not just its value.
        'round_number',
        'tick',
        sql<number>`AVG(yaw_delta) OVER (PARTITION BY player_steam_id, round_number ORDER BY tick ROWS BETWEEN ${sql.raw(
          String(precedingTicks),
        )} PRECEDING AND CURRENT ROW)`.as('rolling_mean'),
      ]);
    })
    // One row per (player, round): the round's peak rolling mean and the tick where it peaked, plus
    // the round's live-play tick count. Aggregated per player in TS so each qualifying round becomes
    // a distinct moment while the representative moment is still the global peak.
    .selectFrom('rolling')
    .leftJoin('steam_account_overrides', 'steam_account_overrides.steam_id', 'rolling.player_steam_id')
    .select([
      'rolling.player_steam_id as playerSteamId',
      (eb) => {
        return eb.fn.coalesce('steam_account_overrides.name', 'rolling.player_name').as('playerName');
      },
      'rolling.round_number as roundNumber',
      sql<number>`COUNT(*)`.as('tickCount'),
      sql<number>`COALESCE(MAX(rolling.rolling_mean), 0)`.as('roundMaxRollingMean'),
      // Tick where the rolling mean peaks within the round (ties break on the earliest tick).
      sql<number | null>`(ARRAY_AGG(rolling.tick ORDER BY rolling.rolling_mean DESC NULLS LAST, rolling.tick))[1]`.as(
        'peakTick',
      ),
    ])
    .groupBy(['rolling.player_steam_id', 'playerName', 'rolling.round_number'])
    .orderBy('rolling.player_steam_id')
    .orderBy('rolling.round_number')
    .execute();

  type PlayerRow = (typeof rows)[number];
  const playersBySteamId = new Map<string, { playerName: string; rounds: PlayerRow[] }>();
  for (const row of rows) {
    let player = playersBySteamId.get(row.playerSteamId);
    if (player === undefined) {
      player = { playerName: row.playerName, rounds: [] };
      playersBySteamId.set(row.playerSteamId, player);
    }
    player.rounds.push(row);
  }

  const suspicions: SpinbotSuspicion[] = [];
  for (const [playerSteamId, player] of playersBySteamId) {
    const aliveTickCount = player.rounds.reduce((total, round) => total + round.tickCount, 0);
    const peakRound = player.rounds.reduce((best, round) => {
      return round.roundMaxRollingMean > best.roundMaxRollingMean ? round : best;
    }, player.rounds[0]);

    const { maxRollingMeanYawDelta, isFlagged } = computeSpinbotSuspicion(
      aliveTickCount,
      peakRound.roundMaxRollingMean,
    );

    // One moment per round whose peak rolling mean crossed the flag threshold (only for flagged
    // players), highest peak first. Label e.g. "Round 12 · 63.9°/tick".
    let moments: DetectionMoment[] = [];
    if (isFlagged) {
      moments = player.rounds
        .filter((round) => round.roundMaxRollingMean >= SPINBOT_SUSPICIOUS_YAW_DELTA_DEGREES && round.peakTick !== null)
        .toSorted((a, b) => b.roundMaxRollingMean - a.roundMaxRollingMean || a.roundNumber - b.roundNumber)
        .map((round) => {
          return {
            tick: round.peakTick as number,
            roundNumber: round.roundNumber,
            label: `Round ${round.roundNumber} · ${round.roundMaxRollingMean.toFixed(1)}°/tick`,
          };
        })
        .slice(0, MAX_DETECTION_MOMENTS);
    }

    suspicions.push({
      playerSteamId,
      playerName: player.playerName,
      aliveTickCount,
      maxRollingMeanYawDelta,
      tick: peakRound.peakTick,
      roundNumber: peakRound.roundNumber,
      moments,
      isFlagged,
    });
  }

  suspicions.sort((a, b) => a.playerSteamId.localeCompare(b.playerSteamId));

  return suspicions;
}
