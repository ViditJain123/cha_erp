export { sendEmail } from './send.js';
export type { OutboundEmail, SendResult } from './send.js';
export {
  credentialsEmail,
  passwordResetEmail,
  deliveryPlanEmail,
  deliveryRefusedEmail,
} from './templates.js';
export type {
  CredentialsEmailInput,
  PasswordResetEmailInput,
  DeliveryPlanEmailInput,
  DeliveryRefusedEmailInput,
} from './templates.js';
