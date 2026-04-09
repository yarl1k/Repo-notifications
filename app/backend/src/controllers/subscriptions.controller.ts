import type { Request, Response } from "express";
import { prisma } from "../services/prisma_setup/database.js";
import crypto  from "crypto";
import { validateRepo } from "../services/github.service.js";

export const subscribeToRepo = async (req: Request, res: Response) => {
    try {
        const {email, repo} = req.body;
        if(!email || !repo || typeof email !== 'string' || typeof repo !== 'string') {
            res.status(400).json({error: 'Invalid input data type.'});
            return;
        }
        const [owner, repoName] = repo.split('/');
        if(!owner || !repoName) {
            res.status(400).json({error: 'Repository must be in the format "owner/repo".'});
            return;
        }

        const repoData = await validateRepo(owner, repoName);
        const fullRepoName = `${owner}/${repoName}`;
        const subscriptionToken = crypto.randomUUID();

            try {
                const subscription = await prisma.subscription.create({
                    data: {
                        confirmationToken: subscriptionToken,
                        confirmed: false,
                        user: {
                            connectOrCreate: {
                                where: { email: email.toLowerCase() },
                                create: { email: email.toLowerCase() }
                            }
                        },
                        repository: {
                            connectOrCreate: {
                                where: { fullName: fullRepoName},
                                create: { fullName: fullRepoName}
                            }
                        }
                    }
                });
            // ВИДАЛИТИ ПІЗНІШЕ - ІМІТАЦІЯ 
            console.log(`\n=== НОВИЙ ЛИСТ ===`);
            console.log(`Кому: ${email}`);
            console.log(`Посилання: http://releases-api.app/api/confirm/${subscriptionToken}`);
            console.log(`==================\n`);

                res.status(200).json({ message: 'Subscription created. Please check your email to confirm.', subscriptionId: subscription.id });
            }
            catch(dbError: any) {
                if (dbError.code === 'P2002') {
                    res.status(409).json({ error: 'You are already subscribed to this repository.' });
                    return;
                }
            }
        } catch (error: any) {
            const status = error.status || 500
            console.error(error);
            res.status(status).json({ error: error.message ||'An error occurred while creating the subscription.' });
    }
}

export const confirmSubscription = async (req: Request, res: Response) => {
    try{
        const { subscriptionToken } = req.params;
        if (!subscriptionToken || typeof subscriptionToken !== 'string') {
            res.status(400).json({ error: 'Invalid subscription token.' });
            return;
        }
        const subscription = await prisma.subscription.findUnique({
            where: {
                confirmationToken: subscriptionToken,
            }
        });
        
        if (!subscription) {
            res.status(404).json({ error: 'Subscription not found or was already confirmed.' });
            return;
        }

        const unsubscribeToken = crypto.randomUUID();

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
        res.status(200).json({ message: 'Subscription confirmed.' });
    }
    catch (error: any) {
        console.error(error);
        res.status(500).json({error: error.message || 'An error occured while confirming the subscripton.'})
    }
}

export const getSubscriptionsForEmail = async (req: Request, res: Response) => {
    try{
        const { email } = req.query;
        if (!email || typeof email !== 'string') {
            res.status(400).json({error: 'Invalid email.'});
            return;
        }
        const user = await prisma.user.findUnique({
            where: {email: email.toLowerCase()},
            include: {
                subscriptions: {
                    where: {confirmed: true},
                    include: {repository: true}
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
                repository: sub.repository.fullName,
                confirmed: sub.confirmed,
                last_seen_tag: sub.repository.lastSeenTag
            }

        })
        res.status(200).json(groupedSubscriptions);
    }
    catch(error: any) {
        console.error(error);
        res.status(500).json({error: error.message || 'An error occurred while fetching subscriptions.'});
    }
}


export const cancelSubscription = async (req: Request, res: Response) => {
    try {
        const {unsubscribeToken} = req.params;
        if (!unsubscribeToken || typeof unsubscribeToken !== 'string') {
            res.status(400).json ({error: 'Invalid unsubscribe token.'});
            return;
        }
        const subscription = await prisma.subscription.findUnique({
            where: {unsubscribeToken: unsubscribeToken}
        });

        if (!subscription) {
            res.status(404).json({error: 'Unsubscribe token not found.'});
            return;
        }

        await prisma.subscription.delete({
            where: {id: subscription.id}
        });
        res.status(200).json({message: 'Subscription successfully cancelled.'});
    }
    catch (error: any) {
        console.error(error.message);
        res.status(500).json({error: error.message || 'An error occurred while cancelling the subscription.'});
    }
}

