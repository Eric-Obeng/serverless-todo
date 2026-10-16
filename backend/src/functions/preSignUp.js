/**
 * Cognito PreSignUp trigger.
 * Auto-confirms every sign-up and marks the email as verified so users can sign
 * in immediately without a confirmation code.
 */
export const handler = async (event) => {
  event.response.autoConfirmUser = true;
  if (event.request.userAttributes?.email) {
    event.response.autoVerifyEmail = true;
  }
  return event;
};
