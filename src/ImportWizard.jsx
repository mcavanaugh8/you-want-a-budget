import React, { useMemo, useState } from 'react';
import { Upload, Check, AlertCircle, FileSpreadsheet, ArrowRight } from 'lucide-react';
import { PRESETS, parseCSV, guessMapping, mapRows, markDuplicates } from '../shared/csv.js';
import { money } from '../shared/money.js';
import { Field, CategoryOptions } from './components.jsx';
export default function ImportWizard({ data, initialAccount, onImport, busy }) {
  const [account, setAccount] = useState(initialAccount || data.accounts[0]?.id || '');
  const [text, setText] = useState(''),
    [fileName, setFileName] = useState(''),
    [preset, setPreset] = useState('auto'),
    [headerless, setHeaderless] = useState(false),
    [mapping, setMapping] = useState(null),
    [step, setStep] = useState(1),
    [error, setError] = useState(''),
    [edits, setEdits] = useState({}),
    [includeDuplicates, setIncludeDuplicates] = useState(false),
    [excluded, setExcluded] = useState(new Set());
  const parsed = useMemo(() => {
    if (!text) return null;
    try {
      return parseCSV(text, headerless);
    } catch (e) {
      return { error: e.message };
    }
  }, [text, headerless]);
  const rows = useMemo(
    () =>
      parsed && !parsed.error && mapping
        ? markDuplicates(mapRows(parsed, mapping), data.transactions, account)
        : [],
    [parsed, mapping, data.transactions, account],
  );
  const errors = rows.filter((r) => r.error && !excluded.has(r.row));
  const selected = rows.filter(
    (r) => !r.error && !excluded.has(r.row) && (!r.duplicate || includeDuplicates),
  );
  const selectedAccount = data.accounts.find((a) => a.id === account);
  const old = selected.filter((r) => r.date < selectedAccount?.openingDate);
  function remap(presetValue, headerlessValue) {
    if (text)
      try {
        setMapping(
          guessMapping(parseCSV(text, headerlessValue).headers, presetValue, headerlessValue),
        );
      } catch (e) {
        setError(e.message);
      }
  }
  async function load(file) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setError('Choose a CSV smaller than 10 MB.');
      return;
    }
    try {
      const t = await file.text();
      const p = parseCSV(t, headerless);
      setText(t);
      setFileName(file.name);
      setMapping(guessMapping(p.headers, preset, headerless));
      setEdits({});
      setExcluded(new Set());
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }
  const mapField = (key, label) => (
    <Field label={label}>
      <select
        value={mapping?.[key] ?? ''}
        onChange={(e) => setMapping({ ...mapping, [key]: e.target.value })}
      >
        <option value="">Not mapped</option>
        {parsed?.headers?.map((h, i) => (
          <option value={String(i)} key={i}>
            {h}
          </option>
        ))}
      </select>
    </Field>
  );
  return (
    <div className="import-body">
      <div className="steps">
        <span className={step === 1 ? 'active' : ''}>
          1 <b>Choose & map</b>
        </span>
        <ArrowRight size={14} />
        <span className={step === 2 ? 'active' : ''}>
          2 <b>Review & import</b>
        </span>
      </div>
      {step === 1 ? (
        <>
          <div className="form-grid">
            <Field label="Import into account">
              <select value={account} onChange={(e) => setAccount(e.target.value)}>
                {data.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Bank format">
              <select
                value={preset}
                onChange={(e) => {
                  setPreset(e.target.value);
                  remap(e.target.value, headerless);
                }}
              >
                {Object.entries(PRESETS).map(([k, v]) => (
                  <option value={k} key={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <label className="upload-zone">
            <Upload size={26} />
            <strong>{fileName || 'Choose your transaction CSV'}</strong>
            <span>Processed locally. Your financial data stays on this computer.</span>
            <input
              type="file"
              accept=".csv,.tsv,text/csv,text/tab-separated-values"
              onChange={(e) => load(e.target.files[0])}
            />
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={headerless}
              onChange={(e) => {
                setHeaderless(e.target.checked);
                remap(preset, e.target.checked);
              }}
            />{' '}
            This file has no header row (e.g. Wells Fargo)
          </label>
          {mapping && parsed && !parsed.error && (
            <>
              <h3 className="section-label">Match your columns</h3>
              <div className="form-grid three">
                {mapField('date', 'Date')}
                {mapField('payee', 'Description / payee')}
                {mapField('amount', 'Signed amount')}
                {mapField('debit', 'Debit / outflow')}
                {mapField('credit', 'Credit / inflow')}
                {mapField('memo', 'Memo (optional)')}
                {mapField('direction', 'Debit / credit direction (optional)')}
              </div>
              <div className="form-grid">
                <Field label="Date format">
                  <select
                    value={mapping.dateFormat}
                    onChange={(e) => setMapping({ ...mapping, dateFormat: e.target.value })}
                  >
                    <option value="mdy">Month / day / year (US)</option>
                    <option value="dmy">Day / month / year</option>
                  </select>
                </Field>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={mapping.invert}
                    onChange={(e) => setMapping({ ...mapping, invert: e.target.checked })}
                  />{' '}
                  Reverse amount signs (Amex charges)
                </label>
              </div>
              <p className="muted small">
                Use either a signed amount column or separate debit and credit columns. Negative
                amounts mean money spent. For unsigned amounts with a type column, map debit /
                credit direction.
              </p>
              <div className="preview-sample">
                <span>First transaction preview</span>
                {rows[0]?.error ? (
                  <p className="text-red">{rows[0].error}</p>
                ) : (
                  <p>
                    {rows[0]?.date} · {rows[0]?.payee} <b>{money(rows[0]?.amount)}</b>
                  </p>
                )}
              </div>
            </>
          )}
        </>
      ) : (
        <>
          <div className="notice">
            <FileSpreadsheet size={20} />
            <div>
              <strong>
                {selected.length} transactions ready for {selectedAccount?.name}
              </strong>
              <p>
                {rows.filter((r) => r.duplicate).length} possible duplicates ·{' '}
                {rows.filter((r) => r.error).length} invalid rows. Review amounts and categories
                before importing.
              </p>
            </div>
          </div>
          <label className="check-label">
            <input
              type="checkbox"
              checked={includeDuplicates}
              onChange={(e) => setIncludeDuplicates(e.target.checked)}
            />{' '}
            Include possible duplicates
          </label>
          {old.length > 0 && (
            <div className="error">
              {old.length} transactions predate this account’s opening balance (
              {selectedAccount?.openingDate}). Exclude them or edit the account’s opening date and
              balance first.
            </div>
          )}
          <div className="import-table-wrap">
            <table className="import-table">
              <thead>
                <tr>
                  <th>Use</th>
                  <th>Date / payee</th>
                  <th>Category</th>
                  <th className="align-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.row} className={r.duplicate ? 'duplicate' : ''}>
                    <td>
                      <input
                        aria-label={`Include row ${r.row}`}
                        type="checkbox"
                        checked={!excluded.has(r.row) && (!r.duplicate || includeDuplicates)}
                        disabled={r.duplicate && !includeDuplicates}
                        onChange={(e) =>
                          setExcluded((prev) => {
                            const s = new Set(prev);
                            e.target.checked ? s.delete(r.row) : s.add(r.row);
                            return s;
                          })
                        }
                      />
                    </td>
                    {r.error ? (
                      <td colSpan={3}>
                        <span className="text-red">
                          Row {r.row}: {r.error}
                        </span>
                        <small>{r.raw}</small>
                      </td>
                    ) : (
                      <>
                        <td>
                          <strong>{r.payee}</strong>
                          <small>
                            {r.date}
                            {r.duplicate ? ' · Possible duplicate' : ''}
                          </small>
                        </td>
                        <td>
                          {selectedAccount?.type === 'investment' ? (
                            <span className="muted">Investment activity · no category</span>
                          ) : (
                            <select
                              aria-label={`Category for row ${r.row}`}
                              value={edits[r.row] || ''}
                              onChange={(e) => setEdits({ ...edits, [r.row]: e.target.value })}
                            >
                              <CategoryOptions data={data} />
                            </select>
                          )}
                        </td>
                        <td className={'align-right money ' + (r.amount > 0 ? 'text-green' : '')}>
                          {money(r.amount)}
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">
            Ordinary transfers need paired account entries; exclude those rows and add an account
            transfer. You can import card payments, then edit them and select Credit card payment
            (no category). Import both sides first to link matching entries. Other expenses without
            a category are flagged for review.
          </p>
        </>
      )}
      {(error || parsed?.error) && (
        <div className="error" role="alert">
          <AlertCircle size={16} />
          {error || parsed.error}
        </div>
      )}
      <footer className="modal-actions">
        {step === 2 && (
          <button className="button secondary" onClick={() => setStep(1)}>
            Back to mapping
          </button>
        )}
        {step === 1 ? (
          <button
            className="button primary"
            disabled={!rows.length || !account || parsed?.error}
            onClick={() => setStep(2)}
          >
            Review transactions <ArrowRight size={16} />
          </button>
        ) : (
          <button
            className="button primary"
            disabled={busy || !selected.length || errors.length > 0 || old.length > 0}
            onClick={() =>
              onImport({
                accountId: account,
                includeDuplicates,
                rows: rows
                  .filter((r) => !r.error && !excluded.has(r.row))
                  .map((r) => ({
                    ...r,
                    categoryId:
                      selectedAccount?.type === 'investment' ? null : edits[r.row] || null,
                  })),
              })
            }
          >
            <Check size={16} />
            {busy ? 'Importing…' : `Import ${selected.length} transactions`}
          </button>
        )}
      </footer>
      {errors.length > 0 && step === 2 && (
        <p className="text-red small">
          Uncheck invalid rows or correct your column mapping to continue.
        </p>
      )}
    </div>
  );
}
