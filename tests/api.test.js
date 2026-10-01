import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, readBudget } from '../server/database.js';
import { createApp } from '../server/app.js';
import { calculateBudget } from '../shared/budget.js';
async function setup(t) {
  const db = openDatabase(':memory:');
  const server = createApp(db).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  t.after(() => {
    server.close();
    db.close();
  });
  const request = async (path, method = 'GET', body) => {
    const r = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, body: await r.json() };
  };
  const { body: d } = await request('/budgets', 'POST', { name: 'Test budget' });
  return { request, db, id: d.budget.id, path: '/budgets/' + d.budget.id };
}
test('SQLite budget persistence, assignment, transfer and JSON restore roundtrip', async (t) => {
  const { request, db, id, path } = await setup(t);
  await request(path + '/accounts', 'POST', {
    name: 'Checking',
    type: 'checking',
    openingDate: '2026-01-01',
    openingBalance: 100000,
  });
  await request(path + '/accounts', 'POST', {
    name: 'Savings',
    type: 'savings',
    openingDate: '2026-01-01',
    openingBalance: 20000,
  });
  let { body: d } = await request(path);
  const c = d.categories[0];
  assert.equal(
    (
      await request(path + '/assignments', 'PUT', {
        categoryId: c.id,
        month: '2026-01',
        amount: 10000,
      })
    ).status,
    200,
  );
  await request(path + '/transactions', 'POST', {
    accountId: d.accounts[0].id,
    date: '2026-01-10',
    payee: 'Market',
    categoryId: c.id,
    amount: -2500,
  });
  await request(path + '/transfers', 'POST', {
    from: d.accounts[0].id,
    to: d.accounts[1].id,
    date: '2026-01-11',
    amount: 5000,
  });
  const backup = (await request(path + '/export')).body;
  assert.equal(backup.transactions.length, 3);
  const restored = await request('/restore', 'POST', backup);
  assert.equal(restored.status, 201);
  assert.notEqual(restored.body.budget.id, id);
  assert.equal(restored.body.transactions.length, 3);
  const a = calculateBudget(readBudget(db, id), '2026-02'),
    b = calculateBudget(restored.body, '2026-02');
  assert.equal(a.ready, b.ready);
  assert.deepEqual(
    a.rows.map((c) => c.available),
    b.rows.map((c) => c.available),
  );
  assert.equal(b.ready, 110000);
  assert.equal(b.rows[0].available, 7500);
});
test('duplicate imports are skipped, legitimate repeats preserved, and invalid batches roll back', async (t) => {
  const { request, path } = await setup(t);
  await request(path + '/accounts', 'POST', {
    name: 'Checking',
    type: 'checking',
    openingDate: '2026-01-01',
    openingBalance: 100000,
  });
  const d = (await request(path)).body,
    accountId = d.accounts[0].id;
  const row = { date: '2026-01-02', payee: 'Coffee', amount: -500 };
  let r = await request(path + '/import', 'POST', { accountId, rows: [row, row] });
  assert.equal(r.body.imported, 2);
  r = await request(path + '/import', 'POST', { accountId, rows: [row, row] });
  assert.equal(r.body.skipped, 2);
  r = await request(path + '/import', 'POST', {
    accountId,
    rows: [
      { ...row, payee: 'New' },
      { ...row, date: 'bad' },
    ],
  });
  assert.equal(r.status, 400);
  assert.equal((await request(path)).body.transactions.length, 2);
});
test('move money updates both categories atomically and forbids overspending source', async (t) => {
  const { request, path } = await setup(t);
  await request(path + '/accounts', 'POST', {
    name: 'Cash',
    type: 'cash',
    openingDate: '2026-01-01',
    openingBalance: 50000,
  });
  const d = (await request(path)).body;
  await request(path + '/move', 'POST', {
    from: 'ready',
    to: d.categories[0].id,
    month: '2026-01',
    amount: 10000,
  });
  const move = { from: d.categories[0].id, to: d.categories[1].id, month: '2026-01', amount: 5000 };
  assert.equal((await request(path + '/move', 'POST', move)).status, 200);
  assert.equal((await request(path + '/move', 'POST', { ...move, amount: 6000 })).status, 400);
  const s = calculateBudget((await request(path)).body, '2026-02');
  assert.equal(s.rows[0].available, 5000);
  assert.equal(s.rows[1].available, 5000);
  assert.equal(s.ready, 40000);
});
test('deleting one transfer removes both legs', async (t) => {
  const { request, path } = await setup(t);
  for (const type of ['checking', 'credit'])
    await request(path + '/accounts', 'POST', {
      name: type,
      type,
      openingDate: '2026-01-01',
      openingBalance: type === 'checking' ? 100000 : -5000,
    });
  const d = (await request(path)).body;
  await request(path + '/transfers', 'POST', {
    from: d.accounts[0].id,
    to: d.accounts[1].id,
    date: '2026-01-02',
    amount: 5000,
  });
  const before = (await request(path)).body;
  assert.equal(before.transactions.length, 2);
  await request(path + '/transactions/' + before.transactions[0].id, 'DELETE');
  assert.equal((await request(path)).body.transactions.length, 0);
});
test('failed restore does not create a partial budget', async (t) => {
  const { request, path } = await setup(t);
  const backup = (await request(path + '/export')).body;
  backup.assignments = [{ categoryId: 'missing', month: '2026-01', amount: 10 }];
  const r = await request('/restore', 'POST', backup);
  assert.equal(r.status, 400);
  assert.equal((await request('/budgets')).body.length, 1);
});
test('cross-budget references and dates before opening balances are rejected', async (t) => {
  const { request, path } = await setup(t);
  const other = (await request('/budgets', 'POST', { name: 'Other' })).body;
  await request(path + '/accounts', 'POST', {
    name: 'Cash',
    type: 'cash',
    openingDate: '2026-01-01',
    openingBalance: 0,
  });
  const d = (await request(path)).body;
  assert.equal(
    (
      await request(path + '/transactions', 'POST', {
        accountId: d.accounts[0].id,
        date: '2026-01-01',
        payee: 'x',
        amount: -100,
        categoryId: other.categories[0].id,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(path + '/transactions', 'POST', {
        accountId: d.accounts[0].id,
        date: '2025-01-01',
        payee: 'x',
        amount: -100,
      })
    ).status,
    400,
  );
});
test('demo is explicit and has realistic account/category data', async (t) => {
  const { request } = await setup(t);
  const r = await request('/budgets', 'POST', { name: 'Demo', demo: true });
  assert.equal(r.status, 201);
  assert.equal(r.body.budget.isDemo, 1);
  assert.equal(r.body.accounts.length, 3);
  assert.equal(r.body.transactions.length, 7);
});
