import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateBudget } from '../shared/budget.js';
import { cents, nextMonth } from '../shared/money.js';
const account = { id: 'cash', type: 'checking', openingBalance: 100000, openingDate: '2026-01-01' };
const category = { id: 'food', name: 'Groceries' };
const base = () => ({
  accounts: [account],
  categories: [category],
  transactions: [],
  assignments: [],
});
const assign = (amount, categoryId = 'food', month = '2026-01') => ({ categoryId, month, amount });
const tx = (amount, accountId = 'cash', categoryId = 'food', date = '2026-01-02', extra = {}) => ({
  id: Math.random().toString(),
  accountId,
  categoryId,
  date,
  amount,
  ...extra,
});
const withCard = () => ({
  ...base(),
  accounts: [
    account,
    { id: 'card', type: 'credit', openingBalance: -10000, openingDate: '2026-01-01' },
  ],
  categories: [category, { id: 'payment', name: 'Card', accountId: 'card' }],
});
test('cash can be assigned and positive balances roll over across empty months', () => {
  const d = base();
  d.assignments = [assign(30000)];
  d.transactions = [tx(-10000)];
  assert.equal(calculateBudget(d, '2026-01').ready, 70000);
  assert.equal(calculateBudget(d, '2026-01').rows[0].available, 20000);
  assert.equal(calculateBudget(d, '2026-04').rows[0].carried, 20000);
  assert.equal(calculateBudget(d, '2026-04').ready, 70000);
});
test('cash overspending reduces next month ready to assign once', () => {
  const d = base();
  d.assignments = [assign(10000)];
  d.transactions = [tx(-15000)];
  const jan = calculateBudget(d, '2026-01'),
    feb = calculateBudget(d, '2026-02');
  assert.equal(jan.rows[0].available, -5000);
  assert.equal(feb.rows[0].available, 0);
  assert.equal(feb.ready, 85000);
  assert.equal(calculateBudget(d, '2026-03').ready, 85000);
});
test('credit spending moves funded dollars to card payment envelope', () => {
  const d = withCard();
  d.assignments = [assign(20000)];
  d.transactions = [tx(-5000, 'card')];
  const s = calculateBudget(d, '2026-01');
  assert.equal(s.rows[0].available, 15000);
  assert.equal(s.rows[1].available, 5000);
  assert.equal(s.ready, 80000);
  assert.equal(s.accounts[1].balance, -15000);
});
test('unfunded credit spending becomes debt without reducing next month cash', () => {
  const d = withCard();
  d.assignments = [assign(2000)];
  d.transactions = [tx(-5000, 'card')];
  const s = calculateBudget(d, '2026-02');
  assert.equal(s.rows[0].available, 0);
  assert.equal(s.rows[1].available, 2000);
  assert.equal(s.ready, 98000);
});
test('covering mixed cash/card spending prioritizes cash and reserves remainder', () => {
  const d = withCard();
  d.assignments = [assign(10000)];
  d.transactions = [tx(-7000, 'card'), tx(-6000)];
  let s = calculateBudget(d, '2026-01');
  assert.equal(s.rows[0].creditOverspent, 3000);
  assert.equal(s.rows[1].available, 4000);
  assert.equal(calculateBudget(d, '2026-02').ready, 90000);
  d.assignments = [assign(14000)];
  s = calculateBudget(d, '2026-01');
  assert.equal(s.rows[0].available, 1000);
  assert.equal(s.rows[1].available, 7000);
});
test('cash deficits and card deficits are separate', () => {
  const d = withCard();
  d.assignments = [assign(1000)];
  d.transactions = [tx(-7000, 'card'), tx(-6000)];
  const s = calculateBudget(d, '2026-02');
  assert.equal(s.ready, 94000);
  assert.equal(s.rows[1].available, 0);
});
test('cash transfers do not change budget dollars; card payments use reserves', () => {
  const d = withCard();
  d.assignments = [assign(10000, 'payment')];
  d.transactions = [
    tx(-10000, 'cash', null, '2026-01-02', { id: 'a', transferId: 'pair' }),
    tx(10000, 'card', null, '2026-01-02', { id: 'b', transferId: 'pair' }),
  ];
  const s = calculateBudget(d, '2026-01');
  assert.equal(s.ready, 90000);
  assert.equal(s.rows[1].available, 0);
  assert.equal(s.accounts[0].balance, 90000);
  assert.equal(s.accounts[1].balance, 0);
  assert.equal(s.spending, 0);
});
test('credit refunds restore category cash and reduce payment reserve', () => {
  const d = withCard();
  d.assignments = [assign(10000)];
  d.transactions = [tx(-5000, 'card'), tx(2000, 'card', 'food', '2026-02-01')];
  const s = calculateBudget(d, '2026-02');
  assert.equal(s.rows[0].available, 7000);
  assert.equal(s.rows[1].available, 3000);
  assert.equal(s.ready, 90000);
});
test('future assignments only affect their own month; negative assignments release money', () => {
  const d = base();
  d.assignments = [
    assign(10000),
    assign(-2000, 'food', '2026-02'),
    assign(40000, 'food', '2026-03'),
  ];
  assert.equal(calculateBudget(d, '2026-01').ready, 90000);
  assert.equal(calculateBudget(d, '2026-02').ready, 92000);
  assert.equal(calculateBudget(d, '2026-02').rows[0].available, 8000);
});
test('integer money parser avoids floating-point accumulation and rejects malformed values', () => {
  assert.equal(cents('1,234.56'), 123456);
  assert.equal(cents('0.29'), 29);
  assert.equal(cents('(25.99)'), -2599);
  assert.throws(() => cents('2.001'));
  assert.throws(() => cents('NaN'));
  assert.equal(nextMonth('2026-12'), '2027-01');
});
