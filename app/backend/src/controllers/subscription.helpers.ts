import crypto from 'crypto';
import { prisma } from '../services/prisma_setup/database.js';
import { emailQueue } from '../services/redis/queue.service.js';
import { redisConnection } from '../services/redis/redis.setup.js';


export const generateConfirmationCode = (): string =>
    crypto.randomInt(100000, 999999).toString();

export const generateUnsubscribeToken = (): string =>
    crypto.randomBytes(4).toString('hex');

/** Returns a Date 30 minutes from now. */
export const getConfirmationExpiry = (): Date =>
    new Date(Date.now() + 30 * 60 * 1000);


export const parseRepoFormat = (repo: string): { owner: string; repoName: string } | null => {
    const [owner, repoName] = repo.split('/');
    if (!owner || !repoName) return null;
    return { owner, repoName };
};

// --- Email Queue Helpers ---

export const cooldownSeconds = 30; // 30 seconds cooldown for resending confirmation emails

/** Queues a subscription confirmation email job. */
export const queueConfirmationEmail = (email: string, token: string, repoName: string) =>
    emailQueue.add('email-job', {
        type: 'subscription_confirmation',
        data: { email, token, repoName },
    });

export const isEmailOnCooldown = async (email: string): Promise<boolean> => {
    const cooldownKey = `confirm_cooldown:${email.toLowerCase()}`;
    const isCooldown = await redisConnection.get(cooldownKey);
    return !!isCooldown;
};

export const setCooldownInQueueConfirmation = async (email: string, token: string, repoName: string): Promise<void> => {
    const cooldownKey = `confirm_cooldown:${email.toLowerCase()}`;

    const isCooldown = await redisConnection.get(cooldownKey);

    if (!isCooldown) {
        await queueConfirmationEmail(email, token, repoName);
        await redisConnection.setex(cooldownKey, cooldownSeconds, 'true');
    } else {
        console.log(`[Cooldown] Email to ${email} skipped due to active cooldown.`);
    }
}
// --- Database Helpers ---

export const findExistingSubscription = (email: string, fullRepoName: string) =>
    prisma.subscription.findFirst({
        where: {
            user: { email: email.toLowerCase() },
            repository: { fullName: fullRepoName },
        },
    });

/** Creates a new subscription, connecting or creating user and repository. */
export const createSubscription = (email: string, fullRepoName: string, token: string, expiry: Date) =>
    prisma.subscription.create({
        data: {
            confirmationToken: token,
            confirmationTokenExpiresAt: expiry,
            confirmed: false,
            user: {
                connectOrCreate: {
                    where: { email: email.toLowerCase() },
                    create: { email: email.toLowerCase() },
                },
            },
            repository: {
                connectOrCreate: {
                    where: { fullName: fullRepoName },
                    create: { fullName: fullRepoName },
                },
            },
        },
    });

export const refreshConfirmationToken = (id: string, token: string, expiry: Date) =>
    prisma.subscription.update({
        where: { id },
        data: { confirmationToken: token, confirmationTokenExpiresAt: expiry },
    });

export const confirmSubscriptionRecord = (id: string, unsubscribeToken: string) =>
    prisma.subscription.update({
        where: { id },
        data: {
            confirmed: true,
            confirmationToken: null,
            confirmationTokenExpiresAt: null,
            unsubscribeToken,
        },
    });


export const isTokenExpired = (expiresAt: Date | null): boolean =>
    expiresAt !== null && expiresAt < new Date();

