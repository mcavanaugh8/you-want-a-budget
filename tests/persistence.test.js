import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, readBudget } from '../server/database.js';
test('budget records survive closing and reopening the on-disk SQLite database', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ywab-persistence-'));
  const path = join(dir, 'budgets.sqlite');
  let db = openDatabase(path);
  try {
    db.prepare('INSERT INTO budgets VALUES(?,?,?,?)').run(
      'persisted',
      'My budget',
      new Date().toISOString(),
      0,
    );
    db.prepare('INSERT INTO accounts VALUES(?,?,?,?,?,?)').run(
      'cash',
      'persisted',
      'Checking',
      'checking',
      123456,
      '2026-01-01',
    );
    db.close();
    db = openDatabase(path);
    const data = readBudget(db, 'persisted');
    assert.equal(data.budget.name, 'My budget');
    assert.equal(data.accounts[0].openingBalance, 123456);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
