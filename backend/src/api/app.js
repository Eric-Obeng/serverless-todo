import cors from 'cors';
import express from 'express';
import { logger } from '../lib/observability.js';
import { requireUser } from './middleware/auth.js';
import { errorHandler, notFound } from './middleware/errors.js';
import tasksRouter from './routes/tasks.js';

export const app = express();

app.disable('x-powered-by');
app.use(cors()); // API Gateway also handles preflight; this covers actual responses + local dev
app.use(express.json({ limit: '100kb' }));

app.use((req, res, next) => {
  const started = Date.now();
  res.on('finish', () => {
    logger.info('request', {
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: Date.now() - started,
      userId: req.user?.id,
    });
  });
  next();
});

app.use('/tasks', requireUser, tasksRouter);

app.use(notFound);
app.use(errorHandler);
