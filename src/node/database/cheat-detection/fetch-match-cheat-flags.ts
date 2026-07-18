import { fetchAntiAimSuspicions } from 'csdm/node/database/anti-aim/fetch-anti-aim-suspicions';
import { fetchSpinbotSuspicions } from 'csdm/node/database/spinbot/fetch-spinbot-suspicions';
import { fetchAntiFlashSuspicions } from 'csdm/node/database/anti-flash/fetch-anti-flash-suspicions';
import { fetchSmokeTrackingSuspicions } from 'csdm/node/database/smoke-tracking/fetch-smoke-tracking-suspicions';
import type { PlayerCheatFlags } from 'csdm/common/types/match-cheat-flags';

// Human-readable detector names surfaced in the UI tooltip. Kept next to the aggregation so the
// wording of a detector lives in a single place.
const DETECTOR_NAME = {
  antiAim: 'Anti-aim',
  spinbot: 'Spinbot',
  antiFlash: 'Anti-flash',
  smokeTracking: 'Smoke tracking',
} as const;

type FlaggableSuspicion = {
  playerSteamId: string;
  isFlagged: boolean;
};

// Aggregates the four existing cheat detectors for a match into a per-player list of the detectors
// that flagged each player. The three SQL-based detectors run on every call; smoke tracking computes
// once then serves cached rows. Only players flagged by at least one detector are returned.
export async function fetchMatchCheatFlags(checksum: string): Promise<PlayerCheatFlags[]> {
  const [antiAimSuspicions, spinbotSuspicions, antiFlashSuspicions, smokeTrackingSuspicions] = await Promise.all([
    fetchAntiAimSuspicions(checksum),
    fetchSpinbotSuspicions(checksum),
    fetchAntiFlashSuspicions(checksum),
    fetchSmokeTrackingSuspicions(checksum),
  ]);

  const flaggedByBySteamId = new Map<string, string[]>();

  const collect = (suspicions: FlaggableSuspicion[], detectorName: string) => {
    for (const suspicion of suspicions) {
      if (!suspicion.isFlagged) {
        continue;
      }

      const flaggedBy = flaggedByBySteamId.get(suspicion.playerSteamId);
      if (flaggedBy === undefined) {
        flaggedByBySteamId.set(suspicion.playerSteamId, [detectorName]);
      } else {
        flaggedBy.push(detectorName);
      }
    }
  };

  collect(antiAimSuspicions, DETECTOR_NAME.antiAim);
  collect(spinbotSuspicions, DETECTOR_NAME.spinbot);
  collect(antiFlashSuspicions, DETECTOR_NAME.antiFlash);
  collect(smokeTrackingSuspicions, DETECTOR_NAME.smokeTracking);

  const cheatFlags: PlayerCheatFlags[] = [];
  for (const [steamId, flaggedBy] of flaggedByBySteamId) {
    cheatFlags.push({ steamId, flaggedBy });
  }

  return cheatFlags;
}
