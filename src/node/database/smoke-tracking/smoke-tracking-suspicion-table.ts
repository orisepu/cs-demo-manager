import type { Generated, JSONColumnType, Selectable } from 'kysely';
import type { ColumnID } from 'csdm/common/types/column-id';
import type { DetectionMoment } from 'csdm/common/types/detection-moment';

// Cached results of the (heavy) smoke-tracking wallhack computation. One row per player per match.
// Rows are written once, the first time the detector runs for a match, and served from cache on
// every subsequent open. They are removed automatically when the match is deleted (FK cascade).
export type SmokeTrackingSuspicionTable = {
  id: Generated<ColumnID>;
  match_checksum: string;
  player_steam_id: string;
  player_name: string;
  window_count: number;
  representative_tick: number;
  round_number: number;
  // One entry per qualifying window (only for flagged players). Stored as jsonb; read back as an
  // already-parsed array, inserted/updated as a JSON string (see JSONColumnType).
  moments: JSONColumnType<DetectionMoment[], string, string>;
  is_flagged: boolean;
};

export type SmokeTrackingSuspicionRow = Selectable<SmokeTrackingSuspicionTable>;
