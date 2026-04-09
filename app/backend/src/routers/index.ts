import { Router } from "express";
import {
    confirmSubscription,
    cancelSubscription,
    getSubscriptionsForEmail,
    subscribeToRepo
} from "../controllers/subscriptions.controller.js";

const router: Router = Router();

router.get("/confirm/:subscriptionToken", confirmSubscription);
router.get("/unsubscribe/:unsubscribeToken", cancelSubscription);
router.get("/subscriptions", getSubscriptionsForEmail);
router.post("/subscribe", subscribeToRepo);

export default router;