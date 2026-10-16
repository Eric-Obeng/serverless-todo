import { getCurrentInvoke } from '@codegenie/serverless-express';

/**
 * Resolves the caller's Cognito identity.
 *
 * In Lambda, API Gateway's Cognito authorizer has already verified the JWT and
 * exposes its claims on requestContext.authorizer.claims - we trust those.
 * Locally (npm run dev) there is no authorizer, so we decode the bearer token
 * WITHOUT verifying it. Never enable that path in a deployed environment.
 */
export function requireUser(req, res, next) {
  const claims = getCurrentInvoke()?.event?.requestContext?.authorizer?.claims ?? localClaims(req);

  if (!claims?.sub) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  req.user = { id: claims.sub, email: claims.email };
  return next();
}

function localClaims(req) {
  if (process.env.AWS_LAMBDA_FUNCTION_NAME) return undefined;
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return undefined;
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
}
