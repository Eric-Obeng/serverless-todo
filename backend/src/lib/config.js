const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name}`);
  return value;
};

export const config = {
  get tableName() { return required('TABLE_NAME'); },
  get topicArn() { return required('TOPIC_ARN'); },
  get cancelQueueUrl() { return required('CANCEL_QUEUE_URL'); },
  get scheduleGroupName() { return required('SCHEDULE_GROUP_NAME'); },
  get expiryFunctionArn() { return required('EXPIRY_FUNCTION_ARN'); },
  get schedulerRoleArn() { return required('SCHEDULER_ROLE_ARN'); },
  get schedulerDlqArn() { return process.env.SCHEDULER_DLQ_ARN; },
  get defaultDeadlineMinutes() { return Number(process.env.DEFAULT_DEADLINE_MINUTES ?? 5); },
};
