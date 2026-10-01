import express from 'express';
import { randomUUID } from 'node:crypto';
import { atomic, readBudget } from './database.js';
import { calculateBudget } from '../shared/budget.js';
import { validDate, validMonth, today, nextMonth } from '../shared/money.js';
import { markDuplicates } from '../shared/csv.js';
import { ACCOUNT_TYPES, isCashAccount } from '../shared/accounts.js';
const id = () => randomUUID();
const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
const name = (v, label = 'Name') => {
  if (typeof v !== 'string' || !v.trim() || v.trim().length > 200)
    fail(`${label} must be between 1 and 200 characters.`);
  return v.trim();
};
const amount = (v) => {
  if (!Number.isSafeInteger(v) || Math.abs(v) > 100_000_000_000) fail('Invalid amount.');
  return v;
};
const date = (v) => {
  if (!validDate(v)) fail('Invalid date. Use YYYY-MM-DD (2000–2099).');
  return v;
};
const month = (v) => {
  if (!validMonth(v)) fail('Invalid month.');
  return v;
};
function group(db, budgetId, title, position = 0) {
  const key = id();
  db.prepare('INSERT INTO groups VALUES(?,?,?,?)').run(key, budgetId, name(title), position);
  return key;
}
function category(db, budgetId, groupId, title, target = 0, accountId = null, position = 0) {
  const key = id();
  db.prepare('INSERT INTO categories VALUES(?,?,?,?,?,?,?)').run(
    key,
    budgetId,
    groupId,
    name(title),
    amount(target),
    position,
    accountId,
  );
  return key;
}
function openingBalance(type, input) {
  const value = amount(input.openingBalance);
  if (type !== 'credit') return value;
  if (input.creditBalanceType && !['debt', 'credit'].includes(input.creditBalanceType))
    fail('Choose amount owed or credit balance.');
  return input.creditBalanceType === 'credit' ? Math.abs(value) : -Math.abs(value);
}
function addAccount(db, budgetId, input) {
  const key = id(),
    type = input.type;
  if (!ACCOUNT_TYPES.includes(type)) fail('Choose a valid account type.');
  db.prepare('INSERT INTO accounts VALUES(?,?,?,?,?,?)').run(
    key,
    budgetId,
    name(input.name),
    type,
    openingBalance(type, input),
    date(input.openingDate),
  );
  if (type === 'credit') {
    let g = db
      .prepare("SELECT id FROM groups WHERE budgetId=? AND name='Credit card payments'")
      .get(budgetId)?.id;
    if (!g) g = group(db, budgetId, 'Credit card payments', 99);
    category(db, budgetId, g, input.name, 0, key);
  }
  return key;
}
function setAssignment(db, budgetId, categoryId, m, value) {
  db.prepare(
    'INSERT INTO assignments VALUES(?,?,?,?) ON CONFLICT(budgetId,categoryId,month) DO UPDATE SET amount=excluded.amount',
  ).run(budgetId, categoryId, month(m), amount(value));
}
function validateTx(data, input) {
  const a = data.accounts.find((a) => a.id === input.accountId);
  if (!a) fail('Account not found.');
  const d = date(input.date);
  if (d < a.openingDate)
    fail(
      `Transaction predates ${a.name}'s opening balance. Change the account opening date or import more recent transactions.`,
    );
  const cat = a.type === 'investment' ? null : input.categoryId || null;
  if (cat && !data.categories.some((c) => c.id === cat && !c.accountId))
    fail('Choose a spending category. Use an account transfer for credit card payments.');
  if (
    typeof input.memo !== 'undefined' &&
    (typeof input.memo !== 'string' || input.memo.length > 2000)
  )
    fail('Memo must be under 2,000 characters.');
  const value = amount(input.amount);
  if (!value) fail('Transaction amount cannot be zero.');
  return {
    id: input.id || id(),
    budgetId: data.budget.id,
    accountId: a.id,
    date: d,
    payee: name(input.payee, 'Payee'),
    categoryId: cat,
    amount: value,
    memo: input.memo || '',
    cleared: input.cleared ? 1 : 0,
    transferId: null,
    importKey: typeof input.importKey === 'string' ? input.importKey.slice(0, 1000) : null,
  };
}
function insertTx(db, t) {
  db.prepare('INSERT INTO transactions VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(
    t.id,
    t.budgetId,
    t.accountId,
    t.date,
    t.payee,
    t.categoryId,
    t.amount,
    t.memo,
    t.cleared,
    t.transferId,
    t.importKey,
  );
}
function createTransfer(db, data, input) {
  const from = data.accounts.find((a) => a.id === input.from),
    to = data.accounts.find((a) => a.id === input.to);
  if (!from || !to || from.id === to.id) fail('Choose two different accounts.');
  if (from.type === 'credit') fail('Transfers cannot originate from a credit card.');
  if (from.type === 'investment' && to.type === 'credit')
    fail('Move investment funds to a cash account before paying a credit card.');
  if (isCashAccount(from) && to.type === 'investment' && !input.categoryId)
    fail('Choose a category for money leaving your budget for investments.');
  const value = amount(input.amount);
  if (value <= 0) fail('Transfer amount must be positive.');
  const transferId = id();
  for (const [a, peer, v] of [
    [from, to, -value],
    [to, from, value],
  ]) {
    const t = validateTx(data, {
      accountId: a.id,
      date: input.date,
      payee: `Transfer: ${peer.name}`,
      amount: v,
      memo: input.memo || '',
      cleared: input.cleared,
      categoryId: isCashAccount(a) && peer.type === 'investment' ? input.categoryId || null : null,
    });
    t.transferId = transferId;
    insertTx(db, t);
  }
}
function saveCardPayment(db, data, input, old = null) {
  const source = validateTx(data, { ...input, categoryId: null, id: old?.id });
  const account = data.accounts.find((a) => a.id === source.accountId);
  const other = data.accounts.find((a) => a.id === input.paymentAccountId);
  if (
    !other ||
    other.id === account.id ||
    account.type === 'investment' ||
    other.type === 'investment' ||
    (account.type === 'credit') === (other.type === 'credit')
  )
    fail('Choose one cash account and one credit card account for this payment.');
  if (
    (account.type === 'credit' && source.amount < 0) ||
    (account.type !== 'credit' && source.amount > 0)
  )
    fail('A card payment must leave a cash account and enter a credit card account.');
  const matching = input.matchingTransactionId
    ? data.transactions.find((t) => t.id === input.matchingTransactionId)
    : null;
  if (
    input.matchingTransactionId &&
    (!matching ||
      matching.id === old?.id ||
      matching.transferId ||
      matching.accountId !== other.id ||
      matching.amount !== -source.amount ||
      matching.date !== source.date)
  )
    fail(
      'The matching payment must be an unlinked transaction in the other account with the same date and opposite amount.',
    );
  const peer =
    matching ||
    validateTx(data, {
      accountId: other.id,
      date: source.date,
      payee: `Credit card payment: ${account.name}`,
      amount: -source.amount,
      memo: source.memo,
      cleared: false,
    });
  const transferId = id();
  atomic(db, () => {
    if (old) {
      const importKey =
        old.accountId === source.accountId &&
        old.date === source.date &&
        old.amount === source.amount &&
        old.payee === source.payee
          ? old.importKey
          : null;
      db.prepare(
        'UPDATE transactions SET accountId=?,date=?,payee=?,categoryId=NULL,amount=?,memo=?,cleared=?,transferId=?,importKey=? WHERE id=? AND budgetId=?',
      ).run(
        source.accountId,
        source.date,
        source.payee,
        source.amount,
        source.memo,
        source.cleared,
        transferId,
        importKey,
        old.id,
        data.budget.id,
      );
    } else insertTx(db, { ...source, transferId });
    if (matching)
      db.prepare(
        'UPDATE transactions SET categoryId=NULL,transferId=? WHERE id=? AND budgetId=?',
      ).run(transferId, matching.id, data.budget.id);
    else insertTx(db, { ...peer, transferId });
  });
}
export function createApp(db) {
  const app = express();
  app.disable('x-powered-by');
  // Local-only service: reject DNS rebinding and cross-origin mutations.
  app.use((req, res, next) => {
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(req.hostname))
      return res.status(403).json({ error: 'Local access only.' });
    if (req.headers.origin) {
      try {
        const u = new URL(req.headers.origin);
        if (u.host !== req.headers.host)
          return res.status(403).json({ error: 'Cross-origin requests are not allowed.' });
      } catch {
        return res.sendStatus(403);
      }
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.use('/api', express.json({ limit: '20mb' }));
  app.get('/api/budgets', (req, res) =>
    res.json(db.prepare('SELECT * FROM budgets ORDER BY createdAt DESC,rowid DESC').all()),
  );
  app.post('/api/budgets', (req, res) => {
    const budgetId = atomic(db, () => {
      const key = id();
      db.prepare('INSERT INTO budgets VALUES(?,?,?,?)').run(
        key,
        name(req.body.name),
        new Date().toISOString(),
        req.body.demo ? 1 : 0,
      );
      const defaults = [
        [
          'Everyday living',
          [
            ['Groceries', 50000],
            ['Dining out', 15000],
            ['Transportation', 12000],
          ],
        ],
        [
          'Monthly essentials',
          [
            ['Rent & mortgage', 180000],
            ['Utilities', 15000],
            ['Internet & phone', 10000],
            ['Subscriptions', 5000],
          ],
        ],
        [
          'Looking ahead',
          [
            ['Emergency fund', 100000],
            ['Travel', 20000],
            ['Gifts & celebrations', 7500],
          ],
        ],
        [
          'Just for you',
          [
            ['Fun money', 10000],
            ['Shopping', 10000],
          ],
        ],
      ];
      defaults.forEach(([title, cats], i) => {
        const g = group(db, key, title, i);
        cats.forEach(([title, target], j) => category(db, key, g, title, target, null, j));
      });
      if (req.body.demo) seedDemo(db, key);
      return key;
    });
    res.status(201).json(readBudget(db, budgetId));
  });
  app.post('/api/restore', (req, res) => res.status(201).json(restore(db, req.body)));
  app.use('/api/budgets/:id', (req, res, next) => {
    try {
      req.data = readBudget(db, req.params.id);
      next();
    } catch (e) {
      next(e);
    }
  });
  app.get('/api/budgets/:id', (req, res) => res.json(req.data));
  app.patch('/api/budgets/:id', (req, res) => {
    db.prepare('UPDATE budgets SET name=? WHERE id=?').run(name(req.body.name), req.params.id);
    res.json({ ok: true });
  });
  app.get('/api/budgets/:id/export', (req, res) => {
    res.setHeader('Content-Disposition', 'attachment; filename="budget-backup.json"');
    res.json({
      format: 'you-want-a-budget',
      version: 1,
      exportedAt: new Date().toISOString(),
      ...req.data,
    });
  });
  app.post('/api/budgets/:id/accounts', (req, res) => {
    atomic(db, () => addAccount(db, req.params.id, req.body));
    res.status(201).json({ ok: true });
  });
  app.patch('/api/budgets/:id/accounts/:accountId', (req, res) => {
    const a = req.data.accounts.find((a) => a.id === req.params.accountId);
    if (!a) fail('Account not found.', 404);
    const d = date(req.body.openingDate);
    if (req.data.transactions.some((t) => t.accountId === a.id && t.date < d))
      fail('The opening date must precede all account transactions.');
    atomic(db, () => {
      db.prepare('UPDATE accounts SET name=?,openingDate=?,openingBalance=? WHERE id=?').run(
        name(req.body.name),
        d,
        openingBalance(a.type, req.body),
        a.id,
      );
      db.prepare('UPDATE categories SET name=? WHERE accountId=?').run(name(req.body.name), a.id);
    });
    res.json({ ok: true });
  });
  app.post('/api/budgets/:id/groups', (req, res) => {
    const position = Math.max(-1, ...req.data.groups.map((g) => g.position)) + 1;
    group(db, req.params.id, req.body.name, position);
    res.status(201).json({ ok: true });
  });
  app.put('/api/budgets/:id/groups/order', (req, res) => {
    const ids = req.body.groupIds;
    if (
      !Array.isArray(ids) ||
      ids.length !== req.data.groups.length ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !req.data.groups.some((g) => g.id === id))
    )
      fail(
        'The order must contain every group in this budget exactly once. Refresh and try again.',
      );
    atomic(db, () => {
      const update = db.prepare('UPDATE groups SET position=? WHERE id=? AND budgetId=?');
      ids.forEach((id, position) => update.run(position, id, req.params.id));
    });
    res.json({ ok: true });
  });
  app.delete('/api/budgets/:id/groups/:groupId', (req, res) => {
    const source = req.data.groups.find((g) => g.id === req.params.groupId);
    if (!source) fail('Group not found.', 404);
    const categories = req.data.categories.filter((c) => c.groupId === source.id);
    const target = req.body?.targetGroupId;
    const replacementName = req.body?.newGroupName;
    if (
      categories.length &&
      !replacementName &&
      !req.data.groups.some((g) => g.id === target && g.id !== source.id)
    )
      fail('Choose another group for these categories, or name a new group.');
    atomic(db, () => {
      if (categories.length) {
        const destination = replacementName
          ? group(
              db,
              req.params.id,
              replacementName,
              Math.max(...req.data.groups.map((g) => g.position)) + 1,
            )
          : target;
        let position = Math.max(
          -1,
          ...req.data.categories.filter((c) => c.groupId === destination).map((c) => c.position),
        );
        const move = db.prepare(
          'UPDATE categories SET groupId=?,position=? WHERE id=? AND budgetId=?',
        );
        for (const c of categories) move.run(destination, ++position, c.id, req.params.id);
      }
      db.prepare('DELETE FROM groups WHERE id=? AND budgetId=?').run(source.id, req.params.id);
      const remaining = db
        .prepare('SELECT id FROM groups WHERE budgetId=? ORDER BY position,rowid')
        .all(req.params.id);
      const update = db.prepare('UPDATE groups SET position=? WHERE id=?');
      remaining.forEach((g, position) => update.run(position, g.id));
    });
    res.json({ ok: true });
  });
  app.post('/api/budgets/:id/categories', (req, res) => {
    if (!req.data.groups.some((g) => g.id === req.body.groupId)) fail('Group not found.');
    if ((req.body.target || 0) < 0) fail('Target must be positive.');
    category(
      db,
      req.params.id,
      req.body.groupId,
      req.body.name,
      req.body.target || 0,
      null,
      req.data.categories.length,
    );
    res.status(201).json({ ok: true });
  });
  app.patch('/api/budgets/:id/categories/:categoryId', (req, res) => {
    const c = req.data.categories.find((c) => c.id === req.params.categoryId);
    if (!c) fail('Category not found.', 404);
    if (!req.data.groups.some((g) => g.id === req.body.groupId)) fail('Group not found.');
    if (req.body.target < 0) fail('Target cannot be negative.');
    db.prepare('UPDATE categories SET name=?,groupId=?,target=? WHERE id=?').run(
      c.accountId ? c.name : name(req.body.name),
      req.body.groupId,
      amount(req.body.target),
      c.id,
    );
    res.json({ ok: true });
  });
  app.delete('/api/budgets/:id/categories/:categoryId', (req, res) => {
    const c = req.data.categories.find((c) => c.id === req.params.categoryId);
    if (!c || c.accountId) fail('This category cannot be deleted.');
    if (
      req.data.transactions.some((t) => t.categoryId === c.id) ||
      req.data.assignments.some((a) => a.categoryId === c.id && a.amount !== 0)
    )
      fail(
        'This category has budget history. Keep it or move its transactions and clear assignments first.',
      );
    atomic(db, () => {
      db.prepare('DELETE FROM assignments WHERE categoryId=?').run(c.id);
      db.prepare('DELETE FROM categories WHERE id=?').run(c.id);
    });
    res.json({ ok: true });
  });
  app.put('/api/budgets/:id/assignments', (req, res) => {
    if (!req.data.categories.some((c) => c.id === req.body.categoryId)) fail('Category not found.');
    setAssignment(db, req.params.id, req.body.categoryId, req.body.month, req.body.amount);
    res.json({ ok: true });
  });
  app.post('/api/budgets/:id/move', (req, res) => {
    const { from, to } = req.body,
      m = month(req.body.month),
      value = amount(req.body.amount);
    if (value <= 0 || from === to) fail('Choose different destinations and a positive amount.');
    const snapshot = calculateBudget(req.data, m);
    for (const key of [from, to])
      if (key !== 'ready' && !snapshot.rows.some((c) => c.id === key)) fail('Category not found.');
    const available =
      from === 'ready' ? snapshot.ready : snapshot.rows.find((c) => c.id === from).available;
    if (value > available) fail('There is not enough available money to move.');
    atomic(db, () => {
      for (const [key, delta] of [
        [from, -value],
        [to, value],
      ])
        if (key !== 'ready')
          setAssignment(
            db,
            req.params.id,
            key,
            m,
            (snapshot.rows.find((c) => c.id === key)?.assigned || 0) + delta,
          );
    });
    res.json({ ok: true });
  });
  app.post('/api/budgets/:id/transactions', (req, res) => {
    if (req.body.isCardPayment) saveCardPayment(db, req.data, req.body);
    else insertTx(db, validateTx(req.data, req.body));
    res.status(201).json({ ok: true });
  });
  app.patch('/api/budgets/:id/transactions/:txId', (req, res) => {
    const old = req.data.transactions.find((t) => t.id === req.params.txId);
    if (!old) fail('Transaction not found.', 404);
    if (Object.keys(req.body).length === 1 && 'cleared' in req.body) {
      db.prepare('UPDATE transactions SET cleared=? WHERE id=?').run(
        req.body.cleared ? 1 : 0,
        old.id,
      );
      return res.json({ ok: true });
    }
    if (old.transferId) fail('Delete and recreate a transfer to change it.');
    if (req.body.isCardPayment) {
      saveCardPayment(db, req.data, req.body, old);
      return res.json({ ok: true });
    }
    const t = validateTx(req.data, { ...req.body, id: old.id });
    db.prepare(
      'UPDATE transactions SET accountId=?,date=?,payee=?,categoryId=?,amount=?,memo=?,cleared=?,importKey=NULL WHERE id=?',
    ).run(t.accountId, t.date, t.payee, t.categoryId, t.amount, t.memo, t.cleared, t.id);
    res.json({ ok: true });
  });
  app.delete('/api/budgets/:id/transactions/:txId', (req, res) => {
    const t = req.data.transactions.find((t) => t.id === req.params.txId);
    if (!t) fail('Transaction not found.', 404);
    if (t.transferId)
      db.prepare('DELETE FROM transactions WHERE budgetId=? AND transferId=?').run(
        req.params.id,
        t.transferId,
      );
    else db.prepare('DELETE FROM transactions WHERE id=?').run(t.id);
    res.json({ ok: true });
  });
  app.post('/api/budgets/:id/transfers', (req, res) => {
    atomic(db, () => createTransfer(db, req.data, req.body));
    res.status(201).json({ ok: true });
  });
  app.post('/api/budgets/:id/import', (req, res) => {
    if (!Array.isArray(req.body.rows) || req.body.rows.length > 10000 || !req.body.rows.length)
      fail('Choose 1–10,000 transactions to import.');
    const rows = req.body.rows.map((r) =>
      validateTx(req.data, { ...r, accountId: req.body.accountId, id: undefined }),
    );
    let imported = 0,
      skipped = 0;
    atomic(db, () => {
      const marked = markDuplicates(rows, req.data.transactions, req.body.accountId, true);
      for (const row of marked) {
        if (row.duplicate && !req.body.includeDuplicates) {
          skipped++;
          continue;
        }
        insertTx(db, row);
        imported++;
      }
    });
    res.status(201).json({ imported, skipped });
  });
  app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
  app.use((err, req, res, next) => {
    if (err.status >= 500 || !err.status) console.error(err);
    res.status(err.status || 500).json({
      error: err.status ? err.message : 'Something went wrong. No partial changes were saved.',
    });
  });
  return app;
}
function seedDemo(db, budgetId) {
  const m = today().slice(0, 7),
    prev = nextMonth(m, -1);
  const checking = addAccount(db, budgetId, {
    name: 'Everyday checking',
    type: 'checking',
    openingBalance: 645000,
    openingDate: prev + '-01',
  });
  addAccount(db, budgetId, {
    name: 'Rainy day savings',
    type: 'savings',
    openingBalance: 350000,
    openingDate: prev + '-01',
  });
  const card = addAccount(db, budgetId, {
    name: 'Everyday credit card',
    type: 'credit',
    openingBalance: -24000,
    openingDate: prev + '-01',
  });
  const data = readBudget(db, budgetId),
    cat = (n) => data.categories.find((c) => c.name === n).id;
  setAssignment(db, budgetId, cat('Emergency fund'), prev, 300000);
  setAssignment(db, budgetId, cat('Travel'), prev, 35000);
  const values = {
    Groceries: 50000,
    'Dining out': 15000,
    Transportation: 12000,
    'Rent & mortgage': 180000,
    Utilities: 15000,
    'Internet & phone': 10000,
    Subscriptions: 5000,
    'Emergency fund': 50000,
    Travel: 20000,
    'Gifts & celebrations': 7500,
    'Fun money': 10000,
    Shopping: 10000,
    'Everyday credit card': 24000,
  };
  for (const [n, v] of Object.entries(values)) setAssignment(db, budgetId, cat(n), m, v);
  const entries = [
    ['Neighborhood market', 'Groceries', -8642, checking],
    ['Corner coffee', 'Dining out', -675, card],
    ['Monthly rent', 'Rent & mortgage', -180000, checking],
    ['City transit', 'Transportation', -3200, checking],
    ['Streaming service', 'Subscriptions', -1599, card],
    ['Dinner with friends', 'Dining out', -5800, card],
    ['Bookshop', 'Fun money', -2450, checking],
  ];
  entries.forEach(([payee, c, amount, accountId]) =>
    insertTx(
      db,
      validateTx(data, {
        accountId,
        date: m + '-01',
        payee,
        categoryId: cat(c),
        amount,
        cleared: true,
        memo: 'Sample transaction',
      }),
    ),
  );
}
function restore(db, payload) {
  if (!payload || payload.format !== 'you-want-a-budget' || payload.version !== 1)
    fail('Choose a version 1 You Want a Budget JSON backup.');
  for (const key of ['groups', 'categories', 'accounts', 'transactions', 'assignments'])
    if (!Array.isArray(payload[key]) || payload[key].length > 100000)
      fail(`Invalid backup: ${key}.`);
  if (!payload.budget) fail('Missing budget details.');
  return atomic(db, () => {
    const budgetId = id(),
      map = new Map();
    const mapId = (old) => {
      if (typeof old !== 'string' || !old || map.has(old))
        fail('Duplicate or invalid IDs in backup.');
      const fresh = id();
      map.set(old, fresh);
      return fresh;
    };
    const ref = (old) => {
      if (!map.has(old)) fail('Broken reference in backup.');
      return map.get(old);
    };
    db.prepare('INSERT INTO budgets VALUES(?,?,?,?)').run(
      budgetId,
      name(payload.budget.name).slice(0, 189) + ' (imported)',
      new Date().toISOString(),
      0,
    );
    for (const g of payload.groups)
      db.prepare('INSERT INTO groups VALUES(?,?,?,?)').run(
        mapId(g.id),
        budgetId,
        name(g.name),
        Number.isInteger(g.position) ? g.position : 0,
      );
    for (const a of payload.accounts) {
      if (!ACCOUNT_TYPES.includes(a.type)) fail('Invalid account type in backup.');
      db.prepare('INSERT INTO accounts VALUES(?,?,?,?,?,?)').run(
        mapId(a.id),
        budgetId,
        name(a.name),
        a.type,
        amount(a.openingBalance),
        date(a.openingDate),
      );
    }
    for (const c of payload.categories) {
      if (c.target < 0) fail('Invalid target.');
      db.prepare('INSERT INTO categories VALUES(?,?,?,?,?,?,?)').run(
        mapId(c.id),
        budgetId,
        ref(c.groupId),
        name(c.name),
        amount(c.target || 0),
        Number.isInteger(c.position) ? c.position : 0,
        c.accountId ? ref(c.accountId) : null,
      );
    }
    const data = readBudget(db, budgetId),
      transferMap = new Map();
    for (const t of payload.transactions) {
      const key = mapId(t.id);
      const tx = validateTx(data, {
        ...t,
        id: key,
        accountId: ref(t.accountId),
        categoryId: t.categoryId ? ref(t.categoryId) : null,
      });
      if (t.transferId) {
        if (!transferMap.has(t.transferId)) transferMap.set(t.transferId, id());
        tx.transferId = transferMap.get(t.transferId);
      }
      insertTx(db, tx);
    }
    const assignmentKeys = new Set();
    for (const a of payload.assignments) {
      const key = ref(a.categoryId);
      if (!data.categories.some((c) => c.id === key)) fail('Invalid assignment category.');
      const pair = key + month(a.month);
      if (assignmentKeys.has(pair)) fail('Duplicate assignment.');
      assignmentKeys.add(pair);
      setAssignment(db, budgetId, key, a.month, a.amount);
    }
    const restored = readBudget(db, budgetId);
    for (const transferId of transferMap.values()) {
      const pair = restored.transactions.filter((t) => t.transferId === transferId);
      if (
        pair.length !== 2 ||
        pair[0].amount + pair[1].amount !== 0 ||
        pair[0].accountId === pair[1].accountId ||
        pair[0].date !== pair[1].date
      )
        fail('Invalid transfer pair in backup.');
      const from = pair.find((t) => t.amount < 0),
        to = pair.find((t) => t.amount > 0);
      const fromAccount = restored.accounts.find((a) => a.id === from.accountId);
      const toAccount = restored.accounts.find((a) => a.id === to.accountId);
      if (
        fromAccount.type === 'credit' ||
        (fromAccount.type === 'investment' && toAccount.type === 'credit')
      )
        fail('Unsupported transfer in backup.');
      if (isCashAccount(fromAccount) && toAccount.type === 'investment' && !from.categoryId)
        fail('Investment contributions need a category.');
      for (const t of pair) {
        const own = restored.accounts.find((a) => a.id === t.accountId);
        const peer = restored.accounts.find(
          (a) => a.id !== t.accountId && pair.some((p) => p.accountId === a.id),
        );
        if (t.categoryId && !(isCashAccount(own) && peer.type === 'investment'))
          fail('Invalid transfer category in backup.');
      }
    }
    // Payment envelopes must exist exactly once per card, never for cash accounts.
    for (const a of restored.accounts) {
      const n = restored.categories.filter((c) => c.accountId === a.id).length;
      if (n !== (a.type === 'credit' ? 1 : 0)) fail('Invalid credit card payment categories.');
    }
    return restored;
  });
}
