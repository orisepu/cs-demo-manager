import { sql } from 'kysely';
import { db } from '../database';
import type { AntiAimSuspicion } from 'csdm/common/types/anti-aim-suspicion';
import { computeAntiAimSuspicion, SUSPICIOUS_PITCH_ABSOLUTE_DEGREES } from './compute-anti-aim-suspicion';

export async function fetchAntiAimSuspicions(checksum: string): Promise<AntiAimSuspicion[]> {
  const rows = await db
    .selectFrom('player_positions as p')
    // Inner join on the rounds table so only ticks belonging to an actual played round
    // (as recorded by the analyzer) are counted, excluding warmup/pre-round noise.
    .innerJoin('rounds as r', (eb) => {
      return eb.onRef('r.match_checksum', '=', 'p.match_checksum').onRef('r.number', '=', 'p.round_number');
    })
    .leftJoin('steam_account_overrides', 'steam_account_overrides.steam_id', 'p.player_steam_id')
    .where('p.match_checksum', '=', checksum)
    .where('p.is_alive', '=', true)
    .where('p.round_number', '>=', 1)
    .select([
      'p.player_steam_id as playerSteamId',
      (eb) => {
        return eb.fn.coalesce('steam_account_overrides.name', 'p.player_name').as('playerName');
      },
      sql<number>`COUNT(*)`.as('aliveTickCount'),
      sql<number>`COUNT(*) FILTER (WHERE ABS(p.pitch) > ${SUSPICIOUS_PITCH_ABSOLUTE_DEGREES})`.as(
        'suspiciousTickCount',
      ),
      // Representative moment = the suspicious tick with the most extreme pitch (mirrors the
      // anti-flash detector's ARRAY_AGG pick). Returning its tick and round lets the UI jump the
      // 2D viewer straight to the most incriminating moment. NULL when no suspicious tick exists.
      sql<
        number | null
      >`(ARRAY_AGG(p.tick ORDER BY ABS(p.pitch) DESC, p.tick) FILTER (WHERE ABS(p.pitch) > ${SUSPICIOUS_PITCH_ABSOLUTE_DEGREES}))[1]`.as(
        'tick',
      ),
      sql<
        number | null
      >`(ARRAY_AGG(p.round_number ORDER BY ABS(p.pitch) DESC, p.tick) FILTER (WHERE ABS(p.pitch) > ${SUSPICIOUS_PITCH_ABSOLUTE_DEGREES}))[1]`.as(
        'roundNumber',
      ),
    ])
    .groupBy(['p.player_steam_id', 'playerName'])
    .orderBy('p.player_steam_id')
    .execute();

  const suspicions: AntiAimSuspicion[] = rows.map((row) => {
    const { suspiciousFraction, isFlagged } = computeAntiAimSuspicion(row.aliveTickCount, row.suspiciousTickCount);

    return {
      playerSteamId: row.playerSteamId,
      playerName: row.playerName,
      aliveTickCount: row.aliveTickCount,
      suspiciousTickCount: row.suspiciousTickCount,
      suspiciousFraction,
      tick: row.tick,
      roundNumber: row.roundNumber,
      isFlagged,
    };
  });

  return suspicions;
}
