import { paginateListSubscriptionsByTopic, SubscribeCommand } from '@aws-sdk/client-sns';
import { sns } from '../lib/aws.js';
import { config } from '../lib/config.js';
import { logger, metrics, MetricUnit } from '../lib/observability.js';

/**
 * Cognito PostAuthentication trigger.
 *
 * Subscribes the signed-in user's email to the task-notifications topic with a
 * filter policy on `userId`, so each user only receives notifications for
 * their own tasks. Runs on every sign-in, so it is idempotent: if the email is
 * already subscribed (confirmed or pending) we skip, which also avoids
 * re-sending the SNS confirmation email on every login.
 *
 * Never throws: a notification problem must not block the user from signing in.
 */
export const handler = async (event) => {
  const { email, sub: userId } = event.request.userAttributes ?? {};
  logger.appendKeys({ userId });

  if (!email || !userId) {
    logger.warn('Missing email/sub on PostAuthentication event');
    return event;
  }

  try {
    if (await isAlreadySubscribed(email)) {
      logger.info('Email already subscribed to topic');
      return event;
    }

    const { SubscriptionArn } = await sns.send(
      new SubscribeCommand({
        TopicArn: config.topicArn,
        Protocol: 'email',
        Endpoint: email,
        ReturnSubscriptionArn: true,
        Attributes: {
          FilterPolicy: JSON.stringify({ userId: [userId] }),
          FilterPolicyScope: 'MessageAttributes',
        },
      }),
    );
    logger.info('Subscribed user email to task notifications', { SubscriptionArn });
    metrics.addMetric('UserSubscribed', MetricUnit.Count, 1);
  } catch (error) {
    logger.error('Failed to subscribe user to SNS topic', { error });
  } finally {
    metrics.publishStoredMetrics();
  }

  return event;
};

async function isAlreadySubscribed(email) {
  const target = email.toLowerCase();
  for await (const page of paginateListSubscriptionsByTopic({ client: sns }, { TopicArn: config.topicArn })) {
    if (page.Subscriptions?.some((s) => s.Protocol === 'email' && s.Endpoint?.toLowerCase() === target)) {
      return true;
    }
  }
  return false;
}
