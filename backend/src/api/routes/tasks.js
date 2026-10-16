import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../../lib/config.js';
import { logger, metrics, MetricUnit } from '../../lib/observability.js';
import { upsertExpirySchedule } from '../../lib/scheduler.js';
import { keys, scheduleNameFor, TaskStatus } from '../../lib/tasks.js';
import { HttpError } from '../middleware/errors.js';
import * as repo from '../taskRepository.js';

const router = Router();

// Wrap async handlers so rejected promises reach the error middleware (Express 4).
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const isoDateTime = z.string().datetime({ offset: true });
const futureDeadline = isoDateTime.refine((v) => new Date(v).getTime() > Date.now(), {
  message: 'deadline must be in the future',
});

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).default(''),
  date: z.string().date().optional(), // YYYY-MM-DD the task is planned for
  deadline: futureDeadline.optional(),
});

const updateSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).optional(),
    date: z.string().date().optional(),
    deadline: futureDeadline.optional(),
    // Clients can't set Expired - only the expiry workflow does that.
    status: z.enum([TaskStatus.PENDING, TaskStatus.COMPLETED]).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to update' });

const listSchema = z.object({
  status: z.enum([TaskStatus.PENDING, TaskStatus.COMPLETED, TaskStatus.EXPIRED]).optional(),
});

// GET /tasks?status=Pending|Completed|Expired
router.get(
  '/',
  asyncRoute(async (req, res) => {
    const { status } = listSchema.parse(req.query);
    const tasks = await repo.listTasks(req.user.id, status);
    tasks.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json({ items: tasks, count: tasks.length });
  }),
);

// GET /tasks/:taskId
router.get(
  '/:taskId',
  asyncRoute(async (req, res) => {
    const task = await repo.getTask(req.user.id, req.params.taskId);
    if (!task) throw new HttpError(404, 'Task not found');
    res.json(task);
  }),
);

// POST /tasks
router.post(
  '/',
  asyncRoute(async (req, res) => {
    const body = createSchema.parse(req.body ?? {});
    const now = new Date();
    const taskId = randomUUID();
    const task = {
      taskId,
      userId: req.user.id,
      ownerEmail: req.user.email,
      title: body.title,
      description: body.description,
      date: body.date ?? now.toISOString().slice(0, 10),
      status: TaskStatus.PENDING,
      deadline: body.deadline
        ? new Date(body.deadline).toISOString()
        : new Date(now.getTime() + config.defaultDeadlineMinutes * 60_000).toISOString(),
      scheduleName: scheduleNameFor(taskId),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    await repo.putTask(task);
    try {
      await upsertExpirySchedule(task);
    } catch (err) {
      // Compensate so we never keep a Pending task that can't expire.
      await repo.deleteTask(task.userId, taskId).catch(() => {});
      throw err;
    }

    logger.info('Task created', { taskId, deadline: task.deadline });
    metrics.addMetric('TaskCreated', MetricUnit.Count, 1);
    metrics.publishStoredMetrics();
    res.status(201).json(task);
  }),
);

// PUT /tasks/:taskId
router.put(
  '/:taskId',
  asyncRoute(async (req, res) => {
    const body = updateSchema.parse(req.body ?? {});
    const userId = req.user.id;
    const { taskId } = req.params;

    const current = await repo.getTask(userId, taskId);
    if (!current) throw new HttpError(404, 'Task not found');

    const nextStatus = body.status ?? current.status;
    const nextDeadline = body.deadline ? new Date(body.deadline).toISOString() : current.deadline;

    if (current.status === TaskStatus.EXPIRED && (body.status || body.deadline)) {
      throw new HttpError(409, 'Expired tasks cannot change status or deadline');
    }
    const reopening = current.status === TaskStatus.COMPLETED && nextStatus === TaskStatus.PENDING;
    if (reopening && new Date(nextDeadline).getTime() <= Date.now()) {
      throw new HttpError(400, 'Provide a future deadline to reopen this task');
    }

    const changes = { updatedAt: new Date().toISOString() };
    for (const field of ['title', 'description', 'date']) {
      if (body[field] !== undefined) changes[field] = body[field];
    }
    changes.status = nextStatus;
    changes.deadline = nextDeadline;
    changes.GSI1SK = keys.gsi1sk(nextStatus, nextDeadline);
    const remove = [];
    if (nextStatus === TaskStatus.COMPLETED && current.status !== TaskStatus.COMPLETED) {
      changes.completedAt = changes.updatedAt;
    }
    if (reopening) remove.push('completedAt');

    let updated;
    try {
      updated = await repo.updateTask(userId, taskId, current.status, changes, remove);
    } catch (err) {
      if (err instanceof repo.ConditionalCheckFailedException) {
        throw new HttpError(409, 'Task was modified concurrently (it may have just expired). Refresh and retry.');
      }
      throw err;
    }

    // Completion -> schedule cancellation happens asynchronously via
    // DynamoDB Streams -> SQS FIFO -> CancelExpiry Lambda.
    // Pending task with new deadline, or a reopened task -> (re)create its schedule here.
    const deadlineChanged = nextDeadline !== current.deadline;
    if (nextStatus === TaskStatus.PENDING && (deadlineChanged || reopening)) {
      await upsertExpirySchedule(updated);
    }

    logger.info('Task updated', { taskId, from: current.status, to: nextStatus });
    res.json(updated);
  }),
);

// DELETE /tasks/:taskId
router.delete(
  '/:taskId',
  asyncRoute(async (req, res) => {
    try {
      await repo.deleteTask(req.user.id, req.params.taskId);
    } catch (err) {
      if (err instanceof repo.ConditionalCheckFailedException) throw new HttpError(404, 'Task not found');
      throw err;
    }
    // Schedule cancellation is handled by the stream -> FIFO -> Lambda workflow.
    logger.info('Task deleted', { taskId: req.params.taskId });
    res.status(204).end();
  }),
);

export default router;
