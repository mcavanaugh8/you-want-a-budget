import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV, guessMapping, mapRows, markDuplicates, parseDate } from '../shared/csv.js';
const read = (text, preset = 'auto', headerless = false) => {
  const p = parseCSV(text, headerless);
  return mapRows(p, guessMapping(p.headers, preset, headerless));
};
test('Chase quoted descriptions, BOM, negative charges, positive payments', () => {
  const r = read(
    '\uFEFFTransaction Date,Post Date,Description,Category,Type,Amount,Memo\n10/01/2026,10/02/2026,"GROCER, INC",Food,Sale,-23.45,\n10/02/2026,10/03/2026,PAYMENT,,Payment,100.00,',
  );
  assert.equal(r[0].payee, 'GROCER, INC');
  assert.equal(r[0].amount, -2345);
  assert.equal(r[1].amount, 10000);
});
test('Amex positive charges and negative credits are inverted', () => {
  const r = read(
    'Date,Description,Card Member,Amount\n10/01/2026,Market,TEST,20.10\n10/02/2026,Refund,TEST,-4.20',
    'amex',
  );
  assert.equal(r[0].amount, -2010);
  assert.equal(r[1].amount, 420);
});
test('Capital One split debit and credit columns', () => {
  const r = read(
    'Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit\n10/01/2026,10/02/2026,1234,SHOP,Shopping,19.20,\n10/02/2026,10/03/2026,1234,PAYMENT,Payment,,25.00',
  );
  assert.equal(r[0].amount, -1920);
  assert.equal(r[1].amount, 2500);
});
test('bank preambles and semicolon-separated rows work', () => {
  const r = read(
    'Account summary\nChecking account\nDate;Description;Amount;Running Bal.\n10/01/2026;Food;-12.00;100.00',
  );
  assert.equal(r[0].amount, -1200);
});
test('headerless Wells Fargo exports are configurable', () => {
  const r = read('"10/01/2026","-12.50","*","","PURCHASE"', 'wells', true);
  assert.equal(r[0].amount, -1250);
  assert.equal(r[0].payee, 'PURCHASE');
});
test('bad dates, malformed amounts, totals are errors rather than silently imported', () => {
  const r = read(
    'Date,Description,Amount\n02/30/2026,Food,-12.00\n10/01/2026,Shop,WHAT\nTOTAL,,20',
  );
  assert.equal(r.filter((r) => r.error).length, 3);
  assert.equal(parseDate('31/10/2026', 'dmy'), '2026-10-31');
});
test('duplicate checks preserve repeated purchases within a file and skip reimports', () => {
  const rows = [
    { date: '2026-10-01', payee: 'Coffee', amount: -500 },
    { date: '2026-10-01', payee: 'Coffee', amount: -500 },
  ];
  assert.equal(markDuplicates(rows, [], 'a').filter((r) => !r.duplicate).length, 2);
  assert.equal(
    markDuplicates(rows, [{ ...rows[0], accountId: 'a' }], 'a').filter((r) => !r.duplicate).length,
    1,
  );
  assert.equal(
    markDuplicates(
      rows,
      rows.map((r) => ({ ...r, accountId: 'a' })),
      'a',
    ).filter((r) => !r.duplicate).length,
    0,
  );
});
test('Discover preset interprets positive charges and negative refunds', () => {
  const r = read(
    'Trans. Date,Post Date,Description,Amount,Category\n10/01/2026,10/02/2026,SHOP,20.00,Shopping\n10/02/2026,10/03/2026,REFUND,-5.00,Shopping',
    'discover',
  );
  assert.equal(r[0].amount, -2000);
  assert.equal(r[1].amount, 500);
});
test('unsigned amounts with a direction column support mixed inflows and outflows', () => {
  const parsed = parseCSV(
    'Date,Description,Amount,Type\n10/01/2026,Store,12.00,Debit\n10/01/2026,Deposit,15.00,Credit\n10/01/2026,Unknown,2.00,Unknown',
  );
  const mapping = { ...guessMapping(parsed.headers), direction: '3' };
  const r = mapRows(parsed, mapping);
  assert.equal(r[0].amount, -1200);
  assert.equal(r[1].amount, 1500);
  assert.match(r[2].error, /Unknown/);
});
test('excluding an older duplicate does not renumber a later legitimate identical purchase', () => {
  const row = { date: '2026-10-01', payee: 'Coffee', amount: -500 };
  const existing = [{ ...row, accountId: 'a' }];
  const marked = markDuplicates([row, row], existing, 'a');
  assert.equal(markDuplicates([marked[1]], existing, 'a', true)[0].duplicate, false);
});
