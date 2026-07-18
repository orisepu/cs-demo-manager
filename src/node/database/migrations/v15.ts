import { sql } from 'kysely';
import type { Migration } from './migration';

const v15: Migration = {
  schemaVersion: 15,
  run: async (transaction) => {
    // The smoke-tracking detector now surfaces every qualifying window as a distinct "moment" the UI
    // can jump to, not just one representative tick. Because the detector's results are cached (the
    // computation is heavy), the per-window moments are persisted alongside the existing aggregate
    // columns as a jsonb array. Rows written before this migration get an empty array; they are
    // recomputed lazily the next time their match is opened (the cache is keyed per match).
    await transaction.schema
      .alterTable('smoke_tracking_suspicions')
      .addColumn('moments', 'jsonb', (col) => col.notNull().defaultTo(sql`'[]'::jsonb`))
      .execute();
  },
};

export default v15;
