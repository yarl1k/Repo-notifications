import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

//  Mocks

vi.mock('../services/prisma_setup/database.js', () => ({
    prisma: {
        subscription: {
            create: vi.fn(),
            findFirst: vi.fn(),
            findUnique: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
        },
        user: {
            findUnique: vi.fn(),
        },
    },
}));

vi.mock('../services/github.service.js', () => ({
    validateRepo: vi.fn(),
}));

vi.mock('../services/nodemailer/email.service.js', () => ({
    sendEmailSubscriptionConfirmation: vi.fn(),
    sendEmailUnsubscriptionNotify: vi.fn(),
}));

vi.mock('../services/redis/queue.service.js', () => ({
    emailQueue: {
        add: vi.fn().mockResolvedValue(undefined),
    },
}));

vi.mock('../services/redis/redis.setup.js', () => ({
    redisConnection: {
        get: vi.fn(),
        setex: vi.fn(),
    },
}));

//  Imports (after mocks)

import {
    subscribeToRepo,
    confirmSubscription,
    getSubscriptionsForEmail,
    cancelSubscription,
} from './subscriptions.controller.js';
import { prisma } from '../services/prisma_setup/database.js';
import { validateRepo } from '../services/github.service.js';
import { emailQueue } from '../services/redis/queue.service.js';
import { redisConnection } from '../services/redis/redis.setup.js';

//  Helpers

function makeRes(): Response {
    return {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
    } as unknown as Response;
}

function makeReq(overrides: Partial<Request> = {}): Request {
    return { body: {}, params: {}, query: {}, headers: {}, ...overrides } as unknown as Request;
}

//  POST /subscribe

describe('subscribeToRepo', () => {
    beforeEach(() => vi.clearAllMocks());

    it('returns 400 when email or repo is missing/not a string', async () => {
        const res = makeRes();
        await subscribeToRepo(makeReq({ body: { repo: 'owner/repo' } }), res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ error: 'Invalid input data type.' });
    });

    it('returns 400 when repo is not in owner/repo format', async () => {
        const res = makeRes();
        await subscribeToRepo(makeReq({ body: { email: 'u@test.com', repo: 'badformat' } }), res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
            error: 'Repository must be in the format "owner/repo".',
        });
    });

    it('returns 404 when validateRepo throws a 404 error', async () => {
        vi.mocked(validateRepo).mockRejectedValueOnce(
            Object.assign(new Error('Repository not found on GitHub'), { status: 404 })
        );
        const res = makeRes();
        await subscribeToRepo(makeReq({ body: { email: 'u@test.com', repo: 'owner/missing' } }), res);
        expect(res.status).toHaveBeenCalledWith(404);
        expect(res.json).toHaveBeenCalledWith({ error: 'Repository not found on GitHub' });
    });

    it('returns 409 when an existing confirmed subscription is found', async () => {
        vi.mocked(validateRepo).mockResolvedValueOnce({ id: 1 } as any);
        vi.mocked(prisma.subscription.findFirst).mockResolvedValueOnce({ id: 'x', confirmed: true } as any);

        const res = makeRes();
        await subscribeToRepo(makeReq({ body: { email: 'user@test.com', repo: 'owner/repo' } }), res);

        expect(res.status).toHaveBeenCalledWith(409);
        expect(res.json).toHaveBeenCalledWith({ error: 'Email already subscribed to this repository.' });
        expect(prisma.subscription.create).not.toHaveBeenCalled();
    });

    it('returns 200 and resends email when an unconfirmed subscription exists and cooldown is inactive', async () => {
        vi.mocked(validateRepo).mockResolvedValueOnce({ id: 1 } as any);
        vi.mocked(prisma.subscription.findFirst).mockResolvedValueOnce({ id: 'x', confirmed: false } as any);
        vi.mocked(prisma.subscription.update).mockResolvedValueOnce({} as any);
        vi.mocked(redisConnection.get).mockResolvedValueOnce(null);

        const res = makeRes();
        await subscribeToRepo(makeReq({ body: { email: 'user@test.com', repo: 'owner/repo' } }), res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect((vi.mocked(res.json).mock.calls[0]?.[0] as any).message).toBe('Confirmation email resent.');
        expect(emailQueue.add).toHaveBeenCalledWith('email-job',
            expect.objectContaining({ type: 'subscription_confirmation' })
        );
        expect(redisConnection.setex).toHaveBeenCalledWith('confirm_cooldown:user@test.com', 30, 'true');
    });

    it('returns 200 but skips resending email when active cooldown exists', async () => {
        vi.mocked(validateRepo).mockResolvedValueOnce({ id: 1 } as any);
        vi.mocked(prisma.subscription.findFirst).mockResolvedValueOnce({ id: 'x', confirmed: false } as any);
        vi.mocked(prisma.subscription.update).mockResolvedValueOnce({} as any);
        vi.mocked(redisConnection.get).mockResolvedValueOnce('true');

        const res = makeRes();
        await subscribeToRepo(makeReq({ body: { email: 'user@test.com', repo: 'owner/repo' } }), res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect((vi.mocked(res.json).mock.calls[0]?.[0] as any).message).toBe('Confirmation email resent.');
        expect(emailQueue.add).not.toHaveBeenCalled();
    });

    it('returns 200 and queues confirmation email on new subscription', async () => {
        vi.mocked(validateRepo).mockResolvedValueOnce({ id: 1 } as any);
        vi.mocked(prisma.subscription.findFirst).mockResolvedValueOnce(null);
        vi.mocked(prisma.subscription.create).mockResolvedValueOnce({ id: 'sub-1' } as any);

        const res = makeRes();
        await subscribeToRepo(makeReq({ body: { email: 'user@test.com', repo: 'owner/repo' } }), res);

        expect(res.status).toHaveBeenCalledWith(200);
        const body = vi.mocked(res.json).mock.calls[0]?.[0] as any;
        expect(body.message).toBe('Subscription successful. Confirmation email sent.');
        expect(body.subscriptionId).toBe('sub-1');
        expect(emailQueue.add).toHaveBeenCalledWith('email-job',
            expect.objectContaining({ type: 'subscription_confirmation' })
        );
    });

    it('returns 500 on unexpected database error during subscription creation', async () => {
        vi.mocked(validateRepo).mockResolvedValueOnce({ id: 1 } as any);
        vi.mocked(prisma.subscription.findFirst).mockResolvedValueOnce(null);
        vi.mocked(prisma.subscription.create).mockRejectedValueOnce(new Error('DB crashed'));

        const res = makeRes();
        await subscribeToRepo(makeReq({ body: { email: 'user@test.com', repo: 'owner/repo' } }), res);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'DB crashed' }));
    });
});

//  GET /confirm/:subscriptionToken

describe('confirmSubscription', () => {
    beforeEach(() => vi.clearAllMocks());

    it('returns 400 when token is missing', async () => {
        const res = makeRes();
        await confirmSubscription(makeReq({ params: { subscriptionToken: '' } }), res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ error: 'Invalid subscription token.' });
    });

    it('returns 404 when token is not found in DB', async () => {
        vi.mocked(prisma.subscription.findUnique).mockResolvedValueOnce(null);
        const res = makeRes();
        await confirmSubscription(makeReq({ params: { subscriptionToken: '123456' } }), res);
        expect(res.status).toHaveBeenCalledWith(404);
        expect(res.json).toHaveBeenCalledWith({ error: 'Subscription not found or was already confirmed.' });
    });

    it('returns 400 when token has expired', async () => {
        vi.mocked(prisma.subscription.findUnique).mockResolvedValueOnce({
            id: 'sub-1',
            confirmationTokenExpiresAt: new Date(Date.now() - 60_000),
        } as any);
        const res = makeRes();
        await confirmSubscription(makeReq({ params: { subscriptionToken: '123456' } }), res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
            error: 'Confirmation token has expired. Please subscribe again to get a new code.',
        });
    });

    it('returns 200, confirms subscription, and clears token on success', async () => {
        vi.mocked(prisma.subscription.findUnique).mockResolvedValueOnce({
            id: 'sub-1',
            confirmationTokenExpiresAt: new Date(Date.now() + 30 * 60_000),
        } as any);
        vi.mocked(prisma.subscription.update).mockResolvedValueOnce({} as any);

        const res = makeRes();
        await confirmSubscription(makeReq({ params: { subscriptionToken: '123456' } }), res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({ message: 'Subscription confirmed successfully.' });
        expect(prisma.subscription.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ confirmed: true, confirmationToken: null }),
        }));
    });
});

//  GET /subscriptions

describe('getSubscriptionsForEmail', () => {
    beforeEach(() => vi.clearAllMocks());

    it('returns 400 when email query param is missing or not a string', async () => {
        const res = makeRes();
        await getSubscriptionsForEmail(makeReq({ query: {} }), res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ error: 'Invalid email.' });
    });

    it('returns 200 with empty array when email has no subscriptions', async () => {
        vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);
        const res = makeRes();
        await getSubscriptionsForEmail(makeReq({ query: { email: 'nobody@test.com' } }), res);
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith([]);
    });

    it('returns 200 with correctly shaped subscription list matching Swagger schema', async () => {
        vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
            email: 'user@test.com',
            subscriptions: [
                { confirmed: true, repository: { fullName: 'owner/repo', lastSeenTag: 'v1.0.0' } },
            ],
        } as any);
        const res = makeRes();
        await getSubscriptionsForEmail(makeReq({ query: { email: 'user@test.com' } }), res);
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith([{
            email: 'user@test.com',
            repo: 'owner/repo',
            confirmed: true,
            last_seen_tag: 'v1.0.0',
        }]);
    });
});

//  GET /unsubscribe/:unsubscribeToken

describe('cancelSubscription', () => {
    beforeEach(() => vi.clearAllMocks());

    it('returns 400 when unsubscribe token is missing', async () => {
        const res = makeRes();
        await cancelSubscription(makeReq({ params: { unsubscribeToken: '' } }), res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ error: 'Invalid unsubscribe token.' });
    });

    it('returns 404 when unsubscribe token is not found in DB', async () => {
        vi.mocked(prisma.subscription.findUnique).mockResolvedValueOnce(null);
        const res = makeRes();
        await cancelSubscription(makeReq({ params: { unsubscribeToken: 'dead' } }), res);
        expect(res.status).toHaveBeenCalledWith(404);
        expect(res.json).toHaveBeenCalledWith({ error: 'Unsubscribe token not found.' });
    });

    it('returns 200 and deletes the subscription', async () => {
        vi.mocked(prisma.subscription.findUnique).mockResolvedValueOnce({
            id: 'sub-1',
            user: { email: 'user@test.com' },
            repository: { fullName: 'owner/repo' },
        } as any);
        vi.mocked(prisma.subscription.delete).mockResolvedValueOnce({} as any);

        const res = makeRes();
        await cancelSubscription(makeReq({ params: { unsubscribeToken: 'abc12345' } }), res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({ message: 'Subscription successfully cancelled.' });
        expect(prisma.subscription.delete).toHaveBeenCalledWith({ where: { id: 'sub-1' } });
    });
});
