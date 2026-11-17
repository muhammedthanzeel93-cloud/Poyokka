import { Router } from 'express';
import { healthController } from './health.controller';

const router = Router();

router.get('/', healthController.getHealth);
router.get('/liveness', healthController.getLiveness);
router.get('/readiness', healthController.getReadiness);

export default router;
