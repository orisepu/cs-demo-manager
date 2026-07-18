import type { Migration } from './migration';

const v14: Migration = {
  schemaVersion: 14,
  run: async (transaction) => {
    // Smoke-tracking is the heaviest wallhack detector: a cross-player, per-tick, geometric
    // computation. Unlike the light SQL detectors it cannot be re-run cheaply on every tab open, so
    // its results are cached here. The table is populated the first time the detector runs for a
    // match and read back instantly afterwards. Rows are cleaned up automatically when the match is
    // deleted, through the cascading foreign key.
    await transaction.schema
      .createTable('smoke_tracking_suspicions')
      .ifNotExists()
      .addColumn('id', 'bigserial', (col) => col.primaryKey().notNull())
      .addColumn('match_checksum', 'varchar', (col) => col.notNull())
      .addForeignKeyConstraint(
        'smoke_tracking_suspicions_match_checksum_fk',
        ['match_checksum'],
        'matches',
        ['checksum'],
        (cb) => cb.onDelete('cascade'),
      )
      .addColumn('player_steam_id', 'varchar', (col) => col.notNull())
      .addColumn('player_name', 'varchar', (col) => col.notNull())
      .addColumn('window_count', 'integer', (col) => col.notNull())
      .addColumn('representative_tick', 'integer', (col) => col.notNull())
      .addColumn('round_number', 'integer', (col) => col.notNull())
      .addColumn('is_flagged', 'boolean', (col) => col.notNull())
      .execute();

    await transaction.schema
      .createIndex('smoke_tracking_suspicions_match_checksum_idx')
      .ifNotExists()
      .on('smoke_tracking_suspicions')
      .column('match_checksum')
      .execute();
  },
};

export default v14;
