import { sql } from 'kysely';
import { db } from '../database';
import type { AntiFlashSuspicion } from 'csdm/common/types/anti-flash-suspicion';
import { computeAntiFlashSuspicion, FLASH_DURATION_REMAINING_THRESHOLD_SECONDS } from './compute-anti-flash-suspicion';

export async function fetchAntiFlashSuspicions(checksum: string): Promise<AntiFlashSuspicion[]> {
  // Blindness threshold inlined as a literal because it lives inside an aggregate FILTER predicate,
  // which cannot take a bound parameter here. The value is a trusted numeric constant, not input.
  const flashThreshold = FLASH_DURATION_REMAINING_THRESHOLD_SECONDS;

  const rows = await db
    // One row per kill, carrying the attacker's remaining flash blindness (in seconds) sampled from
    // player_positions at the exact kill tick. The kills table only exposes is_killer_blinded as a
    // boolean, so we join positions to recover the MAGNITUDE of blindness. That magnitude is what
    // separates a legit lucky spray (little blindness left) from an anti-flash cheat (still heavily
    // blind). Bot-controlled kills are excluded so they never pollute the metric.
    .with('killer_flash', (db) => {
      return db
        .selectFrom('kills as k')
        .innerJoin('player_positions as pp', (eb) => {
          return eb
            .onRef('pp.match_checksum', '=', 'k.match_checksum')
            .onRef('pp.player_steam_id', '=', 'k.killer_steam_id')
            .onRef('pp.tick', '=', 'k.tick');
        })
        .where('k.match_checksum', '=', checksum)
        .where('k.killer_steam_id', 'is not', null)
        .where('k.is_killer_controlling_bot', '=', false)
        .select([
          'k.killer_steam_id as player_steam_id',
          'k.killer_name as player_name',
          'k.round_number as round_number',
          'k.tick as tick',
          'pp.flash_duration_remaining as flash_duration_remaining',
        ]);
    })
    .selectFrom('killer_flash as cf')
    .leftJoin('steam_account_overrides', 'steam_account_overrides.steam_id', 'cf.player_steam_id')
    .select([
      'cf.player_steam_id as playerSteamId',
      (eb) => {
        return eb.fn.coalesce('steam_account_overrides.name', 'cf.player_name').as('playerName');
      },
      sql<number>`COUNT(*)`.as('killCount'),
      sql<number>`COUNT(*) FILTER (WHERE cf.flash_duration_remaining > ${sql.raw(String(flashThreshold))})`.as(
        'flashedKillCount',
      ),
      sql<number>`COALESCE(MAX(cf.flash_duration_remaining), 0)`.as('maxFlashDurationAtKill'),
      // Representative moment = the kill with the most remaining blindness. Returning its tick and
      // round lets the UI later jump the 2D viewer straight to the most incriminating moment.
      sql<number>`(ARRAY_AGG(cf.tick ORDER BY cf.flash_duration_remaining DESC, cf.tick))[1]`.as('tick'),
      sql<number>`(ARRAY_AGG(cf.round_number ORDER BY cf.flash_duration_remaining DESC, cf.tick))[1]`.as('roundNumber'),
    ])
    .groupBy(['cf.player_steam_id', 'playerName'])
    .orderBy('cf.player_steam_id')
    .execute();

  const suspicions: AntiFlashSuspicion[] = rows.map((row) => {
    const { flashedKillCount, isFlagged } = computeAntiFlashSuspicion(row.killCount, row.flashedKillCount);

    return {
      playerSteamId: row.playerSteamId,
      playerName: row.playerName,
      killCount: row.killCount,
      flashedKillCount,
      maxFlashDurationAtKill: row.maxFlashDurationAtKill,
      tick: row.tick,
      roundNumber: row.roundNumber,
      isFlagged,
    };
  });

  return suspicions;
}
