import { Request, Response, NextFunction } from 'express';
import { PaymentsService, paymentsService } from './payments.service';
import { WebhookService, webhookService } from './webhook.service';

export class PaymentsController {
  constructor(
    private readonly service: PaymentsService = paymentsService,
    private readonly webhookServiceInstance: WebhookService = webhookService,
  ) {}

  public get serviceInstance(): PaymentsService {
    return this.service;
  }

  public get webhookService(): WebhookService {
    return this.webhookServiceInstance;
  }

  public initiatePayment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const touristAccountId = req.user!.id;
      const { bookingId } = req.params;
      const rawIdempKey = req.headers['idempotency-key'] || req.headers['x-idempotency-key'];
      const idempotencyKey = typeof rawIdempKey === 'string' ? rawIdempKey : undefined;

      const result = await this.service.initiatePayment(touristAccountId, bookingId, idempotencyKey);

      res.status(201).json({
        success: true,
        message: 'Payment order initiated successfully',
        data: result,
      });
    } catch (err) {
      next(err);
    }
  };

  public verifyPayment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const touristAccountId = req.user!.id;
      const result = await this.service.verifyPayment(touristAccountId, req.body);

      res.status(200).json({
        success: true,
        message: result.message,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  };

  public getPaymentById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const touristAccountId = req.user!.id;
      const { paymentId } = req.params;

      const result = await this.service.getPaymentById(touristAccountId, paymentId);

      res.status(200).json({
        success: true,
        message: 'Payment retrieved successfully',
        data: result,
      });
    } catch (err) {
      next(err);
    }
  };

  public getPaymentByBookingId = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const touristAccountId = req.user!.id;
      const { bookingId } = req.params;

      const result = await this.service.getPaymentByBookingId(touristAccountId, bookingId);

      res.status(200).json({
        success: true,
        message: 'Booking payment retrieved successfully',
        data: result,
      });
    } catch (err) {
      next(err);
    }
  };

  public handleRazorpayWebhook = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const signatureHeader = req.headers['x-razorpay-signature'];
      const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;

      const eventIdHeader = req.headers['x-razorpay-event-id'];
      const eventId = Array.isArray(eventIdHeader) ? eventIdHeader[0] : eventIdHeader;

      // Extract rawBody from express.json verify hook, or fallback to Buffer from parsed body
      const rawBody = (req as any).rawBody || (req.body ? Buffer.from(JSON.stringify(req.body), 'utf8') : undefined);

      const result = await this.webhookServiceInstance.processRazorpayWebhook(
        rawBody,
        signature,
        eventId,
      );

      res.status(200).json({
        success: true,
        message: 'Webhook processed successfully',
        data: result,
      });
    } catch (err) {
      next(err);
    }
  };

  public getStatus = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await this.service.getStatus();
      res.status(200).json({
        success: true,
        message: 'Payments module initialized and ready',
        data,
      });
    } catch (err) {
      next(err);
    }
  };

  public refundPayment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const adminAccountId = req.user!.id;
      const { paymentId } = req.params;
      const result = await this.service.refundPayment(adminAccountId, paymentId, req.body);

      res.status(200).json({
        success: true,
        message: result.message,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  };

  public getAdminPaymentById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { paymentId } = req.params;
      const result = await this.service.getAdminPaymentById(paymentId);

      res.status(200).json({
        success: true,
        message: 'Payment retrieved successfully',
        data: result,
      });
    } catch (err) {
      next(err);
    }
  };

  public listAdminPayments = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.listPayments(req.query as any);

      res.status(200).json({
        success: true,
        message: 'Payments retrieved successfully',
        data: result,
      });
    } catch (err) {
      next(err);
    }
  };
}

export const paymentsController = new PaymentsController();
