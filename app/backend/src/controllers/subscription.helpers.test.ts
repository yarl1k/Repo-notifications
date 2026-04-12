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
    isValidEmail,
} from './subscription.helpers.js';

//  Token Generation 

describe('generateConfirmationCode', () => {
    it('returns a 6-digit numeric string', () => {
        expect(generateConfirmationCode()).toMatch(/^\d{6}$/);
    });
});

describe('generateUnsubscribeToken', () => {
    it('returns a 6-digit numeric string', () => {
        expect(generateUnsubscribeToken()).toMatch(/^\d{6}$/);
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

    it('parses repos with hyphens, dots, and underscores', () => {
        expect(parseRepoFormat('my-org/my_repo.js')).toEqual({ owner: 'my-org', repoName: 'my_repo.js' });
    });

    it('returns null for any invalid format (no slash, empty parts)', () => {
        expect(parseRepoFormat('badformat')).toBeNull();
        expect(parseRepoFormat('owner/')).toBeNull();
        expect(parseRepoFormat('/repo')).toBeNull();
    });

    it('returns null for extra slashes (owner/repo/extra)', () => {
        expect(parseRepoFormat('owner/repo/extra')).toBeNull();
    });

    it('returns null for special characters (XSS attempt)', () => {
        expect(parseRepoFormat('owner/<script>')).toBeNull();
        expect(parseRepoFormat('owner/repo; rm -rf')).toBeNull();
    });

    it('returns null for path traversal attempts', () => {
        expect(parseRepoFormat('../etc/passwd')).toBeNull();
        expect(parseRepoFormat('owner/..hidden')).toBeNull();
    });

    it('returns null when owner exceeds 39 chars', () => {
        expect(parseRepoFormat('a'.repeat(40) + '/repo')).toBeNull();
    });
});

//  isValidEmail

describe('isValidEmail', () => {
    it('returns true for valid emails', () => {
        expect(isValidEmail('user@example.com')).toBe(true);
        expect(isValidEmail('first.last@domain.org')).toBe(true);
        expect(isValidEmail('user+tag@sub.domain.com')).toBe(true);
    });

    it('returns false for strings without @', () => {
        expect(isValidEmail('12121')).toBe(false);
        expect(isValidEmail('justastring')).toBe(false);
    });

    it('returns false for strings without a TLD', () => {
        expect(isValidEmail('user@host')).toBe(false);
    });

    it('returns false for TLD shorter than 2 chars', () => {
        expect(isValidEmail('user@host.a')).toBe(false);
    });

    it('returns false for empty strings and whitespace', () => {
        expect(isValidEmail('')).toBe(false);
        expect(isValidEmail('   ')).toBe(false);
    });

    it('returns false for emails exceeding 254 chars', () => {
        expect(isValidEmail('a'.repeat(250) + '@b.com')).toBe(false);
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
