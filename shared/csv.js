import Papa from 'papaparse';
import { cents, validDate } from './money.js';
const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
export const PRESETS = {
  auto: 'Auto-detect / custom',
  chase: 'Chase',
  amex: 'American Express',
  capitalone: 'Capital One',
  boa: 'Bank of America',
  wells: 'Wells Fargo',
  citi: 'Citi',
  discover: 'Discover',
};
export function parseCSV(text, headerless = false) {
  const result = Papa.parse(text.replace(/^\uFEFF/, ''), { skipEmptyLines: 'greedy' });
  if (result.errors.length) throw new Error(`CSV could not be read: ${result.errors[0].message}`);
  if (!result.data.length) throw new Error('This file is empty.');
  let start = 0;
  if (!headerless) {
    const found = result.data.findIndex((row) =>
      row.some((v) =>
        /^(transactiondate|transdate|postingdate|postdate|date|posteddate)$/.test(norm(v)),
      ),
    );
    if (found >= 0) start = found;
  }
  const headers = headerless
    ? result.data[0].map((_, i) => `Column ${i + 1}`)
    : result.data[start].map((h, i) => String(h).trim() || `Column ${i + 1}`);
  const rows = result.data
    .slice(headerless ? 0 : start + 1)
    .filter((row) => row.some((v) => String(v).trim()));
  if (rows.length > 10000) throw new Error('Import up to 10,000 rows at a time.');
  return { headers, rows };
}
export function guessMapping(headers, preset = 'auto', headerless = false) {
  const find = (names) => {
    const i = headers.findIndex((h) => names.includes(norm(h)));
    return i < 0 ? '' : String(i);
  };
  if (headerless)
    return {
      date: '0',
      payee: headers.length > 4 ? '4' : '1',
      amount: '1',
      debit: '',
      credit: '',
      memo: '',
      invert: false,
      direction: '',
      dateFormat: 'mdy',
    };
  const debit = find([
    'debit',
    'debits',
    'withdrawals',
    'withdrawal',
    'debitamount',
    'outflow',
    'charges',
  ]);
  const credit = find(['credit', 'credits', 'deposits', 'deposit', 'creditamount', 'inflow']);
  const isAmex =
    preset === 'amex' || (preset === 'auto' && headers.some((h) => norm(h) === 'cardmember'));
  return {
    date: find(['transactiondate', 'transdate', 'date', 'postingdate', 'postdate', 'posteddate']),
    payee: find([
      'description',
      'payee',
      'merchant',
      'originaldescription',
      'transactiondescription',
    ]),
    amount: find(['amount', 'transactionamount']),
    debit,
    credit,
    memo: find(['memo', 'extendeddetails', 'notes']),
    invert: isAmex || preset === 'discover',
    direction: '',
    dateFormat: 'mdy',
  };
}
export function parseDate(value, format = 'mdy') {
  const s = String(value || '').trim();
  let iso = s;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2}|\d{4})$/);
    if (!m) throw new Error('Use a numeric date such as 10/01/2026 or 2026-10-01.');
    const year = m[3].length === 2 ? '20' + m[3] : m[3];
    iso = `${year}-${(format === 'dmy' ? m[2] : m[1]).padStart(2, '0')}-${(format === 'dmy' ? m[1] : m[2]).padStart(2, '0')}`;
  }
  if (!validDate(iso)) throw new Error('Invalid date (supported years: 2000–2099).');
  return iso;
}
export function mapRows(parsed, mapping) {
  return parsed.rows.map((row, i) => {
    try {
      if (mapping.date === '' || mapping.payee === '')
        throw new Error('Map a date and description column.');
      const date = parseDate(row[Number(mapping.date)], mapping.dateFormat);
      const payee = String(row[Number(mapping.payee)] || '').trim();
      if (!payee) throw new Error('Description is empty.');
      let amount;
      if (mapping.amount !== '')
        amount = cents(row[Number(mapping.amount)]) * (mapping.invert ? -1 : 1);
      else {
        if (mapping.debit === '' && mapping.credit === '')
          throw new Error('Map an amount or debit / credit columns.');
        const read = (idx) =>
          idx === '' || !String(row[Number(idx)] || '').trim()
            ? 0
            : Math.abs(cents(row[Number(idx)]));
        amount = read(mapping.credit) - read(mapping.debit);
      }
      if (mapping.direction !== undefined && mapping.direction !== '') {
        const direction = norm(row[Number(mapping.direction)]);
        if (
          /^(credit|cr|c|deposit|payment|refund|interest|return|reversal|inflow)$/.test(direction)
        )
          amount = Math.abs(amount);
        else if (
          /^(debit|dr|d|withdrawal|purchase|sale|fee|check|pos|atm|outflow)$/.test(direction)
        )
          amount = -Math.abs(amount);
        else
          throw new Error(
            'Unknown debit / credit direction. Map signed amounts instead or exclude this row.',
          );
      }
      if (!amount) throw new Error('Zero-value transaction.');
      return {
        row: i + 1,
        date,
        payee,
        amount,
        memo: mapping.memo === '' ? '' : String(row[Number(mapping.memo)] || '').trim(),
        categoryId: null,
        cleared: true,
      };
    } catch (e) {
      return { row: i + 1, error: e.message, raw: row.join(' · ') };
    }
  });
}
// Occurrence counts preserve two genuine, identical purchases within a file.
export function markDuplicates(rows, existing, accountId, preserveOccurrences = false) {
  const counts = new Map(),
    seen = new Map();
  const key = (t) => JSON.stringify([t.date, t.amount, t.payee.trim().toLowerCase()]);
  for (const t of existing.filter((t) => t.accountId === accountId)) {
    const k = key(t);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  return rows.map((r) => {
    if (r.error) return r;
    const k = key(r);
    const previousOccurrence =
      typeof r.importKey === 'string' && r.importKey.startsWith(k + ':')
        ? Number(r.importKey.slice(k.length + 1))
        : 0;
    const occurrence =
      preserveOccurrences &&
      Number.isSafeInteger(previousOccurrence) &&
      previousOccurrence > 0 &&
      previousOccurrence <= 10000
        ? previousOccurrence
        : (seen.get(k) || 0) + 1;
    seen.set(k, occurrence);
    return { ...r, importKey: `${k}:${occurrence}`, duplicate: occurrence <= (counts.get(k) || 0) };
  });
}
