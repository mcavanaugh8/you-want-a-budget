import { nextMonth } from './money.js';

// All arithmetic uses integer cents. Month-end cash deficits reduce the next
// month's Ready to Assign. Unfunded card spending becomes debt, not lost cash.
export function calculateBudget(data, month) {
  const { accounts, categories, transactions, assignments } = data;
  const accountMap = new Map(accounts.map((a) => [a.id, a]));
  const starts = [
    month,
    ...accounts.map((a) => a.openingDate.slice(0, 7)),
    ...transactions.map((t) => t.date.slice(0, 7)),
    ...assignments.map((a) => a.month),
  ];
  let cursor = starts.sort()[0],
    ready = 0,
    cashDeficit = 0,
    previous = {};
  let result;
  while (cursor <= month) {
    const rows = categories.map((c) => ({
      ...c,
      carried: Math.max(0, previous[c.id] || 0),
      assigned: 0,
      activity: 0,
      available: 0,
      creditOverspent: 0,
      cashOverspent: 0,
    }));
    const rowMap = new Map(rows.map((c) => [c.id, c]));
    const monthTx = transactions.filter((t) => t.date.slice(0, 7) === cursor);
    const monthAssignments = assignments.filter((a) => a.month === cursor);
    const cashUncategorized = monthTx.filter(
      (t) => !t.transferId && !t.categoryId && accountMap.get(t.accountId)?.type !== 'credit',
    );
    const income = cashUncategorized.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const unassignedActivity = cashUncategorized.reduce((s, t) => s + t.amount, 0);
    const openingCash = accounts
      .filter((a) => a.type !== 'credit' && a.openingDate.slice(0, 7) === cursor)
      .reduce((s, a) => s + a.openingBalance, 0);
    const assigned = monthAssignments.reduce((s, a) => s + a.amount, 0);
    ready += unassignedActivity + openingCash - assigned - cashDeficit;
    for (const a of monthAssignments)
      if (rowMap.has(a.categoryId)) rowMap.get(a.categoryId).assigned += a.amount;
    for (const row of rows) row.available = row.carried + row.assigned;
    for (const row of rows.filter((c) => !c.accountId)) {
      const relevant = monthTx.filter((t) => !t.transferId && t.categoryId === row.id);
      const cashActivity = relevant
        .filter((t) => accountMap.get(t.accountId)?.type !== 'credit')
        .reduce((s, t) => s + t.amount, 0);
      const cardSpending = accounts
        .filter((a) => a.type === 'credit')
        .map((a) => ({
          account: a,
          spending: -relevant.filter((t) => t.accountId === a.id).reduce((s, t) => s + t.amount, 0),
        }));
      const refunds = cardSpending.reduce((s, c) => s + Math.max(0, -c.spending), 0);
      let funded = Math.max(0, row.available + cashActivity + refunds);
      row.activity = relevant.reduce((s, t) => s + t.amount, 0);
      row.cashOverspent = Math.max(0, -(row.available + cashActivity + refunds));
      for (const { account, spending } of cardSpending) {
        const reserve = rows.find((c) => c.accountId === account.id);
        const covered = spending < 0 ? spending : Math.min(funded, spending);
        if (spending > 0) {
          funded -= covered;
          row.creditOverspent += spending - covered;
        }
        if (reserve) {
          reserve.activity += covered;
          reserve.available += covered;
        }
      }
      row.available += row.activity;
    }
    for (const t of monthTx.filter((t) => t.transferId)) {
      const account = accountMap.get(t.accountId);
      const peer = transactions.find((p) => p.transferId === t.transferId && p.id !== t.id);
      // A transfer from cash to a credit card uses the card's payment envelope.
      if (account?.type === 'credit' && peer && accountMap.get(peer.accountId)?.type !== 'credit') {
        const reserve = rows.find((c) => c.accountId === account.id);
        if (reserve) {
          reserve.activity -= t.amount;
          reserve.available -= t.amount;
        }
      }
    }
    cashDeficit = rows.reduce(
      (s, c) => s + (c.accountId ? Math.max(0, -c.available) : c.cashOverspent),
      0,
    );
    previous = Object.fromEntries(rows.map((c) => [c.id, c.available]));
    const balances = accounts.map((a) => ({
      ...a,
      balance:
        (a.openingDate.slice(0, 7) <= cursor ? a.openingBalance : 0) +
        transactions
          .filter((t) => t.accountId === a.id && t.date.slice(0, 7) <= cursor)
          .reduce((s, t) => s + t.amount, 0),
    }));
    result = {
      month: cursor,
      ready,
      income,
      assigned,
      rows,
      accounts: balances,
      available: rows.reduce((s, c) => s + Math.max(0, c.available), 0),
      overspent: rows.reduce((s, c) => s + Math.max(0, -c.available), 0),
      cashDeficit,
      spending: monthTx
        .filter((t) => !t.transferId && (t.categoryId || t.amount < 0))
        .reduce((s, t) => s - t.amount, 0),
      uncategorized: monthTx.filter((t) => !t.transferId && !t.categoryId && t.amount < 0).length,
    };
    cursor = nextMonth(cursor);
  }
  return result;
}
