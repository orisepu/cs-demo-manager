import { sql } from 'kysely';
import { db } from '../database';
import type { AimToggleSuspicion } from 'csdm/common/types/aim-toggle-suspicion';
import { computeAimToggleSuspicion, type RoundKillStats } from './compute-aim-toggle-suspicion';

export async function fetchAimToggleSuspicions(checksum: string): Promise<AimToggleSuspicion[]> {
  // One row per (player, round): its kill count, headshot-kill count and a representative headshot
  // tick. Bot-controlled kills and null attackers are excluded so they never pollute the metric, and
  // only real rounds (round_number >= 1) are considered. The per-round rows are aggregated per player
  // in TS (baseline over the whole match + hottest qualifying round).
  const rows = await db
    .selectFrom('kills as k')
    .leftJoin('steam_account_overrides', 'steam_account_overrides.steam_id', 'k.killer_steam_id')
    .where('k.match_checksum', '=', checksum)
    .where('k.killer_steam_id', 'is not', null)
    .where('k.is_killer_controlling_bot', '=', false)
    .where('k.round_number', '>=', 1)
    .select([
      'k.killer_steam_id as playerSteamId',
      (eb) => {
        return eb.fn.coalesce('steam_account_overrides.name', 'k.killer_name').as('playerName');
      },
      'k.round_number as roundNumber',
      sql<number>`COUNT(*)`.as('killCount'),
      sql<number>`COUNT(*) FILTER (WHERE k.is_headshot)`.as('headshotKillCount'),
      // Earliest headshot kill tick of the round, for the 2D-viewer jump. NULL when the round has no
      // headshot kill.
      sql<number | null>`(ARRAY_AGG(k.tick ORDER BY k.tick) FILTER (WHERE k.is_headshot))[1]`.as('headshotTick'),
    ])
    .groupBy(['k.killer_steam_id', 'playerName', 'k.round_number'])
    .execute();

  type PlayerRounds = {
    playerSteamId: string;
    playerName: string;
    rounds: RoundKillStats[];
  };
  const playersBySteamId = new Map<string, PlayerRounds>();

  for (const row of rows) {
    let player = playersBySteamId.get(row.playerSteamId);
    if (player === undefined) {
      player = { playerSteamId: row.playerSteamId, playerName: row.playerName, rounds: [] };
      playersBySteamId.set(row.playerSteamId, player);
    }

    player.rounds.push({
      roundNumber: row.roundNumber,
      killCount: Number(row.killCount),
      headshotKillCount: Number(row.headshotKillCount),
      headshotTick: row.headshotTick,
    });
  }

  const suspicions: AimToggleSuspicion[] = [];
  for (const player of playersBySteamId.values()) {
    const killCount = player.rounds.reduce((total, round) => total + round.killCount, 0);
    const { baselineHeadshotRate, hotRoundNumber, hotRoundHeadshotRate, tick, isFlagged } = computeAimToggleSuspicion(
      player.rounds,
    );

    suspicions.push({
      playerSteamId: player.playerSteamId,
      playerName: player.playerName,
      killCount,
      baselineHeadshotRate,
      hotRoundNumber,
      hotRoundHeadshotRate,
      tick,
      roundNumber: hotRoundNumber,
      isFlagged,
    });
  }

  suspicions.sort((a, b) => a.playerSteamId.localeCompare(b.playerSteamId));

  return suspicions;
}
