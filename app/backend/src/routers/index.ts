import { Router } from "express";
import {
    confirmSubscription,
    cancelSubscription,
    getSubscriptions,
    subscribeToRepo
} from "../controllers/subscriptions.js";

const router: Router = Router();

router.get("/confirm", confirmSubscription);
router.get("/unsubscribe", cancelSubscription);
router.get("/subscriptions", getSubscriptions);

router.post("/subscribe", subscribeToRepo);

export default router;