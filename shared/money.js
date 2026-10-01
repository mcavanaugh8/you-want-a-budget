export function cents(value) {
  const raw = String(value ?? '')
    .trim()
    .replace(/[$,\s]/g, '');
  const normalized = /^\(.*\)$/.test(raw) ? '-' + raw.slice(1, -1) : raw;
  if (!/^-?\d+(\.\d{1,2})?$/.test(normalized))
    throw new Error('Enter a valid amount with at most two decimal places.');
  const n = Math.round(Number(normalized) * 100);
  if (!Number.isSafeInteger(n) || Math.abs(n) > 100_000_000_000)
    throw new Error('Amount is too large.');
  return n;
}
export const money = (n = 0) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n / 100);
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export function nextMonth(m, delta = 1) {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}
export function validDate(s) {
  return (
    typeof s === 'string' &&
    /^20\d{2}-\d{2}-\d{2}$/.test(s) &&
    !Number.isNaN(Date.parse(s)) &&
    new Date(s).toISOString().slice(0, 10) === s
  );
}
export function validMonth(s) {
  return typeof s === 'string' && /^20\d{2}-(0[1-9]|1[0-2])$/.test(s);
}
