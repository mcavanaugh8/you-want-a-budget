export const ACCOUNT_TYPES = ['checking', 'savings', 'cash', 'credit', 'investment'];
export const isCashAccount = (account) => ['checking', 'savings', 'cash'].includes(account?.type);
export function summarizeNetWorth(accounts) {
  const assets = accounts.reduce((sum, account) => sum + Math.max(0, account.balance), 0);
  const liabilities = accounts.reduce((sum, account) => sum + Math.max(0, -account.balance), 0);
  return { assets, liabilities, netWorth: assets - liabilities };
}
