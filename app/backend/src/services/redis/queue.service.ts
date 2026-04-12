import { Redis } from "ioredis";
import { Queue, Worker, Job } from "bullmq";
import {
    sendEmailNotification,
    sendEmailSubscriptionConfirmation,
    sendEmailUnsubscriptionNotify
} from "../nodemailer/email.service.js";
import { redisConnection } from "./redis.setup.js";
import { emailsSentCounter } from "../metrics.service.js";

export const emailQueue = new Queue("email-queue", {
    connection: redisConnection,
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: "exponential",
            delay: 1000,
        },
    },
});

const emailWorker = new Worker('email-queue', async (job: Job) => {
    const { type, data } = job.data;

    console.log(`[BULLMQ: EMAIL WORKER] Processing job ${job.id}, email type: ${type} for ${data.email}`);
    try {
        if (type === "subscription_confirmation") {
            await sendEmailSubscriptionConfirmation(data.email, data.token, data.repoName);
            emailsSentCounter.inc({ email_type: 'subscription_confirmation' });
        }
        else if (type === "unsubscription_notify") {
            await sendEmailUnsubscriptionNotify(data.email, data.repoName);
            emailsSentCounter.inc({ email_type: 'unsubscription_notify' });
        }
        else if (type === "release_notification") {
            await sendEmailNotification(data.email, data.releaseTag, data.repoName, data.unsubscribeToken);
            emailsSentCounter.inc({ email_type: 'release_notification' });
        }
    }
    catch (error: any) {
        console.error(`[BULLMQ: EMAIL WORKER] Failed to process job ${job.id}: ${error.message}`);
        throw error;
    }
}, {
    connection: redisConnection,
});

