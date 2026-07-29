import fs from 'node:fs';
import path from 'node:path';

describe('production migration manifest', () => {
  const serverRoot = path.resolve(__dirname, '../..');
  const journal = JSON.parse(
    fs.readFileSync(path.join(serverRoot, 'drizzle/meta/_journal.json'), 'utf8')
  ) as {
    entries: Array<{ idx: number; tag: string }>;
  };

  it('includes a SQL file for every journal entry', () => {
    for (const entry of journal.entries) {
      expect(fs.existsSync(path.join(serverRoot, 'drizzle', `${entry.tag}.sql`))).toBe(true);
    }
  });

  it('ends with the durable turn schema reconciliation', () => {
    const latest = journal.entries.at(-1);
    expect(latest).toEqual(
      expect.objectContaining({
        idx: 20,
        tag: '0020_reconcile_durable_turn_schema',
      })
    );

    const sql = fs.readFileSync(
      path.join(serverRoot, 'drizzle/0020_reconcile_durable_turn_schema.sql'),
      'utf8'
    );
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "processing_owner" varchar(100)');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "processing_lease_expires_at" timestamp');
  });
});
