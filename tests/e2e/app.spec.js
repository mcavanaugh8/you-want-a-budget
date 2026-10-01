import { test, expect } from '@playwright/test';
import { today } from '../../shared/money.js';
test('manual budget, rollover, transfers, CSV review, backups and responsive layout', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Create your first budget' }).click();
  await page.getByLabel('Budget name').fill('Browser test budget');
  await page.getByRole('button', { name: 'Create budget', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your budget.' })).toBeVisible();
  await page.getByRole('button', { name: 'Add account', exact: true }).last().click();
  await page.getByLabel('Account name').fill('Everyday checking');
  await page.getByLabel('Opening balance').fill('5000.00');
  await page.getByLabel('Opening date').fill(today().slice(0, 7) + '-01');
  await page.getByRole('dialog').getByRole('button', { name: 'Add account', exact: true }).click();
  await expect(page.locator('.ready-card')).toContainText('$5,000.00');
  const assignment = page.getByRole('textbox', { name: 'Assigned to Groceries', exact: true });
  await assignment.fill('500');
  await assignment.press('Enter');
  await expect(page.locator('.ready-card')).toContainText('$4,500.00');
  await page.getByRole('button', { name: 'Add transaction', exact: true }).click();
  await page.getByLabel('Amount', { exact: true }).fill('42.25');
  await page.getByLabel('Payee', { exact: true }).fill('Neighborhood market');
  await page.getByLabel('Category', { exact: true }).selectOption({ label: 'Groceries' });
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Add transaction', exact: true })
    .click();
  await expect(
    page
      .getByRole('row')
      .filter({ has: page.getByRole('button', { name: 'Groceries', exact: true }) }),
  ).toContainText('$457.75');
  await page.getByRole('button', { name: 'Next month', exact: true }).click();
  await expect(
    page
      .getByRole('row')
      .filter({ has: page.getByRole('button', { name: 'Groceries', exact: true }) }),
  ).toContainText('$457.75');
  await page.getByRole('button', { name: 'Previous month', exact: true }).click();
  await page.getByRole('button', { name: 'Move money', exact: true }).first().click();
  await page.getByLabel('Move from').selectOption({ label: 'Groceries · $457.75' });
  await page.getByLabel('Move to').selectOption({ label: 'Dining out' });
  await page.getByLabel('Amount', { exact: true }).fill('50');
  await page.getByRole('dialog').getByRole('button', { name: 'Move money', exact: true }).click();
  await expect(
    page
      .getByRole('row')
      .filter({ has: page.getByRole('button', { name: 'Groceries', exact: true }) }),
  ).toContainText('$407.75');
  await page.getByRole('button', { name: 'Transactions', exact: true }).click();
  await expect(page.getByText('Neighborhood market', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Import CSV', exact: true }).click();
  const usDate = today().slice(5, 7) + '/01/' + today().slice(0, 4);
  await page.locator('input[type=file]').setInputFiles({
    name: 'chase.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      `Transaction Date,Description,Amount\n${usDate},CSV market,-12.34\n${usDate},CSV paycheck,100.00`,
    ),
  });
  await page.getByRole('button', { name: 'Review transactions' }).click();
  await page.getByLabel('Category for row 1').selectOption({ label: 'Groceries' });
  await page.getByRole('button', { name: 'Import 2 transactions', exact: true }).click();
  await expect(page.getByText('CSV market', { exact: true })).toBeVisible();
  await expect(page.getByText('CSV paycheck', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Your budget.' })).toBeVisible();
  await page.getByRole('button', { name: 'Settings & backups', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export budget', exact: true }).click();
  const backup = await download;
  await backup.saveAs('/tmp/ywab-e2e-backup.json');
  await page.locator('input[type=file]').setInputFiles('/tmp/ywab-e2e-backup.json');
  await expect(page.locator('#budget-select')).toHaveValue(/.+/);
  await expect(page.getByRole('status')).toContainText('Backup imported');
  await page.getByRole('button', { name: 'Transactions', exact: true }).click();
  await expect(page.getByText('CSV market', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Insights', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your money story.' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  await page.getByRole('button', { name: 'Toggle menu' }).click();
  await page.getByRole('button', { name: 'Budget', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your budget.' })).toBeVisible();
  await page.screenshot({ path: '/tmp/ywab-mobile.png', fullPage: true, animations: 'disabled' });
  expect(errors).toEqual([]);
});
test('sample budget displays a complete, clearly labeled monthly plan', async ({ page }) => {
  await page.goto('/');
  await page.locator('#budget-select').selectOption('new');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  const result = await page.request.post('/api/budgets', {
    data: { name: 'The possibility budget', demo: true },
  });
  const data = await result.json();
  await page.reload();
  await page.locator('#budget-select').selectOption(data.budget.id);
  await expect(
    page.getByText('You’re exploring a sample budget. Make yourself at home.'),
  ).toBeVisible();
  await expect(
    page.getByRole('textbox', { name: 'Assigned to Groceries', exact: true }),
  ).toHaveValue('500.00');
  await page.screenshot({ path: '/tmp/ywab-desktop.png', fullPage: true });
});

test('groups drag, move with the keyboard, and delete safely on mobile', async ({ page }) => {
  const created = await page.request.post('/api/budgets', {
    data: { name: 'Group controls', demo: true },
  });
  const data = await created.json();
  await page.goto('/');
  await page.locator('#budget-select').selectOption(data.budget.id);
  const first = data.groups[0],
    second = data.groups[1],
    last = data.groups.at(-1);
  const groupIds = () =>
    page.locator('.group-row').evaluateAll((rows) => rows.map((r) => r.dataset.groupId));
  const handle = page.getByRole('button', { name: `Reorder ${first.name}`, exact: true });
  const destination = page.locator(`[data-group-id="${last.id}"]`);
  for (const group of data.groups)
    await page.locator(`[data-group-id="${group.id}"] .group-collapse`).click();
  await handle.dragTo(destination, { targetPosition: { x: 40, y: 30 } });
  await expect.poll(async () => (await groupIds()).at(-1)).toBe(first.id);
  await handle.focus();
  await handle.press('ArrowUp');
  await expect.poll(async () => (await groupIds()).at(-2)).toBe(first.id);
  await page.reload();
  await expect.poll(async () => (await groupIds()).at(-2)).toBe(first.id);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: `Options for ${first.name}`, exact: true }).click();
  await page.getByRole('button', { name: 'Move up', exact: true }).click();
  await expect(
    page.getByText(`Position ${data.groups.length - 2} of ${data.groups.length}`, { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Delete group', exact: true }).click();
  await page.getByLabel('Move categories to').selectOption(second.id);
  await page.getByRole('button', { name: 'Delete group', exact: true }).click();
  await expect(
    page.getByRole('button', { name: `Reorder ${first.name}`, exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('textbox', { name: 'Assigned to Groceries', exact: true }),
  ).toHaveValue('500.00');
  const after = await (await page.request.get('/api/budgets/' + data.budget.id)).json();
  expect(after.categories.find((c) => c.name === 'Groceries').groupId).toBe(second.id);
  expect(after.transactions).toEqual(data.transactions);
  expect(after.assignments).toEqual(data.assignments);
  await page.reload();
  await expect(
    page.getByRole('button', { name: `Reorder ${first.name}`, exact: true }),
  ).toHaveCount(0);
});

test('credit card payment flag hides categories and links imported sides without duplicates', async ({
  page,
}) => {
  const data = await (
    await page.request.post('/api/budgets', { data: { name: 'Card payment flow', demo: true } })
  ).json();
  const cash = data.accounts.find((a) => a.type === 'checking'),
    card = data.accounts.find((a) => a.type === 'credit');
  for (const row of [
    { accountId: cash.id, amount: -5000, payee: 'Imported card autopay' },
    { accountId: card.id, amount: 5000, payee: 'Imported payment received' },
  ]) {
    await page.request.post('/api/budgets/' + data.budget.id + '/transactions', {
      data: { ...row, date: today(), cleared: true },
    });
  }
  await page.goto('/');
  await page.locator('#budget-select').selectOption(data.budget.id);
  await page.getByRole('button', { name: 'Transactions', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Imported card autopay', exact: true }).click();
  await page
    .getByRole('checkbox', { name: 'Credit card payment (no category)', exact: true })
    .check();
  await expect(page.getByLabel('Category', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Paid to credit card')).toHaveValue(card.id);
  const match = page.getByLabel('Matching transaction in the other account');
  await expect(match).not.toHaveValue('');
  await page.getByRole('button', { name: 'Save transaction', exact: true }).click();
  const cashRow = page
    .getByRole('row')
    .filter({ has: page.getByText('Imported card autopay', { exact: true }) });
  await expect(cashRow).toContainText('Credit card payment');
  let saved = await (await page.request.get('/api/budgets/' + data.budget.id)).json();
  expect(saved.transactions.length).toBe(data.transactions.length + 2);
  expect(saved.transactions.filter((t) => t.transferId).length).toBe(2);
  await page.getByRole('combobox', { name: 'Filter transactions' }).selectOption('uncategorized');
  await expect(page.getByText('Imported card autopay', { exact: true })).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Filter transactions' }).selectOption('all');
  await page.getByRole('button', { name: 'Add transaction', exact: true }).click();
  await page
    .getByRole('checkbox', { name: 'Credit card payment (no category)', exact: true })
    .check();
  await page.getByLabel('Amount', { exact: true }).fill('10.00');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Add transaction', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  saved = await (await page.request.get('/api/budgets/' + data.budget.id)).json();
  expect(saved.transactions.length).toBe(data.transactions.length + 4);
  expect(saved.transactions.filter((t) => t.transferId && !t.categoryId).length).toBe(4);
  await page.reload();
  await page.getByRole('button', { name: 'Transactions', exact: true }).click();
  await expect(
    page.locator('.category-badge').filter({ hasText: 'Credit card payment' }),
  ).toHaveCount(4);
});
