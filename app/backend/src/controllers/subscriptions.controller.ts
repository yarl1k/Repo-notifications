import type { Request, Response } from 'express';
import { prisma } from '../services/prisma_setup/database.js';
import { validateRepo } from '../services/github.service.js';
import {
    parseRepoFormat,
    generateConfirmationCode,
    generateUnsubscribeToken,
    getConfirmationExpiry,
    queueConfirmationEmail,
    findExistingSubscription,
    createSubscription,
    refreshConfirmationToken,
    confirmSubscriptionRecord,
    isTokenExpired,
    setCooldownInQueueConfirmation,
    isEmailOnCooldown,
    isValidEmail,
} from './subscription.helpers.js';

// POST /api/subscribe
export const subscribeToRepo = async (req: Request, res: Response): Promise<void> => {
    try {
        const { email, repo } = req.body;
        if (!email || !repo || typeof email !== 'string' || typeof repo !== 'string') {
            res.status(400).json({ error: 'Invalid input (e.g., invalid repo format).' });
            return;
        }

        const trimmedEmail = email.trim().toLowerCase();
        const trimmedRepo = repo.trim();

        if (!isValidEmail(trimmedEmail)) {
            res.status(400).json({ error: 'Invalid input (e.g., invalid repo format).' });
            return;
        }

        const parsed = parseRepoFormat(trimmedRepo);
        if (!parsed) {
            res.status(400).json({ error: 'Invalid input (e.g., invalid repo format).' });
            return;
        }

        const { owner, repoName } = parsed;
        await validateRepo(owner, repoName);

        const fullRepoName = `${owner}/${repoName}`;
        const token = generateConfirmationCode();
        const expiry = getConfirmationExpiry();
        const existingSub = await findExistingSubscription(trimmedEmail, fullRepoName);

        if (existingSub) {
            if (existingSub.confirmed) {
                res.status(409).json({ error: 'Email already subscribed to this repository.' });
                return;
            }
            if (await isEmailOnCooldown(trimmedEmail)) {
                res.status(200).json({ message: 'Subscription successful. Confirmation email sent.', subscriptionId: existingSub.id });
                return;
            }

            const newToken = generateConfirmationCode();
            await refreshConfirmationToken(existingSub.id, newToken, expiry);
            await setCooldownInQueueConfirmation(trimmedEmail, newToken, fullRepoName);

            res.status(200).json({ message: 'Subscription successful. Confirmation email sent.', subscriptionId: existingSub.id });
            return;
        }
        const subscription = await createSubscription(trimmedEmail, fullRepoName, token, expiry);
        await queueConfirmationEmail(trimmedEmail, token, fullRepoName);

        res.status(200).json({
            message: 'Subscription successful. Confirmation email sent.',
            subscriptionId: subscription.id,
        });

    } catch (error: any) {
        console.error(error);
        res.status(error.status ?? 500).json({
            error: error.message || 'An error occurred while creating the subscription.',
        });
    }
};

// GET /api/confirm/:subscriptionToken

export const confirmSubscription = async (req: Request, res: Response): Promise<void> => {
    try {
        const token = req.params.subscriptionToken;
        if (!token || typeof token !== 'string' || !/^\d{6}$/.test(token)) {
            res.status(400).json({ error: 'Invalid token.' });
            return;
        }

        const subscription = await prisma.subscription.findUnique({
            where: { confirmationToken: token },
        });

        if (!subscription) {
            res.status(404).json({ error: 'Token not found.' });
            return;
        }

        if (isTokenExpired(subscription.confirmationTokenExpiresAt)) {
            res.status(400).json({
                error: 'Invalid token.',
            });
            return;
        }

        await confirmSubscriptionRecord(subscription.id, generateUnsubscribeToken());
        res.status(200).json({ message: 'Subscription confirmed successfully.' });
    } catch (error: any) {
        console.error(error);
        res.status(500).json({ error: error.message || 'An error occurred while confirming the subscription.' });
    }
};

//GET /api/subscriptions?email={email}

export const getSubscriptionsForEmail = async (req: Request, res: Response): Promise<void> => {
    try {
        const { email } = req.query;
        if (!email || typeof email !== 'string' || !isValidEmail(email.trim())) {
            res.status(400).json({ error: 'Invalid email.' });
            return;
        }

        const trimmedEmail = email.trim().toLowerCase();

        const user = await prisma.user.findUnique({
            where: { email: trimmedEmail },
            include: {
                subscriptions: {
                    where: { confirmed: true },
                    include: { repository: true },
                },
            },
        });

        if (!user) {
            res.status(200).json([]);
            return;
        }

        const subscriptions = user.subscriptions.map(sub => ({
            email: user.email,
            repo: sub.repository.fullName,
            confirmed: sub.confirmed,
            last_seen_tag: sub.repository.lastSeenTag,
        }));

        res.status(200).json(subscriptions);
    } catch (error: any) {
        console.error(error);
        res.status(500).json({ error: error.message || 'An error occurred while fetching subscriptions.' });
    }
};

//GET /api/unsubscribe/:unsubscribeToken

export const cancelSubscription = async (req: Request, res: Response): Promise<void> => {
    try {
        const token = req.params.unsubscribeToken;
        if (!token || typeof token !== 'string' || !/^\d{6}$/.test(token)) {
            res.status(400).json({ error: 'Invalid unsubscribe token.' });
            return;
        }

        const subscription = await prisma.subscription.findUnique({
            where: { unsubscribeToken: token },
            include: { user: true, repository: true },
        });

        if (!subscription) {
            res.status(404).json({ error: 'Token not found.' });
            return;
        }

        await prisma.subscription.delete({ where: { id: subscription.id } });
        res.status(200).json({ message: 'Subscription successfully cancelled.' });
    } catch (error: any) {
        console.error(error);
        res.status(500).json({ error: error.message || 'An error occurred while cancelling the subscription.' });
    }
};
