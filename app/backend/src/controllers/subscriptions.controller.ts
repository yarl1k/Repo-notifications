import type { Request, Response } from "express";
import { prisma } from "../services/prisma_setup/database.js";
import crypto from "crypto";
import { validateRepo } from "../services/github.service.js";
import {
    sendEmailSubscriptionConfirmation,
    sendEmailUnsubscriptionNotify,
} from "../services/nodemailer/email.service.js";
import { emailQueue } from "../services/redis/queue.service.js";


export const subscribeToRepo = async (req: Request, res: Response): Promise<void> => {
    try {
        const { email, repo } = req.body;
        if (!email || !repo || typeof email !== 'string' || typeof repo !== 'string') {
            res.status(400).json({ error: 'Invalid input data type.' });
            return;
        }
        const [owner, repoName] = repo.split('/');
        if (!owner || !repoName) {
            res.status(400).json({ error: 'Repository must be in the format "owner/repo".' });
            return;
        }

        const repoData = await validateRepo(owner, repoName);
        const fullRepoName = `${owner}/${repoName}`;
        const token = crypto.randomInt(100000, 999999).toString();
        const expiration = new Date(Date.now() + 30 * 60 * 1000);

        try {
            const subscription = await prisma.subscription.create({
                data: {
                    confirmationToken: token,
                    confirmationTokenExpiresAt: expiration,
                    confirmed: false,
                    user: {
                        connectOrCreate: {
                            where: { email: email.toLowerCase() },
                            create: { email: email.toLowerCase() }
                        }
                    },
                    repository: {
                        connectOrCreate: {
                            where: { fullName: fullRepoName },
                            create: { fullName: fullRepoName }
                        }
                    }
                }
            });

            await emailQueue.add('email-job', {
                type: "subscription_confirmation",
                data: {
                    email: email,
                    token: token,
                    repoName: fullRepoName
                }
            });
            res.status(200).json({ message: 'Subscription successful. Confirmation email sent.', subscriptionId: subscription.id });
        }
        catch (dbError: any) {
            if (dbError.code === 'P2002') {
                const existingSub = await prisma.subscription.findFirst({
                    where: {
                        user: { email: email.toLowerCase() },
                        repository: { fullName: fullRepoName }
                    }
                });

                if (existingSub) {
                    if (existingSub.confirmed) {
                        res.status(409).json({ error: 'Email already subscribed to this repository.' });
                        return;
                    } else {

                        const newToken = crypto.randomInt(100000, 999999).toString();
                        await prisma.subscription.update({
                            where: { id: existingSub.id },
                            data: { confirmationToken: newToken, confirmationTokenExpiresAt: expiration }
                        });

                        await emailQueue.add('email-job', {
                            type: "subscription_confirmation",
                            data: {
                                email: email,
                                token: newToken,
                                repoName: fullRepoName
                            }
                        });
                        res.status(200).json({ message: 'Confirmation email resent.', subscriptionId: existingSub.id });
                        return;
                    }
                }
            }
            throw dbError;
        }
    } catch (error: any) {
        const status = error.status || 500
        console.error(error);
        res.status(status).json({ error: error.message || 'An error occurred while creating the subscription.' });
    }
}

export const confirmSubscription = async (req: Request, res: Response) => {
    try {
        const token = req.params.subscriptionToken;
        if (!token || typeof token !== 'string') {
            res.status(400).json({ error: 'Invalid subscription token.' });
            return;
        }

        const subscription = await prisma.subscription.findUnique({
            where: {
                confirmationToken: token,
            }
        });

        if (!subscription) {
            res.status(404).json({ error: 'Subscription not found or was already confirmed.' });
            return;
        }

        if (subscription.confirmationTokenExpiresAt && subscription.confirmationTokenExpiresAt < new Date()) {
            res.status(400).json({ error: 'Confirmation token has expired. Please subscribe again to get a new code.' });
            return;
        }

        const unsubscribeToken = crypto.randomBytes(4).toString('hex');

        await prisma.subscription.update({
            where: {
                id: subscription.id
            },
            data: {
                confirmed: true,
                confirmationToken: null,
                unsubscribeToken: unsubscribeToken
            }
        });
        res.status(200).json({ message: 'Subscription confirmed successfully.' });
    }
    catch (error: any) {
        console.error(error);
        res.status(500).json({ error: error.message || 'An error occurred while confirming the subscription.' })
    }
}

export const getSubscriptionsForEmail = async (req: Request, res: Response) => {
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
                    include: { repository: true }
                }
            }
        });
        if (!user) {
            res.status(400).json([]);
            return;
        }

        const groupedSubscriptions = user.subscriptions.map(sub => {
            return {
                email: user.email,
                repo: sub.repository.fullName,
                confirmed: sub.confirmed,
                last_seen_tag: sub.repository.lastSeenTag
            }

        })
        res.status(200).json(groupedSubscriptions);
    }
    catch (error: any) {
        console.error(error);
        res.status(500).json({ error: error.message || 'An error occurred while fetching subscriptions.' });
    }
}


export const cancelSubscription = async (req: Request, res: Response) => {
    try {
        const token = req.params.unsubscribeToken;
        if (!token || typeof token !== 'string') {
            res.status(400).json({ error: 'Invalid unsubscribe token.' });
            return;
        }
        const subscription = await prisma.subscription.findUnique({
            where: { unsubscribeToken: token },
            include: {
                user: true,
                repository: true
            }
        });

        if (!subscription) {
            res.status(404).json({ error: 'Unsubscribe token not found.' });
            return;
        }

        await prisma.subscription.delete({
            where: { id: subscription.id }
        });

        await emailQueue.add('email-job', {
            type: "unsubscription_notify",
            data: {
                email: subscription.user.email,
                repoName: subscription.repository.fullName
            }
        });

        res.status(200).json({ message: 'Subscription successfully cancelled.' });
    }
    catch (error: any) {
        console.error(error.message);
        res.status(500).json({ error: error.message || 'An error occurred while cancelling the subscription.' });
    }
}

