import type { Migration } from './migration';

const v13: Migration = {
  schemaVersion: 13,
  run: async (transaction) => {
    // Player positions exported the horizontal view angle (yaw) but not the
    // vertical one (pitch). The analyzer now exports pitch too (see the
    // upstream cs-demo-analyzer change), so add the column to store it.
    // Existing rows predate the column, so it defaults to 0.
    await transaction.schema
      .alterTable('player_positions')
      .addColumn('pitch', 'double precision', (col) => col.notNull().defaultTo(0))
      .execute();
  },
};

export default v13;
