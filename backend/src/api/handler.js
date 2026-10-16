import serverlessExpress from '@codegenie/serverless-express';
import { app } from './app.js';

// API Gateway (REST, proxy integration) -> Express
export const handler = serverlessExpress({ app });
