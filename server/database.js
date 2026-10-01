import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
export function openDatabase(
  filename = resolve(process.env.BUDGET_DATA_DIR || '.local-data', 'budgets.sqlite'),
) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename);
  if (filename !== ':memory:') chmodSync(filename, 0o600);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS budgets(id TEXT PRIMARY KEY, name TEXT NOT NULL, createdAt TEXT NOT NULL, isDemo INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS groups(id TEXT PRIMARY KEY, budgetId TEXT NOT NULL REFERENCES budgets(id) ON DELETE CASCADE, name TEXT NOT NULL, position INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY, budgetId TEXT NOT NULL REFERENCES budgets(id) ON DELETE CASCADE, name TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('checking','savings','cash','credit','investment')), openingBalance INTEGER NOT NULL, openingDate TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS categories(id TEXT PRIMARY KEY, budgetId TEXT NOT NULL REFERENCES budgets(id) ON DELETE CASCADE, groupId TEXT NOT NULL REFERENCES groups(id), name TEXT NOT NULL, target INTEGER NOT NULL DEFAULT 0, position INTEGER NOT NULL, accountId TEXT REFERENCES accounts(id));
    CREATE TABLE IF NOT EXISTS transactions(id TEXT PRIMARY KEY, budgetId TEXT NOT NULL REFERENCES budgets(id) ON DELETE CASCADE, accountId TEXT NOT NULL REFERENCES accounts(id), date TEXT NOT NULL, payee TEXT NOT NULL, categoryId TEXT REFERENCES categories(id), amount INTEGER NOT NULL, memo TEXT NOT NULL DEFAULT '', cleared INTEGER NOT NULL DEFAULT 0, transferId TEXT, importKey TEXT);
    CREATE TABLE IF NOT EXISTS assignments(budgetId TEXT NOT NULL REFERENCES budgets(id) ON DELETE CASCADE, categoryId TEXT NOT NULL REFERENCES categories(id), month TEXT NOT NULL, amount INTEGER NOT NULL, PRIMARY KEY(budgetId,categoryId,month));
    CREATE INDEX IF NOT EXISTS tx_budget_date ON transactions(budgetId,date);
    CREATE INDEX IF NOT EXISTS tx_import ON transactions(budgetId,accountId,importKey);
  `);
  const accountsSchema = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='accounts'")
    .get().sql;
  if (!accountsSchema.includes("'investment'")) {
    // Rebuild the CHECK constraint without cascading into categories or transactions.
    // Preserve rowids because account creation order determines card funding priority.
    db.exec('PRAGMA foreign_keys=OFF');
    try {
      atomic(db, () => {
        db.exec(`
          CREATE TABLE accounts_next(id TEXT PRIMARY KEY, budgetId TEXT NOT NULL REFERENCES budgets(id) ON DELETE CASCADE, name TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('checking','savings','cash','credit','investment')), openingBalance INTEGER NOT NULL, openingDate TEXT NOT NULL);
          INSERT INTO accounts_next(rowid,id,budgetId,name,type,openingBalance,openingDate) SELECT rowid,id,budgetId,name,type,openingBalance,openingDate FROM accounts;
          DROP TABLE accounts;
          ALTER TABLE accounts_next RENAME TO accounts;
        `);
        if (db.prepare('PRAGMA foreign_key_check').all().length)
          throw new Error('Account migration failed its reference checks.');
      });
    } finally {
      db.exec('PRAGMA foreign_keys=ON');
    }
  }
  return db;
}
export function atomic(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
export function readBudget(db, id) {
  const budget = db.prepare('SELECT * FROM budgets WHERE id=?').get(id);
  if (!budget) throw Object.assign(new Error('Budget not found.'), { status: 404 });
  return {
    budget,
    groups: db.prepare('SELECT * FROM groups WHERE budgetId=? ORDER BY position,rowid').all(id),
    categories: db
      .prepare('SELECT * FROM categories WHERE budgetId=? ORDER BY position,rowid')
      .all(id),
    accounts: db.prepare('SELECT * FROM accounts WHERE budgetId=? ORDER BY rowid').all(id),
    transactions: db
      .prepare('SELECT * FROM transactions WHERE budgetId=? ORDER BY date DESC,rowid DESC')
      .all(id),
    assignments: db.prepare('SELECT * FROM assignments WHERE budgetId=?').all(id),
  };
}
