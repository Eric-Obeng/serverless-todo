// Local dev server: `npm run dev` (uses your AWS credentials + deployed table/scheduler).
import { readFileSync, existsSync } from 'node:fs';

if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}

const { app } = await import('./app.js');
const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => console.log(`API listening on http://localhost:${port}`));
