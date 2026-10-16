import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';

// Service name comes from POWERTOOLS_SERVICE_NAME (set per function in template.yaml).
export const logger = new Logger();
export const metrics = new Metrics({ namespace: process.env.POWERTOOLS_METRICS_NAMESPACE ?? 'ServerlessTodo' });
export { MetricUnit };
