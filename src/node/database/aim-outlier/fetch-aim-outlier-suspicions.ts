import { sql } from 'kysely';
import { db } from '../database';
import type { AimOutlierSuspicion } from 'csdm/common/types/aim-outlier-suspicion';
import { computeAimOutlierSuspicions, type PlayerAimStats, type PlayerRoundAim } from './compute-aim-outlier-suspicion';

type MutableRound = PlayerRoundAim;

type MutablePlayer = {
  playerSteamId: string;
  playerName: string;
  roundsByNumber: Map<number, MutableRound>;
};

function getPlayer(players: Map<string, MutablePlayer>, steamId: string, name: string): MutablePlayer {
  let player = players.get(steamId);
  if (player === undefined) {
    player = { playerSteamId: steamId, playerName: name, roundsByNumber: new Map() };
    players.set(steamId, player);
  }

  return player;
}

function getRound(player: MutablePlayer, roundNumber: number): MutableRound {
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
}

export async function fetchAimOutlierSuspicions(checksum: string): Promise<AimOutlierSuspicion[]> {
  // Three independent aggregations (kills, shots, damages), each per (player, round), merged in TS.
  // Bot-controlled events and null steam ids are excluded and only real rounds (>= 1) are considered,
  // mirroring the other aim detectors' filters. Accuracy uses distinct-tick damage events as
  // "landing shots" so a single shotgun blast counts once instead of once per pellet.
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
      sql<number | null>`(ARRAY_AGG(k.tick ORDER BY k.tick) FILTER (WHERE k.is_headshot))[1]`.as('headshotTick'),
    ])
    .groupBy(['k.killer_steam_id', 'playerName', 'k.round_number'])
    .execute();

  const shotRows = await db
    .selectFrom('shots as s')
    .leftJoin('steam_account_overrides', 'steam_account_overrides.steam_id', 's.player_steam_id')
    .where('s.match_checksum', '=', checksum)
    .where('s.is_player_controlling_bot', '=', false)
    .where('s.round_number', '>=', 1)
    .select([
      's.player_steam_id as playerSteamId',
      (eb) => {
        return eb.fn.coalesce('steam_account_overrides.name', 's.player_name').as('playerName');
      },
      's.round_number as roundNumber',
      sql<number>`COUNT(*)`.as('shotCount'),
      sql<number>`MIN(s.tick)`.as('shotTick'),
    ])
    .groupBy(['s.player_steam_id', 'playerName', 's.round_number'])
    .execute();

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

  const players = new Map<string, MutablePlayer>();

  for (const row of killRows) {
    const player = getPlayer(players, row.playerSteamId as string, row.playerName);
    const round = getRound(player, row.roundNumber);
    round.killCount = Number(row.killCount);
    round.headshotKillCount = Number(row.headshotKillCount);
    round.headshotTick = row.headshotTick === null ? null : Number(row.headshotTick);
  }

  for (const row of shotRows) {
    const player = getPlayer(players, row.playerSteamId, row.playerName);
    const round = getRound(player, row.roundNumber);
    round.shotCount = Number(row.shotCount);
    round.shotTick = row.shotTick === null ? null : Number(row.shotTick);
  }

  for (const row of damageRows) {
    // A damage attacker with no shots/kills recorded (edge case) still needs a home round.
    const player = players.get(row.playerSteamId as string);
    if (player === undefined) {
      continue;
    }
    const round = getRound(player, row.roundNumber);
    round.hitCount = Number(row.hitCount);
  }

  const playerStats: PlayerAimStats[] = [];
  for (const player of players.values()) {
    const rounds = [...player.roundsByNumber.values()];
    const killCount = rounds.reduce((total, round) => total + round.killCount, 0);
    const headshotKillCount = rounds.reduce((total, round) => total + round.headshotKillCount, 0);
    const shotCount = rounds.reduce((total, round) => total + round.shotCount, 0);
    const hitCount = rounds.reduce((total, round) => total + round.hitCount, 0);
    playerStats.push({
      playerSteamId: player.playerSteamId,
      playerName: player.playerName,
      killCount,
      headshotKillCount,
      shotCount,
      hitCount,
      rounds,
    });
  }

  const scores = computeAimOutlierSuspicions(playerStats);

  const suspicions: AimOutlierSuspicion[] = scores.map((score) => {
    return {
      playerSteamId: score.playerSteamId,
      playerName: score.playerName,
      killCount: score.killCount,
      shotCount: score.shotCount,
      headshotRate: score.headshotRate,
      accuracy: score.accuracy,
      baselineHeadshotRate: score.baselineHeadshotRate,
      baselineAccuracy: score.baselineAccuracy,
      isHeadshotOutlier: score.isHeadshotOutlier,
      isAccuracyOutlier: score.isAccuracyOutlier,
      tick: score.tick,
      roundNumber: score.roundNumber,
      moments: score.moments,
      isFlagged: score.isFlagged,
    };
  });

  suspicions.sort((a, b) => a.playerSteamId.localeCompare(b.playerSteamId));

  return suspicions;
}
