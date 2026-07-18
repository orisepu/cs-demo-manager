import { sql } from 'kysely';
import { db } from '../database';
import type { AimToggleSuspicion } from 'csdm/common/types/aim-toggle-suspicion';
import { computeAimToggleSuspicion, type RoundKillStats } from './compute-aim-toggle-suspicion';

export async function fetchAimToggleSuspicions(checksum: string): Promise<AimToggleSuspicion[]> {
  // One row per (player, round) from kills: kill count, headshot-kill count and a representative
  // headshot tick. Bot-controlled kills and null attackers are excluded so they never pollute the
  // metric, and only real rounds (round_number >= 1) are considered. Shots and damages are pulled
  // separately (below) and merged so the accuracy trigger sees the player's full shot volume,
  // including rounds where they got no kill. The per-round rows are aggregated per player in TS
  // (baseline over the whole match + hottest qualifying round for each metric).
  const killRows = await db
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

  // Shots per (player, round): trigger pulls and the round's first shot tick. Only players who appear
  // in the kills table above are kept (the aim-toggle universe is players with at least one kill).
  const shotRows = await db
    .selectFrom('shots as s')
    .where('s.match_checksum', '=', checksum)
    .where('s.is_player_controlling_bot', '=', false)
    .where('s.round_number', '>=', 1)
    .select([
      's.player_steam_id as playerSteamId',
      's.round_number as roundNumber',
      sql<number>`COUNT(*)`.as('shotCount'),
      sql<number>`MIN(s.tick)`.as('shotTick'),
    ])
    .groupBy(['s.player_steam_id', 's.round_number'])
    .execute();

  // Landing shots per (player, round): distinct-tick damage events so a single shotgun blast counts
  // once instead of once per pellet.
  const damageRows = await db
    .selectFrom('damages as d')
    .where('d.match_checksum', '=', checksum)
    .where('d.attacker_steam_id', 'is not', null)
    .where('d.is_attacker_controlling_bot', '=', false)
    .where('d.round_number', '>=', 1)
    .select([
      'd.attacker_steam_id as playerSteamId',
      'd.round_number as roundNumber',
      sql<number>`COUNT(DISTINCT d.tick)`.as('hitCount'),
    ])
    .groupBy(['d.attacker_steam_id', 'd.round_number'])
    .execute();

  type PlayerRounds = {
    playerSteamId: string;
    playerName: string;
    roundsByNumber: Map<number, RoundKillStats>;
  };
  const playersBySteamId = new Map<string, PlayerRounds>();

  const getRound = (player: PlayerRounds, roundNumber: number): RoundKillStats => {
    let round = player.roundsByNumber.get(roundNumber);
    if (round === undefined) {
      round = {
        roundNumber,
        killCount: 0,
        headshotKillCount: 0,
        headshotTick: null,
        shotCount: 0,
        hitCount: 0,
        shotTick: null,
      };
      player.roundsByNumber.set(roundNumber, round);
    }

    return round;
  };

  for (const row of killRows) {
    const steamId = row.playerSteamId as string;
    let player = playersBySteamId.get(steamId);
    if (player === undefined) {
      player = { playerSteamId: steamId, playerName: row.playerName, roundsByNumber: new Map() };
      playersBySteamId.set(steamId, player);
    }

    const round = getRound(player, row.roundNumber);
    round.killCount = Number(row.killCount);
    round.headshotKillCount = Number(row.headshotKillCount);
    round.headshotTick = row.headshotTick === null ? null : Number(row.headshotTick);
  }

  for (const row of shotRows) {
    const player = playersBySteamId.get(row.playerSteamId);
    if (player === undefined) {
      continue;
    }
    const round = getRound(player, row.roundNumber);
    round.shotCount = Number(row.shotCount);
    round.shotTick = row.shotTick === null ? null : Number(row.shotTick);
  }

  for (const row of damageRows) {
    const player = playersBySteamId.get(row.playerSteamId as string);
    if (player === undefined) {
      continue;
    }
    const round = getRound(player, row.roundNumber);
    round.hitCount = Number(row.hitCount);
  }

  const suspicions: AimToggleSuspicion[] = [];
  for (const player of playersBySteamId.values()) {
    const rounds = [...player.roundsByNumber.values()];
    const killCount = rounds.reduce((total, round) => total + round.killCount, 0);
    const {
      baselineHeadshotRate,
      hotRoundNumber,
      hotRoundHeadshotRate,
      baselineAccuracy,
      hotAccuracyRoundNumber,
      hotRoundAccuracy,
      tick,
      moments,
      isFlagged,
    } = computeAimToggleSuspicion(rounds);

    suspicions.push({
      playerSteamId: player.playerSteamId,
      playerName: player.playerName,
      killCount,
      baselineHeadshotRate,
      hotRoundNumber,
      hotRoundHeadshotRate,
      baselineAccuracy,
      hotAccuracyRoundNumber,
      hotRoundAccuracy,
      tick,
      roundNumber: hotRoundNumber ?? hotAccuracyRoundNumber,
      moments,
      isFlagged,
    });
  }

  suspicions.sort((a, b) => a.playerSteamId.localeCompare(b.playerSteamId));

  return suspicions;
}
