import crypto from 'crypto';
export {
  bookingIdParamSchema,
  verifyPaymentSignatureSchema,
  paymentIdParamSchema,
  paymentQueryFilterSchema,
} from '@kerala-tourism/validation';

export type {
  BookingIdParamInput,
  VerifyPaymentSignatureInput,
  PaymentIdParamInput,
  PaymentQueryFilterInput,
} from '@kerala-tourism/validation';

/**
 * Generates an uppercase, cryptographically random, collision-resistant payment reference
 * Format: PAY-YYYYMMDD-<6 hex chars>
 */
export const generatePaymentReference = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const randomSuffix = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `PAY-${year}${month}${day}-${randomSuffix}`;
};
