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
} from './subscription.helpers.js';

// POST /api/subscribe
export const subscribeToRepo = async (req: Request, res: Response): Promise<void> => {
    try {
        const { email, repo } = req.body;
        if (!email || !repo || typeof email !== 'string' || typeof repo !== 'string') {
            res.status(400).json({ error: 'Invalid input data type.' });
            return;
        }

        const parsed = parseRepoFormat(repo);
        if (!parsed) {
            res.status(400).json({ error: 'Repository must be in the format "owner/repo".' });
            return;
        }

        const { owner, repoName } = parsed;
        await validateRepo(owner, repoName);

        const fullRepoName = `${owner}/${repoName}`;
        const token = generateConfirmationCode();
        const expiry = getConfirmationExpiry();
        const existingSub = await findExistingSubscription(email, fullRepoName);

        if (existingSub) {
            if (existingSub.confirmed) {
                res.status(409).json({ error: 'Email already subscribed to this repository.' });
                return;
            }

            const newToken = generateConfirmationCode();
            await refreshConfirmationToken(existingSub.id, newToken, expiry);
            await setCooldownInQueueConfirmation(email, newToken, fullRepoName);

            res.status(200).json({ message: 'Confirmation email resent.', subscriptionId: existingSub.id });
            return;
        }
        const subscription = await createSubscription(email, fullRepoName, token, expiry);
        await queueConfirmationEmail(email, token, fullRepoName);

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
        if (!token || typeof token !== 'string') {
            res.status(400).json({ error: 'Invalid subscription token.' });
            return;
        }

        const subscription = await prisma.subscription.findUnique({
            where: { confirmationToken: token },
        });

        if (!subscription) {
            res.status(404).json({ error: 'Subscription not found or was already confirmed.' });
            return;
        }

        if (isTokenExpired(subscription.confirmationTokenExpiresAt)) {
            res.status(400).json({
                error: 'Confirmation token has expired. Please subscribe again to get a new code.',
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
        if (!email || typeof email !== 'string') {
            res.status(400).json({ error: 'Invalid email.' });
            return;
        }

        const user = await prisma.user.findUnique({
            where: { email: email.toLowerCase() },
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
        if (!token || typeof token !== 'string') {
            res.status(400).json({ error: 'Invalid unsubscribe token.' });
            return;
        }

        const subscription = await prisma.subscription.findUnique({
            where: { unsubscribeToken: token },
            include: { user: true, repository: true },
        });

        if (!subscription) {
            res.status(404).json({ error: 'Unsubscribe token not found.' });
            return;
        }

        await prisma.subscription.delete({ where: { id: subscription.id } });
        res.status(200).json({ message: 'Subscription successfully cancelled.' });
    } catch (error: any) {
        console.error(error);
        res.status(500).json({ error: error.message || 'An error occurred while cancelling the subscription.' });
    }
};
