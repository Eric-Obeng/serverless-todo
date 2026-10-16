import { Amplify } from 'aws-amplify';
import { fetchAuthSession } from 'aws-amplify/auth';

export const API_NAME = 'TasksApi';

const env = import.meta.env;
const missing = ['VITE_AWS_REGION', 'VITE_USER_POOL_ID', 'VITE_USER_POOL_CLIENT_ID', 'VITE_API_URL'].filter(
  (k) => !env[k],
);
if (missing.length) {
  // eslint-disable-next-line no-console
  console.error(`Missing env vars: ${missing.join(', ')} - see frontend/.env.example`);
}

/**
 * Registers the Cognito User Pool (auth) and the REST API with Amplify.
 * Values come from env vars that the SAM template sets on the Amplify app.
 */
export function configureAmplify() {
  Amplify.configure(
    {
      Auth: {
        Cognito: {
          userPoolId: env.VITE_USER_POOL_ID,
          userPoolClientId: env.VITE_USER_POOL_CLIENT_ID,
          loginWith: { email: true },
          signUpVerificationMethod: 'code', // unused: PreSignUp Lambda auto-confirms
          userAttributes: { email: { required: true } },
          passwordFormat: {
            minLength: 8,
            requireLowercase: true,
            requireUppercase: true,
            requireNumbers: true,
            requireSpecialCharacters: false,
          },
        },
      },
      API: {
        REST: {
          [API_NAME]: {
            endpoint: env.VITE_API_URL,
            region: env.VITE_AWS_REGION,
          },
        },
      },
    },
    {
      API: {
        REST: {
          // API Gateway's Cognito authorizer expects the ID token in the Authorization header.
          headers: async () => {
            const { tokens } = await fetchAuthSession();
            return { Authorization: tokens?.idToken?.toString() ?? '' };
          },
        },
      },
    },
  );
}
