import { db } from '../database';
import type { AntiFlashSuspicion } from 'csdm/common/types/anti-flash-suspicion';
import { MAX_DETECTION_MOMENTS, type DetectionMoment } from 'csdm/common/types/detection-moment';
import { computeAntiFlashSuspicion, FLASH_DURATION_REMAINING_THRESHOLD_SECONDS } from './compute-anti-flash-suspicion';

export async function fetchAntiFlashSuspicions(checksum: string): Promise<AntiFlashSuspicion[]> {
  // One row per kill, carrying the attacker's remaining flash blindness (in seconds) sampled from
  // player_positions at the exact kill tick and the victim's name. The kills table only exposes
  // is_killer_blinded as a boolean, so we join positions to recover the MAGNITUDE of blindness. That
  // magnitude separates a legit lucky spray (little blindness left) from an anti-flash cheat (still
  // heavily blind). Bot-controlled kills are excluded so they never pollute the metric. Rows are
  // aggregated per player in TS (counts + representative moment + per-flashed-kill moments).
  const rows = await db
    .selectFrom('kills as k')
    .innerJoin('player_positions as pp', (eb) => {
      return eb
        .onRef('pp.match_checksum', '=', 'k.match_checksum')
        .onRef('pp.player_steam_id', '=', 'k.killer_steam_id')
        .onRef('pp.tick', '=', 'k.tick');
    })
    .leftJoin('steam_account_overrides', 'steam_account_overrides.steam_id', 'k.killer_steam_id')
    .where('k.match_checksum', '=', checksum)
    .where('k.killer_steam_id', 'is not', null)
    .where('k.is_killer_controlling_bot', '=', false)
    .select([
      'k.killer_steam_id as playerSteamId',
      (eb) => {
        return eb.fn.coalesce('steam_account_overrides.name', 'k.killer_name').as('playerName');
      },
      'k.round_number as roundNumber',
      'k.tick as tick',
      'k.victim_name as victimName',
      'pp.flash_duration_remaining as flashDurationRemaining',
    ])
    .orderBy('k.killer_steam_id')
    .orderBy('k.tick')
    .execute();

  type KillRow = (typeof rows)[number];
  const killsBySteamId = new Map<string, { playerName: string; kills: KillRow[] }>();
  for (const row of rows) {
    let player = killsBySteamId.get(row.playerSteamId as string);
    if (player === undefined) {
      player = { playerName: row.playerName, kills: [] };
      killsBySteamId.set(row.playerSteamId as string, player);
    }
    player.kills.push(row);
  }

  const suspicions: AntiFlashSuspicion[] = [];
  for (const [playerSteamId, player] of killsBySteamId) {
    const killCount = player.kills.length;
    const flashedKills = player.kills.filter((kill) => {
      return kill.flashDurationRemaining > FLASH_DURATION_REMAINING_THRESHOLD_SECONDS;
    });
    const maxFlashDurationAtKill = player.kills.reduce((max, kill) => {
      return Math.max(max, kill.flashDurationRemaining);
    }, 0);

    // Representative moment = the kill with the most remaining blindness.
    const mostFlashedKill = player.kills.reduce((best, kill) => {
      return kill.flashDurationRemaining > best.flashDurationRemaining ? kill : best;
    }, player.kills[0]);

    const { flashedKillCount, isFlagged } = computeAntiFlashSuspicion(killCount, flashedKills.length);

    // One moment per flashed kill (only for flagged players), most-flashed first. Label names the
    // victim and the blindness left, e.g. "Round 6 · killed LuChik · flashed 2.4s".
    let moments: DetectionMoment[] = [];
    if (isFlagged) {
      moments = flashedKills
        .toSorted((a, b) => b.flashDurationRemaining - a.flashDurationRemaining || a.tick - b.tick)
        .map((kill) => {
          return {
            tick: kill.tick,
            roundNumber: kill.roundNumber,
            label: `Round ${kill.roundNumber} · killed ${kill.victimName} · flashed ${kill.flashDurationRemaining.toFixed(1)}s`,
          };
        })
        .slice(0, MAX_DETECTION_MOMENTS);
    }

    suspicions.push({
      playerSteamId,
      playerName: player.playerName,
      killCount,
      flashedKillCount,
      maxFlashDurationAtKill,
      tick: mostFlashedKill.tick,
      roundNumber: mostFlashedKill.roundNumber,
      moments,
      isFlagged,
    });
  }

  suspicions.sort((a, b) => a.playerSteamId.localeCompare(b.playerSteamId));

  return suspicions;
}
