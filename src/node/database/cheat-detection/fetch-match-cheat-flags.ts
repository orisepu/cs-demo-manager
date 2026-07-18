import { fetchAntiAimSuspicions } from 'csdm/node/database/anti-aim/fetch-anti-aim-suspicions';
import { fetchSpinbotSuspicions } from 'csdm/node/database/spinbot/fetch-spinbot-suspicions';
import { fetchAntiFlashSuspicions } from 'csdm/node/database/anti-flash/fetch-anti-flash-suspicions';
import { fetchSmokeTrackingSuspicions } from 'csdm/node/database/smoke-tracking/fetch-smoke-tracking-suspicions';
import { fetchAimToggleSuspicions } from 'csdm/node/database/aim-toggle/fetch-aim-toggle-suspicions';
import type { PlayerCheatFlags } from 'csdm/common/types/match-cheat-flags';
import { isTriageDetector } from './triage-detectors';

// Detector identifiers paired with the human-readable name surfaced in the UI tooltip. Kept next to
// the aggregation so the wording of a detector lives in a single place. The id is what ties a
// detector to its confidence tier (see triage-detectors.ts).
const DETECTOR = {
  antiAim: { id: 'anti-aim', name: 'Anti-aim' },
  spinbot: { id: 'spinbot', name: 'Spinbot' },
  antiFlash: { id: 'anti-flash', name: 'Anti-flash' },
  smokeTracking: { id: 'smoke-tracking', name: 'Smoke tracking' },
  aimToggle: { id: 'aim-toggle', name: 'Aim toggle' },
} as const;

type Detector = (typeof DETECTOR)[keyof typeof DETECTOR];

type FlaggableSuspicion = {
  playerSteamId: string;
  isFlagged: boolean;
};

// Aggregates the cheat detectors for a match into a per-player list of the detectors that flagged
// each player. The SQL-based detectors run on every call; smoke tracking computes once then serves
// cached rows. Only players flagged by at least one detector are returned. Within each player the
// proof-grade detectors are listed before triage-grade ones (statistical review hints such as
// aim-toggle) so the strongest signals read first.
export async function fetchMatchCheatFlags(checksum: string): Promise<PlayerCheatFlags[]> {
  const [antiAimSuspicions, spinbotSuspicions, antiFlashSuspicions, smokeTrackingSuspicions, aimToggleSuspicions] =
    await Promise.all([
      fetchAntiAimSuspicions(checksum),
      fetchSpinbotSuspicions(checksum),
      fetchAntiFlashSuspicions(checksum),
      fetchSmokeTrackingSuspicions(checksum),
      fetchAimToggleSuspicions(checksum),
    ]);

  const flaggedDetectorsBySteamId = new Map<string, Detector[]>();

  const collect = (suspicions: FlaggableSuspicion[], detector: Detector) => {
    for (const suspicion of suspicions) {
      if (!suspicion.isFlagged) {
        continue;
      }

      const detectors = flaggedDetectorsBySteamId.get(suspicion.playerSteamId);
      if (detectors === undefined) {
        flaggedDetectorsBySteamId.set(suspicion.playerSteamId, [detector]);
      } else {
        detectors.push(detector);
      }
    }
  };

  collect(antiAimSuspicions, DETECTOR.antiAim);
  collect(spinbotSuspicions, DETECTOR.spinbot);
  collect(antiFlashSuspicions, DETECTOR.antiFlash);
  collect(smokeTrackingSuspicions, DETECTOR.smokeTracking);
  collect(aimToggleSuspicions, DETECTOR.aimToggle);

  const cheatFlags: PlayerCheatFlags[] = [];
  for (const [steamId, detectors] of flaggedDetectorsBySteamId) {
    const flaggedBy = detectors
      .toSorted((a, b) => Number(isTriageDetector(a.id)) - Number(isTriageDetector(b.id)))
      .map((detector) => detector.name);
    cheatFlags.push({ steamId, flaggedBy });
  }

  return cheatFlags;
}
