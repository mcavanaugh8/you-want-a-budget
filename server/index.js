import { resolve } from 'node:path';
import express from 'express';
import { existsSync } from 'node:fs';
import { openDatabase } from './database.js';
import { createApp } from './app.js';
const db = openDatabase(),
  app = createApp(db),
  port = Number(process.env.PORT || 3000);
if (process.argv.includes('--dev')) {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
} else {
  if (!existsSync(resolve('dist/index.html'))) {
    console.error('Run npm run build first, or use npm run dev.');
    process.exit(1);
  }
  app.use(express.static(resolve('dist')));
  app.get('/{*path}', (req, res) => res.sendFile(resolve('dist/index.html')));
}
const server = app.listen(port, '127.0.0.1', () =>
  console.log(
    `You Want a Budget → http://127.0.0.1:${port}\nDatabase: ${resolve(process.env.BUDGET_DATA_DIR || '.local-data', 'budgets.sqlite')}`,
  ),
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () =>
    server.close(() => {
      db.close();
      process.exit(0);
    }),
  );
