// A single incriminating moment surfaced by a cheat detector for a flagged player. The UI renders one
// clickable entry per moment and jumps the 2D viewer to `tick` inside `roundNumber` when clicked.
// `label` is server-built display text (round numbers, player names, metrics) and is NOT translated.
export type DetectionMoment = {
  tick: number;
  roundNumber: number;
  label: string;
};

// Upper bound on the number of moments surfaced per flagged player. A detector that finds more keeps
// only the most relevant ones (the UI notes the list was capped).
export const MAX_DETECTION_MOMENTS = 20;
