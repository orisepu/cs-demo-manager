// Detector confidence tiers.
//
// A TRIAGE detector emits a STATISTICAL signal, not proof. The pattern it flags can occur
// legitimately, so a flag means "a human should review this player", never "this player cheated".
// Triage detectors are kept in this explicit list so the players-list aggregation can surface them
// after the proof-grade detectors and so future ban-data calibration can weight them accordingly.
//
// `aim-toggle` is triage-grade: intra-player headshot-rate bimodality (a mediocre overall baseline
// plus one isolated near-perfect round) is consistent with toggling a headshot aimbot on and off,
// but a single genuinely lucky round can produce the same shape. Pending ban-data calibration it is
// a review hint only.
// `aim-outlier` is triage-grade: a strong headshot-rate or accuracy outlier versus the match median
// is consistent with an aimbot, but an elite legit player can produce the same statistical shape.
// Pending ban-data calibration it is a review hint only.
export const TRIAGE_DETECTORS = ['aim-toggle', 'aim-outlier'] as const;

export type TriageDetectorId = (typeof TRIAGE_DETECTORS)[number];

export function isTriageDetector(detectorId: string): detectorId is TriageDetectorId {
  return (TRIAGE_DETECTORS as readonly string[]).includes(detectorId);
}
