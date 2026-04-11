import { describe, it, expect, vi } from 'vitest';

//  Mocks 

vi.mock('../services/prisma_setup/database.js', () => ({
    prisma: { subscription: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() } },
}));

vi.mock('../services/redis/queue.service.js', () => ({
    emailQueue: { add: vi.fn().mockResolvedValue(undefined) },
}));

import {
    generateConfirmationCode,
    generateUnsubscribeToken,
    getConfirmationExpiry,
    parseRepoFormat,
    isTokenExpired,
} from './subscription.helpers.js';

//  Token Generation 

describe('generateConfirmationCode', () => {
    it('returns a 6-digit numeric string', () => {
        expect(generateConfirmationCode()).toMatch(/^\d{6}$/);
    });
});

describe('generateUnsubscribeToken', () => {
    it('returns an 8-character hex string', () => {
        expect(generateUnsubscribeToken()).toMatch(/^[0-9a-f]{8}$/);
    });
});

describe('getConfirmationExpiry', () => {
    it('returns a date 30 minutes in the future', () => {
        const before = Date.now();
        const expiry = getConfirmationExpiry();
        const thirtyMins = 30 * 60 * 1000;
        expect(expiry.getTime()).toBeGreaterThanOrEqual(before + thirtyMins);
        expect(expiry.getTime()).toBeLessThanOrEqual(Date.now() + thirtyMins);
    });
});

//  parseRepoFormat 

describe('parseRepoFormat', () => {
    it('correctly parses a valid "owner/repo" string', () => {
        expect(parseRepoFormat('golang/go')).toEqual({ owner: 'golang', repoName: 'go' });
    });

    it('returns null for any invalid format (no slash, empty parts)', () => {
        expect(parseRepoFormat('badformat')).toBeNull();
        expect(parseRepoFormat('owner/')).toBeNull();
        expect(parseRepoFormat('/repo')).toBeNull();
    });
});

//  isTokenExpired 

describe('isTokenExpired', () => {
    it('returns true when expiresAt is in the past', () => {
        expect(isTokenExpired(new Date(Date.now() - 1000))).toBe(true);
    });

    it('returns false when expiresAt is in the future or null', () => {
        expect(isTokenExpired(new Date(Date.now() + 60_000))).toBe(false);
        expect(isTokenExpired(null)).toBe(false);
    });
});
