// Single-table key design + task domain helpers.
//
//   PK      = USER#<userId>
//   SK      = TASK#<taskId>
//   GSI1PK  = USER#<userId>
//   GSI1SK  = STATUS#<status>#<deadlineISO>   -> list a user's tasks by status, ordered by deadline

export const TaskStatus = Object.freeze({
  PENDING: 'Pending',
  COMPLETED: 'Completed',
  EXPIRED: 'Expired',
});

export const ENTITY_TYPE = 'TASK';

export const keys = {
  pk: (userId) => `USER#${userId}`,
  sk: (taskId) => `TASK#${taskId}`,
  gsi1pk: (userId) => `USER#${userId}`,
  gsi1sk: (status, deadline) => `STATUS#${status}#${deadline}`,
  gsi1StatusPrefix: (status) => `STATUS#${status}#`,
};

export const scheduleNameFor = (taskId) => `task-${taskId}`;

/** Strip storage-only attributes before returning a task to clients. */
export const toPublicTask = (item) => {
  if (!item) return item;
  const { PK, SK, GSI1PK, GSI1SK, entityType, ...task } = item;
  return task;
};
