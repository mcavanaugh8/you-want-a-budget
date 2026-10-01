# You Want a Budget

A local, independent envelope-budgeting application inspired by YNAB. Built with React, Vite, Express, and SQLite. No subscriptions, telemetry, cloud storage, or bank credentials. Not affiliated with YNAB.

## Run it locally

Requires **Node.js 22.16+** (Node 24 LTS or newer recommended) and npm.

```sh
npm install
npm run dev
```

Open **http://127.0.0.1:3000**. Both the interface and API run on the same local server. The server binds exclusively to the loopback interface; it is not intended for network/public hosting.

For a production build:

```sh
npm run build
npm start
```

Set `PORT` to use a different port. The app is USD-only in this version.

## Your data

Budgets are stored in **`.local-data/budgets.sqlite`**, with SQLite WAL sidecar files. `.local-data/`, database files, exports in `backups/`, and environment files are excluded from Git. The database is created only when you start the server. No example financial data is automatically inserted.

You can place the database entirely outside the checkout:

```sh
BUDGET_DATA_DIR="$HOME/Library/Application Support/You Want a Budget" npm start
```

Always use the same data directory when restarting. Back up using **Settings & backups → Export budget**. Exports include all accounts, opening balances, category groups, targets, assignments, transactions, cleared statuses, and paired transfers in a versioned JSON format. **Import budget** restores into a separate budget, so it never overwrites an existing one. A malformed import rolls back completely. This format is specific to this app; it does not import YNAB proprietary backups.

The database directory and main database file are created with private filesystem permissions. Data and JSON exports are **not encrypted**; use your OS account and disk encryption. Keep downloaded backups somewhere private and outside Git. If copying SQLite files manually, stop the app first so you don't miss uncheckpointed WAL data.

## Getting started

1. Create a budget, or explicitly explore a labeled sample budget.
2. Add checking, savings, cash, and/or credit-card accounts. Use a starting balance immediately **before** any transactions you will enter/import on that opening date. New card balances are interpreted as amounts owed.
3. Assign the money you have to categories. Edit the **Assigned** cells directly; press Enter or leave the cell to save.
4. Add transactions or import CSVs. Use **Inflow / refund → Ready to assign** for income; select the original category for refunds. For a card payment, check **Credit card payment (no category)** in the transaction form and choose the other account. You can flag an imported transaction this way, too. If the other side already exists with the same date and opposite amount, link that entry to avoid duplicates; otherwise the app creates it.
5. Use **Move money** to shift available dollars between categories or back to Ready to assign.
6. Organize groups with the drag handle beside each group name. Arrow keys on the handle, or **Group options → Move up / Move down**, also reorder groups. The order is saved in SQLite and included in backups. **Group options → Delete group** deletes an empty group or moves its categories to another (existing or new) group before deleting it; all balances, targets, and history are preserved.
7. Browse months, inspect category targets, review accounts, mark posted transactions cleared, and export backups regularly.

## Budgeting rules

All money is calculated and stored as integer cents.

- Cash-account opening balances and uncategorized cash income add to **Ready to assign**. Negative uncategorized cash transactions reduce it and are flagged for categorization.
- Assignments allocate real money to categories; they don't alter bank balances. Negative assignments release money. Direct assignments may overassign; the Ready to assign card clearly indicates the deficit.
- Positive available balances carry forward across months, including months with no activity. Month changes recalculate the entire relevant history; changing an older transaction affects later months.
- A cash category deficit resets to zero in the following month and reduces Ready to assign by that deficit. Cover it by moving available money before month-end if possible.
- Credit cards have payment envelopes. Funded card purchases move available money from the spending category into its payment envelope. Unfunded spending becomes debt and does not reduce next month's cash. Assign directly to the payment envelope to fund old debt.
- When a category mixes cash and card spending, cash spending has priority; the remaining funds cover card purchases. With multiple cards in a category, funding is allocated in account creation order. Refunds restore the category and reduce the corresponding card payment reserve.
- Record account transfers as **Account transfer**, not income/expenses. Credit card payments also have a dedicated **Credit card payment (no category)** checkbox when adding or editing a transaction. Flagged payments are stored as paired transfers, excluded from income/spending and the Needs a category filter, and use the card payment reserve. Cash transfers create paired entries. Cash-to-card payments reduce the card payment envelope. Deleting a transfer deletes both sides. Edit a transfer by deleting and recreating it. Card-origin transfers/cash advances are not supported.
- Targets are monthly **available-balance goals**, including carryover. They are guidance, not automatic assignments or recurring scheduled contributions.
- Account registers show all entered dates. Working balances include all transactions through the current month, even dates later in that month. This version has no scheduled-transaction engine.

This is a focused YNAB-style implementation, not complete YNAB feature parity. Split transactions, reconciliation locks, automatic bank feeds, recurring transactions, multiple currencies, and loan amortization are not included. For split purchases, enter separate lines with the same payee/date and their respective categories. Credit cards are modeled as debt accounts; positive card balances/cash advances do not have YNAB's special cash-account behavior. Keep overpayment/statement-credit edge cases in mind and inspect your payment reserve.

## CSV imports

From **Transactions → Import CSV**:

1. Choose the destination account and a format. Presets include Chase, American Express, Capital One, Bank of America, Wells Fargo, Citi, and Discover, with editable column mapping for other institutions and changed layouts.
2. Choose the CSV. Comma, semicolon, and tab-delimited content, quoted text, BOMs, and common leading bank summaries are supported. Use the headerless option for exports without column names.
3. Map the date, description, and either a signed amount or separate debit/credit columns. Signed amounts take precedence when mapped. Reverse signs for positive-charge formats such as Amex and Discover (their presets do this). For unsigned amount exports, optionally map a debit/credit direction column; unrecognized directions are flagged for review. Headerless Wells Fargo expects the common five-column layout and can be remapped.
4. Select US or day-first numeric dates. ISO `YYYY-MM-DD` also works. Two-digit years mean 2000–2099. Amounts use US decimal formatting and two decimal places. This version does not convert foreign currencies.
5. Inspect the first preview and review **every amount direction**. Choose categories, uncheck invalid rows, and check potential duplicates. Invalid included rows block the import; nothing is silently discarded. Limits: 10 MB and 10,000 rows per CSV.
6. **Exclude ordinary account transfers** and record them once using an account transfer. You may import card payments, then edit each payment and check **Credit card payment (no category)**. Import both sides before flagging if you want to link them. The matching selector offers unlinked entries in the other account with the same date and opposite amount; choose the correct one, or explicitly create a separate entry. When bank posting dates differ, review and align the dates before linking. Until flagged, imported payments remain ordinary transactions; the importer does not identify them automatically.

Duplicates are compared within an account by date, signed amount, and normalized payee, with occurrence counts that preserve multiple identical purchases in one file. Duplicate detection is a heuristic, not a bank transaction ID: changed payee text can prevent a match. You may explicitly include potential duplicates. Imports and manual edits persist immediately in SQLite.

Bank export layouts vary; named presets are conveniences, not a guarantee for every institution's current layout. The column-mapping and review steps are the source of truth. No direct bank connection is required. A future provider integration can ingest transactions through the existing local API, but no such connection is enabled or presented as functional.

## Development & checks

```sh
npm test             # calculation, CSV, SQLite/API integration tests
npm run build        # production bundle
npm run test:e2e     # browser workflows using locally installed Google Chrome
```

E2E tests use an isolated temporary database and port 3101, never your working budget. Screenshots and the test backup are written under `/tmp/ywab-*`; test budgets use `/tmp/ywab-e2e.*`. Playwright uses the installed Chrome channel. To use Playwright's bundled Chromium instead, install it with `npx playwright install chromium` and remove `channel: 'chrome'` from the configuration.

- `src/`: React interface, modals, transaction register, import wizard, insights, responsive CSS.
- `shared/budget.js`: pure integer-cent month/rollover/card calculation engine.
- `shared/csv.js`: bank-file parsing, column mapping, duplicate matching.
- `server/`: SQLite schema, validated local API, atomic mutations, backup restore, Vite/static hosting.
- `tests/`: budget math, bank fixtures, API roundtrips, and real-browser workflows.

SQLite is provided by [Node's built-in SQLite module](https://nodejs.org/api/sqlite.html). Development serving and bundling use [Vite](https://vite.dev/guide/).
