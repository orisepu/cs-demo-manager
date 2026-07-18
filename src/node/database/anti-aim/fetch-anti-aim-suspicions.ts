import { sql } from 'kysely';
import { db } from '../database';
import type { AntiAimSuspicion } from 'csdm/common/types/anti-aim-suspicion';
import { MAX_DETECTION_MOMENTS, type DetectionMoment } from 'csdm/common/types/detection-moment';
import { computeAntiAimSuspicion, SUSPICIOUS_PITCH_ABSOLUTE_DEGREES } from './compute-anti-aim-suspicion';

export async function fetchAntiAimSuspicions(checksum: string): Promise<AntiAimSuspicion[]> {
  // One row per (player, round): alive tick count, suspicious (extreme-pitch) tick count, the most
  // extreme pitch reached and the tick where it happened. Aggregated per player in TS so each round
  // with extreme-pitch ticks becomes a distinct moment while the representative moment is still the
  // globally most extreme tick. Inner join on rounds excludes warmup/pre-round noise.
  const rows = await db
    .selectFrom('player_positions as p')
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
      'p.round_number as roundNumber',
      sql<number>`COUNT(*)`.as('aliveTickCount'),
      sql<number>`COUNT(*) FILTER (WHERE ABS(p.pitch) > ${SUSPICIOUS_PITCH_ABSOLUTE_DEGREES})`.as(
        'suspiciousTickCount',
      ),
      // Most extreme |pitch| of the round and the tick where it occurred (ties break on the earliest
      // tick). Null when the round has no suspicious tick.
      sql<number | null>`MAX(ABS(p.pitch)) FILTER (WHERE ABS(p.pitch) > ${SUSPICIOUS_PITCH_ABSOLUTE_DEGREES})`.as(
        'maxPitch',
      ),
      sql<
        number | null
      >`(ARRAY_AGG(p.tick ORDER BY ABS(p.pitch) DESC, p.tick) FILTER (WHERE ABS(p.pitch) > ${SUSPICIOUS_PITCH_ABSOLUTE_DEGREES}))[1]`.as(
        'extremeTick',
      ),
    ])
    .groupBy(['p.player_steam_id', 'playerName', 'p.round_number'])
    .orderBy('p.player_steam_id')
    .orderBy('p.round_number')
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

  const suspicions: AntiAimSuspicion[] = [];
  for (const [playerSteamId, player] of playersBySteamId) {
    const aliveTickCount = player.rounds.reduce((total, round) => total + round.aliveTickCount, 0);
    const suspiciousTickCount = player.rounds.reduce((total, round) => total + round.suspiciousTickCount, 0);

    // Representative moment = the globally most extreme suspicious tick across all rounds.
    let representativeTick: number | null = null;
    let representativeRoundNumber: number | null = null;
    let representativeMaxPitch = -1;
    for (const round of player.rounds) {
      if (round.extremeTick !== null && round.maxPitch !== null && round.maxPitch > representativeMaxPitch) {
        representativeMaxPitch = round.maxPitch;
        representativeTick = round.extremeTick;
        representativeRoundNumber = round.roundNumber;
      }
    }

    const { suspiciousFraction, isFlagged } = computeAntiAimSuspicion(aliveTickCount, suspiciousTickCount);

    // One moment per round with extreme-pitch ticks (only for flagged players), most extreme first.
    // Label e.g. "Round 12 · pitch 89.0°".
    let moments: DetectionMoment[] = [];
    if (isFlagged) {
      moments = player.rounds
        .filter((round) => round.suspiciousTickCount > 0 && round.extremeTick !== null && round.maxPitch !== null)
        .toSorted((a, b) => (b.maxPitch as number) - (a.maxPitch as number) || a.roundNumber - b.roundNumber)
        .map((round) => {
          return {
            tick: round.extremeTick as number,
            roundNumber: round.roundNumber,
            label: `Round ${round.roundNumber} · pitch ${(round.maxPitch as number).toFixed(1)}°`,
          };
        })
        .slice(0, MAX_DETECTION_MOMENTS);
    }

    suspicions.push({
      playerSteamId,
      playerName: player.playerName,
      aliveTickCount,
      suspiciousTickCount,
      suspiciousFraction,
      tick: representativeTick,
      roundNumber: representativeRoundNumber,
      moments,
      isFlagged,
    });
  }

  suspicions.sort((a, b) => a.playerSteamId.localeCompare(b.playerSteamId));

  return suspicions;
}
