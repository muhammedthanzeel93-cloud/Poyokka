import { Router } from 'express';
import { paymentWebhookRateLimiter } from '../../middlewares/rateLimiter';
import { paymentsController } from './payments.controller';

const router = Router();

// Public Webhook Ingestion Endpoint: POST /api/v1/webhooks/razorpay
router.post('/razorpay', paymentWebhookRateLimiter, paymentsController.handleRazorpayWebhook);

export default router;
