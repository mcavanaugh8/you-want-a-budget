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

test('group ordering persists, rejects incomplete or foreign lists, and survives backup restore', async (t) => {
  const { request, path } = await setup(t);
  const initial = (await request(path)).body;
  const groupIds = initial.groups.map((g) => g.id).reverse();
  assert.equal((await request(path + '/groups/order', 'PUT', { groupIds })).status, 200);
  assert.deepEqual(
    (await request(path)).body.groups.map((g) => g.id),
    groupIds,
  );
  for (const invalid of [
    groupIds.slice(1),
    [...groupIds.slice(1), groupIds[1]],
    [...groupIds.slice(1), 'foreign'],
  ]) {
    assert.equal((await request(path + '/groups/order', 'PUT', { groupIds: invalid })).status, 400);
    assert.deepEqual(
      (await request(path)).body.groups.map((g) => g.id),
      groupIds,
    );
  }
  const restored = await request('/restore', 'POST', (await request(path + '/export')).body);
  assert.equal(restored.status, 201);
  assert.deepEqual(
    restored.body.groups.map((g) => g.name),
    initial.groups.map((g) => g.name).reverse(),
  );
  await request(path + '/groups', 'POST', { name: 'Appended group' });
  assert.equal((await request(path)).body.groups.at(-1).name, 'Appended group');
});

test('deleting a funded group moves its categories without altering money or transaction history', async (t) => {
  const { request, path } = await setup(t);
  await request(path + '/accounts', 'POST', {
    name: 'Cash',
    type: 'cash',
    openingDate: '2026-01-01',
    openingBalance: 100000,
  });
  const before = (await request(path)).body;
  const source = before.groups[0],
    target = before.groups[1],
    category = before.categories.find((c) => c.groupId === source.id);
  await request(path + '/assignments', 'PUT', {
    categoryId: category.id,
    month: '2026-01',
    amount: 20000,
  });
  await request(path + '/transactions', 'POST', {
    accountId: before.accounts[0].id,
    date: '2026-01-02',
    payee: 'Market',
    categoryId: category.id,
    amount: -4500,
  });
  const funded = (await request(path)).body;
  assert.equal((await request(path + '/groups/' + source.id, 'DELETE', {})).status, 400);
  assert.equal(
    (await request(path + '/groups/' + source.id, 'DELETE', { targetGroupId: source.id })).status,
    400,
  );
  const foreign = (await request('/budgets', 'POST', { name: 'Other' })).body.groups[0].id;
  assert.equal(
    (await request(path + '/groups/' + source.id, 'DELETE', { targetGroupId: foreign })).status,
    400,
  );
  assert.equal(
    (await request(path + '/groups/' + source.id, 'DELETE', { targetGroupId: target.id })).status,
    200,
  );
  const after = (await request(path)).body;
  assert.equal(
    after.groups.some((g) => g.id === source.id),
    false,
  );
  assert.equal(after.categories.length, funded.categories.length);
  assert.equal(after.categories.find((c) => c.id === category.id).groupId, target.id);
  assert.deepEqual(after.transactions, funded.transactions);
  assert.deepEqual(after.assignments, funded.assignments);
  for (const month of ['2026-01', '2026-02']) {
    const a = calculateBudget(funded, month),
      b = calculateBudget(after, month);
    assert.equal(a.ready, b.ready);
    assert.deepEqual(
      Object.fromEntries(a.rows.map((c) => [c.id, c.available])),
      Object.fromEntries(b.rows.map((c) => [c.id, c.available])),
    );
  }
});

test('empty groups can be deleted and card payment categories can move into a new group', async (t) => {
  const { request, path } = await setup(t);
  await request(path + '/groups', 'POST', { name: 'Empty' });
  const empty = (await request(path)).body.groups.find((g) => g.name === 'Empty');
  assert.equal((await request(path + '/groups/' + empty.id, 'DELETE')).status, 200);
  await request(path + '/accounts', 'POST', {
    name: 'Card',
    type: 'credit',
    openingDate: '2026-01-01',
    openingBalance: -2000,
  });
  const before = (await request(path)).body;
  const payment = before.categories.find((c) => c.accountId);
  assert.equal(
    (await request(path + '/groups/' + payment.groupId, 'DELETE', { newGroupName: '  ' })).status,
    400,
  );
  assert.equal((await request(path)).body.groups.length, before.groups.length);
  assert.equal(
    (
      await request(path + '/groups/' + payment.groupId, 'DELETE', {
        newGroupName: 'Debt payments',
      })
    ).status,
    200,
  );
  const after = (await request(path)).body;
  assert.equal(after.categories.find((c) => c.id === payment.id).accountId, payment.accountId);
  assert.equal(
    after.groups.find((g) => g.id === after.categories.find((c) => c.id === payment.id).groupId)
      .name,
    'Debt payments',
  );
});

async function paymentBudget(t) {
  const context = await setup(t);
  const { request, path } = context;
  await request(path + '/accounts', 'POST', {
    name: 'Checking',
    type: 'checking',
    openingDate: '2026-01-01',
    openingBalance: 100000,
  });
  await request(path + '/accounts', 'POST', {
    name: 'Card',
    type: 'credit',
    openingDate: '2026-01-01',
    openingBalance: -20000,
  });
  const data = (await request(path)).body;
  await request(path + '/assignments', 'PUT', {
    categoryId: data.categories.find((c) => c.accountId).id,
    month: '2026-01',
    amount: 20000,
  });
  return { ...context, data, cash: data.accounts[0].id, card: data.accounts[1].id };
}

test('card payment flag creates paired category-free entries and only uses payment reserves', async (t) => {
  const { request, path, data, cash, card } = await paymentBudget(t);
  const result = await request(path + '/transactions', 'POST', {
    accountId: cash,
    date: '2026-01-02',
    payee: 'Card payment',
    amount: -5000,
    isCardPayment: true,
    paymentAccountId: card,
    categoryId: data.categories[0].id,
    cleared: true,
  });
  assert.equal(result.status, 201);
  const after = (await request(path)).body;
  assert.equal(after.transactions.length, 2);
  assert.ok(after.transactions.every((t) => t.categoryId === null && t.transferId));
  assert.equal(new Set(after.transactions.map((t) => t.transferId)).size, 1);
  const snapshot = calculateBudget(after, '2026-01');
  assert.equal(snapshot.spending, 0);
  assert.equal(snapshot.income, 0);
  assert.equal(snapshot.uncategorized, 0);
  assert.equal(snapshot.ready, 80000);
  assert.equal(snapshot.rows.find((c) => c.accountId === card).available, 15000);
  assert.equal(snapshot.accounts.find((a) => a.id === cash).balance, 95000);
  assert.equal(snapshot.accounts.find((a) => a.id === card).balance, -15000);
  const restored = await request('/restore', 'POST', (await request(path + '/export')).body);
  assert.equal(restored.status, 201);
  assert.equal(restored.body.transactions.filter((t) => t.transferId && !t.categoryId).length, 2);
});

test('flagging imported card-side payment links existing cash entry without duplicating either account', async (t) => {
  const { request, path, data, cash, card } = await paymentBudget(t);
  await request(path + '/transactions', 'POST', {
    accountId: cash,
    date: '2026-01-02',
    payee: 'Autopay',
    amount: -5000,
    categoryId: data.categories[0].id,
    cleared: true,
  });
  await request(path + '/transactions', 'POST', {
    accountId: card,
    date: '2026-01-02',
    payee: 'Payment received',
    amount: 5000,
    cleared: true,
  });
  const before = (await request(path)).body;
  const source = before.transactions.find((t) => t.accountId === card),
    matching = before.transactions.find((t) => t.accountId === cash);
  const beforeBalances = calculateBudget(before, '2026-01').accounts.map((a) => a.balance);
  assert.equal(
    (
      await request(path + '/transactions/' + source.id, 'PATCH', {
        ...source,
        isCardPayment: true,
        paymentAccountId: cash,
        matchingTransactionId: matching.id,
      })
    ).status,
    200,
  );
  const after = (await request(path)).body;
  assert.equal(after.transactions.length, 2);
  assert.deepEqual(
    after.transactions.map((t) => t.id),
    before.transactions.map((t) => t.id),
  );
  assert.deepEqual(
    calculateBudget(after, '2026-01').accounts.map((a) => a.balance),
    beforeBalances,
  );
  assert.ok(after.transactions.every((t) => !t.categoryId && t.transferId && t.cleared));
  assert.equal(calculateBudget(after, '2026-01').spending, 0);
  await request(path + '/transactions/' + source.id, 'DELETE');
  assert.equal((await request(path)).body.transactions.length, 0);
});

test('invalid card payment flags and mismatched links leave transactions unchanged', async (t) => {
  const { request, path, cash, card } = await paymentBudget(t);
  const valid = {
    accountId: cash,
    date: '2026-01-02',
    payee: 'Payment',
    amount: -5000,
    isCardPayment: true,
    paymentAccountId: card,
  };
  for (const input of [
    { ...valid, paymentAccountId: cash },
    { ...valid, amount: 5000 },
    { ...valid, matchingTransactionId: 'missing' },
    { ...valid, date: '2025-12-31' },
  ])
    assert.equal((await request(path + '/transactions', 'POST', input)).status, 400);
  assert.equal((await request(path)).body.transactions.length, 0);
  await request(path + '/transactions', 'POST', {
    accountId: card,
    date: '2026-01-02',
    payee: 'Different payment',
    amount: 3000,
  });
  const other = (await request(path)).body.transactions[0];
  assert.equal(
    (await request(path + '/transactions', 'POST', { ...valid, matchingTransactionId: other.id }))
      .status,
    400,
  );
  assert.deepEqual((await request(path)).body.transactions, [other]);
});
