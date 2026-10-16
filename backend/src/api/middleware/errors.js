import { ZodError } from 'zod';
import { logger } from '../../lib/observability.js';

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function notFound(req, res) {
  res.status(404).json({ message: `Route ${req.method} ${req.path} not found` });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof ZodError) {
    return res.status(400).json({ message: 'Validation failed', details: err.flatten().fieldErrors });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ message: err.message, details: err.details });
  }
  logger.error('Unhandled error', { error: err, path: req.path, method: req.method });
  return res.status(500).json({ message: 'Internal server error' });
}
