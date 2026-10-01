import React, { useEffect, useMemo, useState } from 'react';
import {
  Wallet,
  LayoutGrid,
  ArrowLeftRight,
  ChartNoAxesCombined,
  Settings,
  Plus,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ArrowRight,
  ArrowUpRight,
  Search,
  Upload,
  Download,
  Check,
  CheckCircle2,
  Circle,
  MoreHorizontal,
  ShieldCheck,
  Leaf,
  X,
  CreditCard,
  Landmark,
  Banknote,
  Sprout,
  MoveRight,
  CircleHelp,
  Pencil,
  Trash2,
  Menu,
  FolderPlus,
  Target,
  TrendingUp,
  CalendarDays,
} from 'lucide-react';
import { calculateBudget } from '../shared/budget.js';
import { cents, money, today, nextMonth, validMonth } from '../shared/money.js';
import { Modal, Field, Amount, Empty, Direction, CategoryOptions } from './components.jsx';
import ImportWizard from './ImportWizard.jsx';
const monthLabel = (m) =>
  new Date(m + '-02T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
const accountIcon = (type) =>
  type === 'credit' ? CreditCard : type === 'cash' ? Banknote : Landmark;
async function api(path, method = 'GET', body) {
  const r = await fetch('/api' + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const value = await r.json();
  if (!r.ok) throw new Error(value.error || 'Request failed.');
  return value;
}
export default function App() {
  const [budgets, setBudgets] = useState([]),
    [data, setData] = useState(null),
    [budgetId, setBudgetId] = useState(localStorage.getItem('ywab-budget') || ''),
    [month, setMonth] = useState(today().slice(0, 7));
  const [view, setView] = useState('budget'),
    [accountFilter, setAccountFilter] = useState('all'),
    [search, setSearch] = useState(''),
    [statusFilter, setStatusFilter] = useState('all'),
    [selected, setSelected] = useState(null),
    [collapsed, setCollapsed] = useState(new Set()),
    [modal, setModal] = useState(null),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [toast, setToast] = useState(''),
    [mobile, setMobile] = useState(false);
  const snapshot = useMemo(() => (data ? calculateBudget(data, month) : null), [data, month]);
  const currentBalances = useMemo(
    () => (data ? calculateBudget(data, today().slice(0, 7)).accounts : []),
    [data],
  );
  async function refresh(id = budgetId) {
    const [list, detail] = await Promise.all([
      api('/budgets'),
      id ? api('/budgets/' + id) : Promise.resolve(null),
    ]);
    setBudgets(list);
    if (detail) setData(detail);
    else if (list.length) setBudgetId(list[0].id);
    return detail;
  }
  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([api('/budgets'), budgetId ? api('/budgets/' + budgetId) : Promise.resolve(null)])
      .then(([list, detail]) => {
        if (!active) return;
        setBudgets(list);
        if (detail) {
          setData(detail);
          localStorage.setItem('ywab-budget', budgetId);
        } else if (list.length) setBudgetId(list[0].id);
        else setData(null);
        setError('');
      })
      .catch((e) => {
        if (!active) return;
        if (budgetId) {
          localStorage.removeItem('ywab-budget');
          setBudgetId('');
          setData(null);
        }
        setError(e.message);
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [budgetId]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 5000);
    return () => clearTimeout(t);
  }, [toast]);
  const open = (m) => {
    setError('');
    setModal(m);
  };
  const close = () => {
    if (!busy) {
      setModal(null);
      setError('');
    }
  };
  async function mutate(path, method, body, message, closeModal = true) {
    setBusy(true);
    setError('');
    try {
      const result = await api('/budgets/' + budgetId + path, method, body);
      await refresh();
      if (closeModal) setModal(null);
      if (message) setToast(typeof message === 'function' ? message(result) : message);
      return result;
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function createBudget(name, demo = false) {
    setBusy(true);
    setError('');
    try {
      const result = await api('/budgets', 'POST', { name, demo });
      setBudgetId(result.budget.id);
      setData(result);
      setSelected(null);
      setView('budget');
      setModal(null);
      setToast(
        demo
          ? 'Sample budget created. Explore freely.'
          : 'Your budget is ready. Start by adding an account.',
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function restore(file) {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('Backup must be smaller than 20 MB.');
      const payload = JSON.parse(await file.text());
      const result = await api('/restore', 'POST', payload);
      setBudgetId(result.budget.id);
      setData(result);
      setView('budget');
      setModal(null);
      setToast('Backup imported as a separate budget.');
    } catch (e) {
      setError(e instanceof SyntaxError ? 'That file is not a valid JSON backup.' : e.message);
    } finally {
      setBusy(false);
    }
  }
  function nav(next, account = 'all') {
    setView(next);
    setAccountFilter(account);
    setSearch('');
    setStatusFilter('all');
    setMobile(false);
  }
  function download() {
    const a = document.createElement('a');
    a.href = '/api/budgets/' + budgetId + '/export';
    a.download = `${data.budget.name}-backup.json`;
    a.click();
  }
  const switchBudget = (id) => {
    setBudgetId(id);
    setSelected(null);
    setAccountFilter('all');
    setView('budget');
  };
  const formError = error && (
    <div className="error" role="alert">
      {error}
    </div>
  );
  const chosen = snapshot?.rows.find((c) => c.id === selected);
  const filtered =
    data?.transactions.filter(
      (t) =>
        (accountFilter === 'all' || t.accountId === accountFilter) &&
        (statusFilter !== 'uncategorized' || (!t.categoryId && !t.transferId && t.amount < 0)) &&
        (statusFilter !== 'uncleared' || !t.cleared) &&
        `${t.payee} ${t.memo} ${data.categories.find((c) => c.id === t.categoryId)?.name || ''}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    ) || [];
  const totalBalance = currentBalances.reduce((s, a) => s + a.balance, 0);
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobile ? 'mobile-open' : ''}`}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            nav('budget');
          }}
        >
          <span className="brand-mark">
            <Sprout size={25} />
          </span>
          <span>
            you want
            <br />
            <b>a budget.</b>
          </span>
        </a>
        <div className="budget-picker">
          <label htmlFor="budget-select">YOUR SPACE</label>
          <select
            id="budget-select"
            value={data?.budget.id || ''}
            onChange={(e) =>
              e.target.value === 'new' ? open({ type: 'newbudget' }) : switchBudget(e.target.value)
            }
          >
            {!budgets.length && <option value="">My budget</option>}
            {budgets.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
                {b.isDemo ? ' · Demo' : ''}
              </option>
            ))}
            <option value="new">＋ Create a budget</option>
          </select>
        </div>
        <nav className="main-nav">
          {[
            ['budget', LayoutGrid, 'Budget'],
            ['transactions', ArrowLeftRight, 'Transactions'],
            ['reports', ChartNoAxesCombined, 'Insights'],
          ].map(([key, Icon, label]) => (
            <button
              key={key}
              className={view === key && accountFilter === 'all' ? 'active' : ''}
              onClick={() => nav(key)}
            >
              <Icon size={19} />
              {label}
              {key === 'budget' && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="accounts-header">
          <span>YOUR ACCOUNTS</span>
          <button
            aria-label="Add account"
            title="Add account"
            disabled={!data}
            onClick={() => open({ type: 'account' })}
          >
            <Plus size={16} />
          </button>
        </div>
        <div className="account-list">
          {currentBalances.map((a) => {
            const Icon = accountIcon(a.type);
            return (
              <button
                key={a.id}
                className={view === 'transactions' && accountFilter === a.id ? 'active' : ''}
                onClick={() => nav('transactions', a.id)}
              >
                <Icon size={16} />
                <span>{a.name}</span>
                <Amount value={a.balance} />
              </button>
            );
          })}
          {!currentBalances.length && <p>Add an account to give your money a starting point.</p>}
        </div>
        {data && (
          <div className="sidebar-total">
            <span>Total balance</span>
            <Amount value={totalBalance} />
          </div>
        )}
        <div className="sidebar-bottom">
          <div className="local-note">
            <span>
              <ShieldCheck size={17} /> Yours. Locally.
            </span>
            <p>
              Your budget lives on this device.
              <br />
              No cloud. No subscriptions.
            </p>
          </div>
          <button className={view === 'settings' ? 'active' : ''} onClick={() => nav('settings')}>
            <Settings size={18} /> Settings & backups
          </button>
          <button onClick={() => open({ type: 'help' })}>
            <CircleHelp size={18} /> A little help
          </button>
          <div className="sidebar-footer">
            <span className="avatar">Y</span>
            <span>
              Your money, your way<small>A fresh start, every day.</small>
            </span>
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div>
            <button
              className="icon-button mobile-toggle"
              aria-label="Toggle menu"
              onClick={() => setMobile(!mobile)}
            >
              <Menu size={21} />
            </button>
            <span className="breadcrumb">
              My workspace <ChevronRight size={13} />
              <b>
                {view === 'budget'
                  ? 'Monthly budget'
                  : view === 'transactions'
                    ? 'Transactions'
                    : view === 'reports'
                      ? 'Insights'
                      : 'Settings'}
              </b>
            </span>
          </div>
          <span className="saved">
            <span />
            {busy ? 'Saving…' : 'Saved on this device'}
            <ShieldCheck size={14} />
          </span>
        </header>
        {loading && !data ? (
          <div className="loading">
            <Sprout size={32} />
            <p>Opening your budget…</p>
          </div>
        ) : !data ? (
          <div className="welcome">
            <span className="eyebrow">
              <Leaf size={16} /> LESS WORRY. MORE POSSIBILITY.
            </span>
            <h1>
              Make room for
              <br />
              what matters.
            </h1>
            <p>
              Give every dollar a purpose. Build a cushion.
              <br />
              Make a plan that changes with your life.
            </p>
            <div className="welcome-actions">
              <button className="button primary" onClick={() => open({ type: 'newbudget' })}>
                Create your first budget <ArrowRight size={18} />
              </button>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => createBudget('The possibility budget', true)}
              >
                Explore a sample budget
              </button>
            </div>
            <label className="text-button import-link">
              <Upload size={15} /> Already have a backup? Import it
              <input
                hidden
                type="file"
                accept=".json"
                disabled={busy}
                onChange={(e) => restore(e.target.files[0])}
              />
            </label>
            {formError}
            <div className="welcome-illustration">
              <div className="illustration-leaf">
                <Sprout size={58} />
              </div>
              <div className="mini-card">
                <span>Peace of mind</span>
                <b>One dollar at a time.</b>
                <div className="mini-bars">
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                </div>
              </div>
            </div>
            <div className="welcome-benefits">
              <span>
                <CheckCircle2 size={17} /> Flexible envelope budgeting
              </span>
              <span>
                <CheckCircle2 size={17} /> CSV imports from your bank
              </span>
              <span>
                <CheckCircle2 size={17} /> Private by design
              </span>
            </div>
          </div>
        ) : (
          <>
            {!!data.budget.isDemo && (
              <div className="demo-banner">
                <span>
                  <Sprout size={15} /> You’re exploring a sample budget. Make yourself at home.
                </span>
                <button onClick={() => open({ type: 'newbudget' })}>
                  Start your own <ArrowRight size={14} />
                </button>
              </div>
            )}
            {error && !modal && (
              <div className="page-error error" role="alert">
                {error}
                <button onClick={() => setError('')} aria-label="Dismiss error">
                  <X size={16} />
                </button>
              </div>
            )}
            {view === 'budget' && (
              <div className="page budget-page">
                <div className="page-heading">
                  <div>
                    <span className="eyebrow">A PLAN FOR YOUR POSSIBILITIES</span>
                    <h1>
                      Your budget<span className="heading-dot">.</span>
                    </h1>
                    <p>A little intention today. A little more freedom tomorrow.</p>
                  </div>
                  <div className="heading-actions">
                    <button
                      className="button secondary"
                      onClick={() => open({ type: 'move', from: 'ready' })}
                    >
                      <ArrowLeftRight size={16} /> Move money
                    </button>
                    <button
                      className="button primary"
                      onClick={() =>
                        open({ type: data.accounts.length ? 'transaction' : 'account' })
                      }
                    >
                      <Plus size={17} />
                      {data.accounts.length ? 'Add transaction' : 'Add account'}
                    </button>
                  </div>
                </div>
                <div className="budget-topline">
                  <div className="month-controls">
                    <button
                      className="icon-button"
                      aria-label="Previous month"
                      disabled={month === '2000-01'}
                      onClick={() => setMonth(nextMonth(month, -1))}
                    >
                      <ChevronLeft size={19} />
                    </button>
                    <label className="month-label">
                      <CalendarDays size={19} />
                      <span>{monthLabel(month)}</span>
                      <input
                        aria-label="Budget month"
                        type="month"
                        min="2000-01"
                        max="2099-12"
                        value={month}
                        onChange={(e) => validMonth(e.target.value) && setMonth(e.target.value)}
                      />
                    </label>
                    <button
                      className="icon-button"
                      aria-label="Next month"
                      disabled={month === '2099-12'}
                      onClick={() => setMonth(nextMonth(month))}
                    >
                      <ChevronRight size={19} />
                    </button>
                    {month !== today().slice(0, 7) && (
                      <button className="text-button" onClick={() => setMonth(today().slice(0, 7))}>
                        Today
                      </button>
                    )}
                  </div>
                  <span className="currency-note">USD · Monthly plan</span>
                </div>
                <div className="overview-cards">
                  <div className={`ready-card ${snapshot.ready < 0 ? 'overassigned' : ''}`}>
                    <div>
                      <span className="stat-label">
                        <span className="small-dot" />
                        {snapshot.ready < 0 ? 'Overassigned' : 'Ready to assign'}
                      </span>
                      <Amount value={snapshot.ready} />
                      <p>
                        {snapshot.ready < 0
                          ? 'Move money back to cover your plan.'
                          : snapshot.ready === 0
                            ? 'Every dollar has a purpose. Nicely done.'
                            : 'Give these dollars somewhere to go.'}
                      </p>
                    </div>
                    <button
                      aria-label="Assign money"
                      onClick={() => open({ type: 'move', from: 'ready' })}
                    >
                      <ArrowUpRight size={23} />
                    </button>
                    <div className="card-orbit" />
                  </div>
                  <div className="stat-card">
                    <span className="stat-label">Assigned this month</span>
                    <Amount value={snapshot.assigned} />
                    <p>
                      <span className="stat-icon">
                        <LayoutGrid size={13} />
                      </span>{' '}
                      Across {snapshot.rows.filter((c) => c.assigned !== 0).length} categories
                    </p>
                  </div>
                  <div className="stat-card">
                    <span className="stat-label">Available to spend</span>
                    <Amount value={snapshot.available} />
                    <p>
                      <span className="stat-icon">
                        <Wallet size={13} />
                      </span>{' '}
                      Includes money carried forward
                    </p>
                  </div>
                </div>
                {snapshot.uncategorized > 0 && (
                  <button
                    className="inline-alert"
                    onClick={() => {
                      nav('transactions');
                      setStatusFilter('uncategorized');
                    }}
                  >
                    <CircleHelp size={17} />
                    {snapshot.uncategorized} transactions need a category <ArrowRight size={16} />
                  </button>
                )}
                <div className="budget-workspace">
                  <section className="budget-table-card">
                    <div className="table-toolbar">
                      <div className="tab active">
                        All categories <span>{data.categories.length}</span>
                      </div>
                      <button className="text-button" onClick={() => open({ type: 'category' })}>
                        <Plus size={15} /> Add category
                      </button>
                    </div>
                    <div className="table-scroll">
                      <table className="budget-table">
                        <thead>
                          <tr>
                            <th>Category</th>
                            <th>Assigned</th>
                            <th>Activity</th>
                            <th>Available</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.groups.map((g) => {
                            const rows = snapshot.rows.filter((c) => c.groupId === g.id);
                            return (
                              <React.Fragment key={g.id}>
                                <tr className="group-row">
                                  <td>
                                    <button
                                      onClick={() =>
                                        setCollapsed((prev) => {
                                          const n = new Set(prev);
                                          n.has(g.id) ? n.delete(g.id) : n.add(g.id);
                                          return n;
                                        })
                                      }
                                    >
                                      <ChevronDown
                                        size={15}
                                        className={collapsed.has(g.id) ? 'rotated' : ''}
                                      />
                                      {g.name}
                                      <span>{rows.length}</span>
                                    </button>
                                  </td>
                                  <td>
                                    <Amount value={rows.reduce((s, c) => s + c.assigned, 0)} />
                                  </td>
                                  <td>
                                    <Amount value={rows.reduce((s, c) => s + c.activity, 0)} />
                                  </td>
                                  <td>
                                    <Amount value={rows.reduce((s, c) => s + c.available, 0)} />
                                  </td>
                                </tr>
                                {!collapsed.has(g.id) &&
                                  rows.map((c) => (
                                    <tr
                                      className={`category-row ${selected === c.id ? 'selected' : ''}`}
                                      key={c.id}
                                    >
                                      <td>
                                        <button
                                          className="category-name"
                                          onClick={() =>
                                            setSelected(selected === c.id ? null : c.id)
                                          }
                                        >
                                          {c.accountId ? (
                                            <CreditCard size={16} />
                                          ) : (
                                            <span
                                              className={`category-dot ${c.available < 0 ? 'danger' : c.target && c.available < c.target ? 'partial' : 'funded'}`}
                                            />
                                          )}
                                          <span>
                                            {c.name}
                                            {c.target > 0 && (
                                              <span className="target-progress">
                                                <i
                                                  style={{
                                                    width: `${Math.min(100, Math.max(0, (c.available / c.target) * 100))}%`,
                                                  }}
                                                />
                                              </span>
                                            )}
                                          </span>
                                        </button>
                                      </td>
                                      <td>
                                        <AssignmentInput
                                          key={`${c.id}-${month}-${c.assigned}`}
                                          value={c.assigned}
                                          name={c.name}
                                          disabled={busy}
                                          onSave={(v) =>
                                            mutate(
                                              '/assignments',
                                              'PUT',
                                              { categoryId: c.id, month, amount: v },
                                              '',
                                              false,
                                            )
                                          }
                                          onError={setError}
                                        />
                                      </td>
                                      <td>
                                        <Amount value={c.activity} className="activity-number" />
                                      </td>
                                      <td>
                                        <button
                                          className={`available-pill ${c.available < 0 ? 'negative' : c.available === 0 ? 'zero' : c.target && c.available < c.target ? 'under' : 'positive'}`}
                                          title="Move money to or from this category"
                                          onClick={() =>
                                            open({
                                              type: 'move',
                                              from: c.available > 0 ? c.id : 'ready',
                                              to: c.available < 0 ? c.id : undefined,
                                            })
                                          }
                                        >
                                          {c.available < 0 && <span>!</span>}
                                          {money(c.available)}
                                        </button>
                                      </td>
                                    </tr>
                                  ))}
                              </React.Fragment>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr>
                            <td>Total</td>
                            <td>
                              <Amount value={snapshot.assigned} />
                            </td>
                            <td>
                              <Amount value={snapshot.rows.reduce((s, c) => s + c.activity, 0)} />
                            </td>
                            <td>
                              <Amount value={snapshot.rows.reduce((s, c) => s + c.available, 0)} />
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                    <button className="add-group" onClick={() => open({ type: 'group' })}>
                      <FolderPlus size={16} /> Add category group
                    </button>
                  </section>
                  <aside className="budget-details">
                    {chosen ? (
                      <>
                        <div className="detail-title">
                          <span className="eyebrow">CATEGORY DETAILS</span>
                          <button
                            className="icon-button"
                            aria-label="Clear category selection"
                            onClick={() => setSelected(null)}
                          >
                            <X size={16} />
                          </button>
                        </div>
                        <h2>{chosen.name}</h2>
                        <span className="detail-available">Available this month</span>
                        <Amount
                          className={chosen.available < 0 ? 'text-red' : 'detail-amount'}
                          value={chosen.available}
                        />
                        <div className="detail-breakdown">
                          <div>
                            <span>Carried forward</span>
                            <Amount value={chosen.carried} />
                          </div>
                          <div>
                            <span>Assigned</span>
                            <Amount value={chosen.assigned} />
                          </div>
                          <div>
                            <span>Activity</span>
                            <Amount value={chosen.activity} />
                          </div>
                        </div>
                        {chosen.target > 0 && (
                          <div className="target-box">
                            <Target size={18} />
                            <span>
                              Monthly balance target<b>{money(chosen.target)}</b>
                            </span>
                            <small>
                              {money(Math.max(0, chosen.target - chosen.available))} to go
                            </small>
                          </div>
                        )}
                        {chosen.accountId && (
                          <p className="muted small">
                            Funded card purchases move money here automatically. Assign extra to pay
                            down older debt.
                          </p>
                        )}
                        {chosen.available < 0 && (
                          <p className="text-red small">
                            {chosen.creditOverspent > 0
                              ? `${money(chosen.creditOverspent)} is unfunded card spending. `
                              : ''}
                            Move money here to cover overspending.
                          </p>
                        )}
                        <button
                          className="button primary full"
                          onClick={() =>
                            open({
                              type: 'move',
                              from: chosen.available > 0 ? chosen.id : 'ready',
                              to: chosen.available <= 0 ? chosen.id : undefined,
                            })
                          }
                        >
                          <ArrowLeftRight size={15} /> Move money
                        </button>
                        <button
                          className="button secondary full"
                          onClick={() => open({ type: 'category', category: chosen })}
                        >
                          <Pencil size={14} /> Edit category & target
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="eyebrow">THE BIG PICTURE</span>
                        <h2>
                          Small steps.
                          <br />
                          Real progress.
                        </h2>
                        <div
                          className="summary-ring"
                          style={{
                            '--progress': `${Math.min(100, Math.max(0, (snapshot.assigned / (snapshot.assigned + Math.max(0, snapshot.ready) || 1)) * 100))}%`,
                          }}
                        >
                          <div>
                            <b>
                              {Math.round(
                                Math.min(
                                  100,
                                  Math.max(
                                    0,
                                    (snapshot.assigned /
                                      (snapshot.assigned + Math.max(0, snapshot.ready) || 1)) *
                                      100,
                                  ),
                                ),
                              )}
                              <small>%</small>
                            </b>
                            <span>of your money assigned</span>
                          </div>
                        </div>
                        <div className="detail-breakdown">
                          <div>
                            <span>Assigned this month</span>
                            <Amount value={snapshot.assigned} />
                          </div>
                          <div>
                            <span>Spent this month</span>
                            <Amount value={snapshot.spending} />
                          </div>
                          <div>
                            <span>Overspent categories</span>
                            <span className={snapshot.overspent ? 'text-red' : 'text-green'}>
                              {snapshot.rows.filter((c) => c.available < 0).length}
                            </span>
                          </div>
                        </div>
                        <div className="gentle-tip">
                          <span>
                            <Leaf size={17} /> A little flexibility goes a long way
                          </span>
                          <p>Plans change. Move money between categories whenever life does.</p>
                        </div>
                        <p className="detail-footnote">
                          Select a category to see its balance, set a target, or move money.
                        </p>
                      </>
                    )}
                  </aside>
                </div>
                <div className="page-footnote">
                  <ShieldCheck size={14} /> Your progress is saved automatically. Your money stays
                  your business.
                </div>
              </div>
            )}
            {view === 'transactions' && (
              <div className="page">
                <div className="page-heading">
                  <div>
                    <span className="eyebrow">KNOW WHERE IT GOES</span>
                    <h1>
                      {accountFilter === 'all'
                        ? 'Transactions'
                        : data.accounts.find((a) => a.id === accountFilter)?.name}
                      <span className="heading-dot">.</span>
                    </h1>
                    <p>
                      {accountFilter === 'all'
                        ? 'The little things, the big things. All in one place.'
                        : `Working balance: ${money(currentBalances.find((a) => a.id === accountFilter)?.balance)}`}
                    </p>
                  </div>
                  <div className="heading-actions">
                    {accountFilter !== 'all' && (
                      <button
                        className="icon-button bordered"
                        title="Edit account"
                        aria-label="Edit account"
                        onClick={() =>
                          open({
                            type: 'account',
                            account: data.accounts.find((a) => a.id === accountFilter),
                          })
                        }
                      >
                        <Pencil size={17} />
                      </button>
                    )}
                    <button
                      className="button secondary"
                      disabled={!data.accounts.length}
                      onClick={() => open({ type: 'import' })}
                    >
                      <Upload size={16} /> Import CSV
                    </button>
                    <button
                      className="button primary"
                      onClick={() =>
                        open({ type: data.accounts.length ? 'transaction' : 'account' })
                      }
                    >
                      <Plus size={17} />
                      {data.accounts.length ? 'Add transaction' : 'Add account'}
                    </button>
                  </div>
                </div>
                <div className="register-card">
                  <div className="register-toolbar">
                    <label className="search-input">
                      <Search size={17} />
                      <input
                        aria-label="Search transactions"
                        placeholder="Search payees, categories, notes…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </label>
                    <select
                      aria-label="Filter transactions"
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value)}
                    >
                      <option value="all">All transactions</option>
                      <option value="uncategorized">Needs a category</option>
                      <option value="uncleared">Uncleared</option>
                    </select>
                    <button
                      className="text-button"
                      disabled={data.accounts.length < 2}
                      onClick={() => open({ type: 'transfer' })}
                    >
                      <ArrowLeftRight size={15} /> Account transfer
                    </button>
                  </div>
                  {filtered.length ? (
                    <div className="table-scroll">
                      <table className="transaction-table">
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Payee</th>
                            <th>Category</th>
                            {accountFilter === 'all' && <th>Account</th>}
                            <th className="align-right">Amount</th>
                            <th className="center">Cleared</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {filtered.map((t) => (
                            <tr key={t.id}>
                              <td className="date-cell">
                                {new Date(t.date + 'T12:00:00').toLocaleDateString('en-US', {
                                  month: 'short',
                                  day: 'numeric',
                                  year: '2-digit',
                                })}
                              </td>
                              <td>
                                <div className="payee-cell">
                                  <Direction amount={t.amount} />
                                  <span>
                                    <strong>{t.payee}</strong>
                                    {t.memo && <small>{t.memo}</small>}
                                  </span>
                                </div>
                              </td>
                              <td>
                                <span
                                  className={
                                    !t.categoryId && !t.transferId && t.amount < 0
                                      ? 'category-badge needs'
                                      : 'category-badge'
                                  }
                                >
                                  {t.transferId
                                    ? 'Account transfer'
                                    : data.categories.find((c) => c.id === t.categoryId)?.name ||
                                      (t.amount > 0 ? 'Ready to assign' : 'Needs a category')}
                                </span>
                              </td>
                              {accountFilter === 'all' && (
                                <td className="muted">
                                  {data.accounts.find((a) => a.id === t.accountId)?.name}
                                </td>
                              )}
                              <td className="align-right">
                                <Amount
                                  value={t.amount}
                                  className={t.amount > 0 ? 'text-green' : ''}
                                />
                              </td>
                              <td className="center">
                                <button
                                  className={`clear-button ${t.cleared ? 'cleared' : ''}`}
                                  aria-label={`${t.cleared ? 'Mark uncleared' : 'Mark cleared'}: ${t.payee}`}
                                  disabled={busy}
                                  onClick={() =>
                                    mutate(
                                      '/transactions/' + t.id,
                                      'PATCH',
                                      { cleared: !t.cleared },
                                      '',
                                      false,
                                    )
                                  }
                                >
                                  {t.cleared ? <CheckCircle2 size={18} /> : <Circle size={18} />}
                                </button>
                              </td>
                              <td>
                                <button
                                  className="icon-button"
                                  aria-label={`Edit ${t.payee}`}
                                  onClick={() =>
                                    open({
                                      type: t.transferId ? 'delete' : 'transaction',
                                      transaction: t,
                                    })
                                  }
                                >
                                  {t.transferId ? (
                                    <Trash2 size={15} />
                                  ) : (
                                    <MoreHorizontal size={19} />
                                  )}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <Empty
                      icon={ArrowLeftRight}
                      title={search ? 'No matching transactions' : 'A clear picture starts here'}
                      action={
                        !search && (
                          <button
                            className="button primary"
                            onClick={() =>
                              open({ type: data.accounts.length ? 'transaction' : 'account' })
                            }
                          >
                            <Plus size={16} />
                            {data.accounts.length ? 'Add a transaction' : 'Add an account'}
                          </button>
                        )
                      }
                    >
                      {search
                        ? 'Try another payee, category, or note.'
                        : 'Add your everyday spending or import a CSV from your bank.'}
                    </Empty>
                  )}
                  <div className="register-footer">
                    <span>{filtered.length} transactions · All dates</span>
                    <span>
                      Net activity <Amount value={filtered.reduce((s, t) => s + t.amount, 0)} />
                    </span>
                  </div>
                </div>
              </div>
            )}
            {view === 'reports' && (
              <Insights data={data} month={month} setMonth={setMonth} snapshot={snapshot} />
            )}
            {view === 'settings' && (
              <div className="page settings-page">
                <div className="page-heading">
                  <div>
                    <span className="eyebrow">A SPACE THAT’S YOURS</span>
                    <h1>
                      Settings & backups<span className="heading-dot">.</span>
                    </h1>
                    <p>Keep your budget safe, portable, and entirely yours.</p>
                  </div>
                </div>
                <section className="settings-card">
                  <div className="settings-icon">
                    <Wallet size={23} />
                  </div>
                  <div>
                    <h2>{data.budget.name}</h2>
                    <p>
                      USD · {data.accounts.length} accounts · {data.categories.length} categories
                    </p>
                    <div className="button-row">
                      <button className="button secondary" onClick={() => open({ type: 'rename' })}>
                        <Pencil size={15} /> Rename budget
                      </button>
                      <button
                        className="button secondary"
                        onClick={() => open({ type: 'newbudget' })}
                      >
                        <Plus size={15} /> New budget
                      </button>
                    </div>
                  </div>
                </section>
                <section className="settings-card">
                  <div className="settings-icon">
                    <ShieldCheck size={23} />
                  </div>
                  <div>
                    <h2>Your data stays here</h2>
                    <p>
                      Budgets are stored in a local SQLite database, excluded from Git. There are no
                      analytics, remote fonts, or cloud services. Keep this app on your own
                      computer.
                    </p>
                    <p className="small muted">
                      Local database: <code>.local-data/budgets.sqlite</code> (or your configured
                      BUDGET_DATA_DIR). Back up regularly; this is not cloud storage.
                    </p>
                  </div>
                </section>
                <section className="settings-card">
                  <div className="settings-icon">
                    <Download size={23} />
                  </div>
                  <div>
                    <h2>A fresh backup. A little peace of mind.</h2>
                    <p>
                      Export your complete budget, accounts, categories, assignments, and
                      transactions as a portable JSON file. Imports create a separate budget and
                      preserve the original.
                    </p>
                    <div className="button-row">
                      <button className="button primary" onClick={download}>
                        <Download size={16} /> Export budget
                      </button>
                      <label className="button secondary">
                        <Upload size={16} /> Import budget
                        <input
                          hidden
                          disabled={busy}
                          type="file"
                          accept=".json,application/json"
                          onChange={(e) => {
                            restore(e.target.files[0]);
                            e.target.value = '';
                          }}
                        />
                      </label>
                    </div>
                  </div>
                </section>
                <section className="settings-card">
                  <div className="settings-icon">
                    <Landmark size={23} />
                  </div>
                  <div>
                    <h2>Works with your bank. On your terms.</h2>
                    <p>
                      Use manual transactions or CSV exports from Chase, American Express, Capital
                      One, Bank of America, Wells Fargo, Citi, Discover, and other banks through
                      custom column mapping.
                    </p>
                    <p className="small muted">
                      Direct bank connections are not enabled in this version. No bank credentials
                      are requested or stored.
                    </p>
                  </div>
                </section>
              </div>
            )}
          </>
        )}
      </main>
      {mobile && (
        <button
          className="sidebar-scrim"
          aria-label="Close menu"
          onClick={() => setMobile(false)}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
          <button aria-label="Dismiss notification" onClick={() => setToast('')}>
            <X size={16} />
          </button>
        </div>
      )}
      {modal && (
        <Modal
          title={modalTitle(modal)}
          subtitle={modalSubtitle(modal)}
          onClose={close}
          wide={modal.type === 'import'}
        >
          {renderModal()}
        </Modal>
      )}
    </div>
  );
  function renderModal() {
    if (modal.type === 'help')
      return (
        <div className="help-content">
          <div className="help-step">
            <b>01</b>
            <div>
              <h3>Start with the money you have.</h3>
              <p>
                Add checking, savings, cash, or credit card accounts with a starting balance.
                Opening cash is ready to assign. Existing card debt needs its own payment funding.
              </p>
            </div>
          </div>
          <div className="help-step">
            <b>02</b>
            <div>
              <h3>Give every dollar a purpose.</h3>
              <p>
                Enter amounts in the Assigned column. Positive category balances carry into the next
                month. Targets are monthly available-balance goals; they never move money
                automatically.
              </p>
            </div>
          </div>
          <div className="help-step">
            <b>03</b>
            <div>
              <h3>Roll with real life.</h3>
              <p>
                Move money whenever priorities change. Cash overspending reduces next month’s
                ready-to-assign money. Unfunded credit spending becomes card debt. Cover it now, or
                assign directly to the card payment category later.
              </p>
            </div>
          </div>
          <div className="help-step">
            <b>04</b>
            <div>
              <h3>Keep the picture up to date.</h3>
              <p>
                Record spending, income, and refunds, or import bank CSVs. Use account transfers for
                moving money or paying cards; these aren’t new income or expenses. Mark posted
                transactions cleared.
              </p>
            </div>
          </div>
          <div className="notice">
            <ShieldCheck size={22} />
            <p>
              Use Settings & backups to export regularly. This app is local and independent, and is
              not affiliated with YNAB.
            </p>
          </div>
        </div>
      );
    if (modal.type === 'import')
      return (
        <>
          {formError}
          <ImportWizard
            data={data}
            initialAccount={accountFilter === 'all' ? undefined : accountFilter}
            busy={busy}
            onImport={(body) =>
              mutate(
                '/import',
                'POST',
                body,
                (r) => `${r.imported} transactions imported. ${r.skipped} duplicates skipped.`,
              )
            }
          />
        </>
      );
    if (modal.type === 'newbudget' || modal.type === 'rename')
      return (
        <Form
          busy={busy}
          error={formError}
          submitLabel={modal.type === 'rename' ? 'Save name' : 'Create budget'}
          onSubmit={(f) =>
            modal.type === 'rename'
              ? mutate('', 'PATCH', { name: f.get('name') }, 'Budget renamed.')
              : createBudget(f.get('name'))
          }
        >
          <Field label="Budget name">
            <input
              name="name"
              autoFocus
              required
              maxLength={180}
              placeholder="My possibility budget"
              defaultValue={modal.type === 'rename' ? data.budget.name : ''}
            />
          </Field>
          {modal.type === 'newbudget' && (
            <p className="muted small">
              Start with a thoughtful set of categories. Make them your own, then add your accounts.
            </p>
          )}
        </Form>
      );
    if (modal.type === 'account') {
      const a = modal.account;
      return (
        <Form
          busy={busy}
          error={formError}
          submitLabel={a ? 'Save account' : 'Add account'}
          onSubmit={(f) => {
            try {
              const type = a?.type || f.get('type');
              const balance = cents(f.get('balance'));
              return mutate(
                '/accounts' + (a ? '/' + a.id : ''),
                a ? 'PATCH' : 'POST',
                {
                  name: f.get('name'),
                  type,
                  openingBalance: type === 'credit' && !a ? -Math.abs(balance) : balance,
                  openingDate: f.get('date'),
                },
                a ? 'Account updated.' : 'Account added.',
              );
            } catch (e) {
              setError(e.message);
            }
          }}
        >
          <Field label="Account name">
            <input
              name="name"
              autoFocus
              required
              maxLength={200}
              placeholder="e.g. Chase checking"
              defaultValue={a?.name}
            />
          </Field>
          <Field label="Account type">
            <select name="type" defaultValue={a?.type || 'checking'} disabled={!!a}>
              <option value="checking">Checking</option>
              <option value="savings">Savings</option>
              <option value="cash">Cash</option>
              <option value="credit">Credit card</option>
            </select>
          </Field>
          <div className="form-grid">
            <Field
              label="Opening balance"
              hint={
                a?.type === 'credit'
                  ? 'Use a negative amount for card debt.'
                  : 'For a new credit card, enter the amount owed.'
              }
            >
              <input
                name="balance"
                inputMode="decimal"
                required
                defaultValue={a ? (a.openingBalance / 100).toFixed(2) : '0.00'}
              />
            </Field>
            <Field label="Opening date" hint="Use the balance before transactions on this date.">
              <input
                name="date"
                type="date"
                min="2000-01-01"
                max="2099-12-31"
                required
                defaultValue={a?.openingDate || today()}
              />
            </Field>
          </div>
          <p className="muted small">
            Importing older transactions? Use an opening date and balance from before that history
            begins, so those transactions aren’t counted twice.
          </p>
        </Form>
      );
    }
    if (modal.type === 'group')
      return (
        <Form
          busy={busy}
          error={formError}
          submitLabel="Add group"
          onSubmit={(f) =>
            mutate('/groups', 'POST', { name: f.get('name') }, 'Category group added.')
          }
        >
          <Field label="Group name">
            <input
              name="name"
              required
              autoFocus
              placeholder="e.g. The good life"
              maxLength={200}
            />
          </Field>
        </Form>
      );
    if (modal.type === 'category') {
      const c = modal.category;
      return (
        <Form
          busy={busy}
          error={formError}
          submitLabel={c ? 'Save category' : 'Add category'}
          onSubmit={(f) => {
            try {
              return mutate(
                '/categories' + (c ? '/' + c.id : ''),
                c ? 'PATCH' : 'POST',
                {
                  name: f.get('name'),
                  groupId: f.get('groupId'),
                  target: cents(f.get('target') || '0'),
                },
                c ? 'Category updated.' : 'Category added.',
              );
            } catch (e) {
              setError(e.message);
            }
          }}
        >
          <Field label="Category name">
            <input
              autoFocus
              name="name"
              required
              maxLength={200}
              disabled={!!c?.accountId}
              defaultValue={c?.name}
              placeholder="e.g. A weekend away"
            />
          </Field>
          <Field label="Category group">
            <select name="groupId" defaultValue={c?.groupId || data.groups[0]?.id}>
              {data.groups.map((g) => (
                <option value={g.id} key={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Monthly balance target (optional)"
            hint="A goal for available money, including money carried forward."
          >
            <input
              name="target"
              inputMode="decimal"
              placeholder="0.00"
              defaultValue={c?.target ? (c.target / 100).toFixed(2) : ''}
            />
          </Field>
          {c && !c.accountId && (
            <button
              type="button"
              className="text-button text-red"
              onClick={() => open({ type: 'deleteCategory', category: c })}
            >
              <Trash2 size={15} /> Delete category
            </button>
          )}
        </Form>
      );
    }
    if (modal.type === 'transaction') {
      const t = modal.transaction;
      return (
        <TransactionForm
          key={t?.id || 'new'}
          data={data}
          transaction={t}
          account={accountFilter}
          busy={busy}
          error={formError}
          onError={setError}
          onSave={(body) =>
            mutate(
              '/transactions' + (t ? '/' + t.id : ''),
              t ? 'PATCH' : 'POST',
              body,
              t ? 'Transaction updated.' : 'Transaction added.',
            )
          }
          onDelete={() => open({ type: 'delete', transaction: t })}
        />
      );
    }
    if (modal.type === 'transfer')
      return (
        <Form
          busy={busy}
          error={formError}
          submitLabel="Transfer money"
          onSubmit={(f) => {
            try {
              return mutate(
                '/transfers',
                'POST',
                {
                  from: f.get('from'),
                  to: f.get('to'),
                  date: f.get('date'),
                  amount: cents(f.get('amount')),
                  memo: f.get('memo'),
                  cleared: false,
                },
                'Transfer recorded in both accounts.',
              );
            } catch (e) {
              setError(e.message);
            }
          }}
        >
          <div className="form-grid">
            <Field label="From account">
              <select
                name="from"
                defaultValue={accountFilter !== 'all' ? accountFilter : undefined}
              >
                {data.accounts
                  .filter((a) => a.type !== 'credit')
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="To account">
              <select name="to" defaultValue={data.accounts[1]?.id}>
                {data.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Amount">
              <input name="amount" required autoFocus inputMode="decimal" placeholder="0.00" />
            </Field>
            <Field label="Date">
              <input
                name="date"
                type="date"
                min="2000-01-01"
                max="2099-12-31"
                required
                defaultValue={today()}
              />
            </Field>
          </div>
          <Field label="Memo (optional)">
            <input name="memo" maxLength={2000} />
          </Field>
          <p className="muted small">
            Transfers update both accounts. Credit card payments use money reserved in the card’s
            payment category.
          </p>
        </Form>
      );
    if (modal.type === 'move')
      return (
        <Form
          busy={busy}
          error={formError}
          submitLabel="Move money"
          onSubmit={(f) => {
            try {
              return mutate(
                '/move',
                'POST',
                { month, from: f.get('from'), to: f.get('to'), amount: cents(f.get('amount')) },
                'Money moved. Your plan moves with you.',
              );
            } catch (e) {
              setError(e.message);
            }
          }}
        >
          <div className="form-grid">
            <Field label="Move from">
              <select name="from" defaultValue={modal.from || 'ready'}>
                <option value="ready">Ready to assign · {money(snapshot.ready)}</option>
                {snapshot.rows.map((c) => (
                  <option value={c.id} key={c.id}>
                    {c.name} · {money(c.available)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Move to">
              <select
                name="to"
                defaultValue={
                  modal.to ||
                  (modal.from && modal.from !== 'ready' ? 'ready' : snapshot.rows[0]?.id)
                }
              >
                <option value="ready">Ready to assign</option>
                {snapshot.rows.map((c) => (
                  <option value={c.id} key={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Amount">
            <input name="amount" required autoFocus inputMode="decimal" placeholder="0.00" />
          </Field>
          <p className="muted small">
            This changes your assignments for {monthLabel(month)}. Account balances stay the same.
          </p>
        </Form>
      );
    if (modal.type === 'delete' || modal.type === 'deleteCategory')
      return (
        <div className="form-body">
          <p>
            {modal.transaction?.transferId
              ? 'Both sides of this account transfer will be deleted.'
              : modal.transaction
                ? 'This transaction will be deleted and your account and category balances recalculated.'
                : 'Only categories with no transaction or assigned-money history can be deleted.'}
          </p>
          {formError}
          <div className="modal-actions">
            <button className="button secondary" onClick={close}>
              Keep it
            </button>
            <button
              className="button danger"
              disabled={busy}
              onClick={() =>
                mutate(
                  modal.transaction
                    ? '/transactions/' + modal.transaction.id
                    : '/categories/' + modal.category.id,
                  'DELETE',
                  undefined,
                  'Deleted.',
                )
              }
            >
              {busy ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>
      );
    return null;
  }
}
function modalTitle(m) {
  return {
    newbudget: 'A new beginning.',
    rename: 'Make it yours.',
    account: m.account ? 'Edit your account' : 'Add an account',
    category: m.category ? 'Make this category yours' : 'A place for your money',
    group: 'Bring your categories together',
    transaction: m.transaction ? 'Edit transaction' : 'Add a transaction',
    transfer: 'Move between accounts',
    move: 'A little room to move.',
    import: 'Bring your transactions home.',
    delete: 'Delete this transaction?',
    deleteCategory: 'Delete this category?',
    help: 'A little guidance. A lot of possibility.',
  }[m.type];
}
function modalSubtitle(m) {
  return {
    account: 'Start with the money you have today.',
    transaction: 'The clearer the picture, the easier the plan.',
    move: 'Your budget should bend with your life.',
    import: 'Choose a file, check the details, and you’re on your way.',
  }[m.type];
}
function Form({ children, onSubmit, busy, error, submitLabel }) {
  return (
    <form
      className="form-body"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(new FormData(e.currentTarget));
      }}
    >
      {children}
      {error}
      <div className="modal-actions">
        <button className="button primary" disabled={busy} type="submit">
          {busy ? 'Saving…' : submitLabel}
          <ArrowRight size={16} />
        </button>
      </div>
    </form>
  );
}
function AssignmentInput({ value, name, onSave, onError, disabled }) {
  const [text, setText] = useState((value / 100).toFixed(2));
  async function save() {
    try {
      const n = cents(text || '0');
      setText((n / 100).toFixed(2));
      if (n !== value) {
        const result = await onSave(n);
        if (!result) setText((value / 100).toFixed(2));
      }
    } catch (e) {
      onError(e.message);
      setText((value / 100).toFixed(2));
    }
  }
  return (
    <input
      className="assignment-input money"
      aria-label={`Assigned to ${name}`}
      inputMode="decimal"
      disabled={disabled}
      value={text}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setText(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setText((value / 100).toFixed(2));
        }
      }}
    />
  );
}
function TransactionForm({
  data,
  transaction: t,
  account,
  busy,
  error,
  onSave,
  onError,
  onDelete,
}) {
  const [direction, setDirection] = useState(t?.amount > 0 ? 'inflow' : 'outflow'),
    [cat, setCat] = useState(t?.categoryId || '');
  return (
    <Form
      busy={busy}
      error={error}
      submitLabel={t ? 'Save transaction' : 'Add transaction'}
      onSubmit={(f) => {
        try {
          const n = cents(f.get('amount'));
          if (n <= 0) throw new Error('Enter a positive amount and choose inflow or outflow.');
          onSave({
            accountId: f.get('accountId'),
            date: f.get('date'),
            payee: f.get('payee'),
            categoryId: cat || null,
            amount: n * (direction === 'outflow' ? -1 : 1),
            memo: f.get('memo'),
            cleared: f.get('cleared') === 'on',
          });
        } catch (e) {
          onError(e.message);
        }
      }}
    >
      <div className="segmented">
        <button
          type="button"
          className={direction === 'outflow' ? 'active' : ''}
          onClick={() => setDirection('outflow')}
        >
          Outflow
        </button>
        <button
          type="button"
          className={direction === 'inflow' ? 'active' : ''}
          onClick={() => setDirection('inflow')}
        >
          Inflow / refund
        </button>
      </div>
      <div className="form-grid">
        <Field label="Amount">
          <input
            name="amount"
            required
            autoFocus
            inputMode="decimal"
            placeholder="0.00"
            defaultValue={t ? (Math.abs(t.amount) / 100).toFixed(2) : ''}
          />
        </Field>
        <Field label="Date">
          <input
            name="date"
            type="date"
            required
            min="2000-01-01"
            max="2099-12-31"
            defaultValue={t?.date || today()}
          />
        </Field>
      </div>
      <Field label="Payee">
        <input
          name="payee"
          required
          maxLength={200}
          defaultValue={t?.payee}
          placeholder={direction === 'outflow' ? 'Where did it go?' : 'Where did it come from?'}
          list="payees"
        />
        <datalist id="payees">
          {[...new Set(data.transactions.filter((t) => !t.transferId).map((t) => t.payee))]
            .slice(0, 100)
            .map((p) => (
              <option value={p} key={p} />
            ))}
        </datalist>
      </Field>
      <div className="form-grid">
        <Field label="Account">
          <select
            name="accountId"
            defaultValue={t?.accountId || (account === 'all' ? data.accounts[0]?.id : account)}
          >
            {data.accounts.map((a) => (
              <option value={a.id} key={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Category">
          <select value={cat} onChange={(e) => setCat(e.target.value)}>
            <CategoryOptions data={data} />
          </select>
        </Field>
      </div>
      {direction === 'inflow' && (
        <p className="muted small">
          For income, choose Ready to assign. For a refund, choose the original spending category.
        </p>
      )}
      <Field label="Memo (optional)">
        <input
          name="memo"
          defaultValue={t?.memo}
          maxLength={2000}
          placeholder="Anything you’d like to remember"
        />
      </Field>
      <label className="check-label">
        <input type="checkbox" name="cleared" defaultChecked={!!t?.cleared} /> Cleared by the bank
      </label>
      {t && (
        <button type="button" className="text-button text-red" onClick={onDelete}>
          <Trash2 size={15} /> Delete transaction
        </button>
      )}
    </Form>
  );
}
function Insights({ data, month, setMonth, snapshot }) {
  const expenses = snapshot.rows
    .filter((c) => !c.accountId && c.activity < 0)
    .sort((a, b) => a.activity - b.activity);
  const total = expenses.reduce((s, c) => s - c.activity, 0);
  const history = Array.from({ length: 6 }, (_, i) =>
    calculateBudget(data, nextMonth(month, i - 5)),
  );
  const max = Math.max(1, ...history.flatMap((s) => [s.income, s.spending]));
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">A LITTLE PERSPECTIVE</span>
          <h1>
            Your money story<span className="heading-dot">.</span>
          </h1>
          <p>See where you are. Make room for where you’re going.</p>
        </div>
        <div className="month-controls">
          <button
            className="icon-button"
            aria-label="Previous report month"
            disabled={month === '2000-01'}
            onClick={() => setMonth(nextMonth(month, -1))}
          >
            <ChevronLeft size={18} />
          </button>
          <span>{monthLabel(month)}</span>
          <button
            className="icon-button"
            aria-label="Next report month"
            disabled={month === '2099-12'}
            onClick={() => setMonth(nextMonth(month))}
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
      <div className="overview-cards">
        <div className="stat-card">
          <span className="stat-label">Income this month</span>
          <Amount value={snapshot.income} />
          <p>Excludes opening balances and transfers</p>
        </div>
        <div className="stat-card">
          <span className="stat-label">Spending this month</span>
          <Amount value={snapshot.spending} />
          <p>Spending, net of categorized refunds</p>
        </div>
        <div className="stat-card">
          <span className="stat-label">Net worth</span>
          <Amount value={snapshot.accounts.reduce((s, a) => s + a.balance, 0)} />
          <p>All accounts at the end of this month</p>
        </div>
      </div>
      <div className="insights-grid">
        <section className="insight-card">
          <h2>The rhythm of your money</h2>
          <p className="muted small">Income and spending over the last six months</p>
          <div className="chart-legend">
            <span>
              <i /> Income
            </span>
            <span>
              <i /> Spending
            </span>
          </div>
          <div className="bar-chart">
            {history.map((s) => (
              <div className="chart-month" key={s.month}>
                <div className="chart-bars">
                  <div
                    className="income-bar"
                    style={{ height: `${Math.max(1, (s.income / max) * 100)}%` }}
                    title={`Income: ${money(s.income)}`}
                  >
                    <span>{money(s.income)}</span>
                  </div>
                  <div
                    className="spending-bar"
                    style={{ height: `${Math.max(1, (s.spending / max) * 100)}%` }}
                    title={`Spending: ${money(s.spending)}`}
                  >
                    <span>{money(s.spending)}</span>
                  </div>
                </div>
                <small>
                  {new Date(s.month + '-02').toLocaleDateString('en-US', { month: 'short' })}
                </small>
              </div>
            ))}
          </div>
          <details className="chart-data">
            <summary>View exact amounts</summary>
            <table>
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Income</th>
                  <th>Spending</th>
                </tr>
              </thead>
              <tbody>
                {history.map((s) => (
                  <tr key={s.month}>
                    <td>{monthLabel(s.month)}</td>
                    <td>{money(s.income)}</td>
                    <td>{money(s.spending)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </section>
        <section className="insight-card">
          <h2>Where it went</h2>
          <p className="muted small">Your spending by category · {monthLabel(month)}</p>
          {expenses.length ? (
            <div className="spending-list">
              {expenses.map((c, i) => (
                <div key={c.id}>
                  <div>
                    <span>
                      <i
                        style={{
                          background: ['#347360', '#80a78b', '#b4b899', '#bf9771', '#7b989e'][
                            i % 5
                          ],
                        }}
                      />
                      {c.name}
                    </span>
                    <b>{money(-c.activity)}</b>
                  </div>
                  <div className="spending-track">
                    <i
                      style={{
                        width: `${(-c.activity / total) * 100}%`,
                        background: ['#347360', '#80a78b', '#b4b899', '#bf9771', '#7b989e'][i % 5],
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty icon={ChartNoAxesCombined} title="Your story is just beginning">
              Categorized transactions will show up here.
            </Empty>
          )}
        </section>
      </div>
    </div>
  );
}
