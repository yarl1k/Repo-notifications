
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocks

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));

vi.mock('../services/octokit_setup/octokit.js', () => ({
    octokit: {
        rest: {
            repos: {
                get: mockGet,
            },
        },
    },
}));

const { mockRedisGet, mockRedisSetex } = vi.hoisted(() => ({
    mockRedisGet: vi.fn(),
    mockRedisSetex: vi.fn()
}));

vi.mock('./redis/redis.setup.js', () => ({
    redisConnection: {
        get: mockRedisGet,
        setex: mockRedisSetex,
    },
}));


import { validateRepo } from './github.service.js';

// Tests

describe('validateRepo', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // Cache hit — returns parsed value without calling octokit
    it('returns cached data from Redis without calling GitHub API', async () => {
        const cachedData = { id: 1, full_name: 'owner/repo' };
        mockRedisGet.mockResolvedValueOnce(JSON.stringify(cachedData));

        const result = await validateRepo('owner', 'repo');

        expect(result).toEqual(cachedData);
        expect(mockGet).not.toHaveBeenCalled();
        expect(mockRedisSetex).not.toHaveBeenCalled();
    });

    // Cache miss — calls GitHub API and stores result
    it('calls GitHub API on cache miss and stores result in Redis', async () => {
        mockRedisGet.mockResolvedValueOnce(null);
        const repoData = { id: 42, full_name: 'owner/repo' };
        mockGet.mockResolvedValueOnce({
            status: 200,
            data: repoData,
            headers: { 'x-ratelimit-remaining': '59' },
        });
        mockRedisSetex.mockResolvedValueOnce('OK');

        const result = await validateRepo('owner', 'repo');

        expect(mockGet).toHaveBeenCalledWith({ owner: 'owner', repo: 'repo' });
        expect(mockRedisSetex).toHaveBeenCalledWith(
            'github:repo:owner/repo',
            600,
            JSON.stringify(repoData)
        );
        expect(result).toEqual(repoData);
    });

    // 404 from GitHub — throws error with status 404 and correct message
    it('throws an error with status 404 and "Repository not found on GitHub" message', async () => {
        mockRedisGet.mockResolvedValueOnce(null);
        const notFoundError = Object.assign(new Error('Not Found'), {
            status: 404,
            headers: { 'x-ratelimit-remaining': '58' },
        });
        mockGet.mockRejectedValueOnce(notFoundError);

        await expect(validateRepo('owner', 'missing-repo')).rejects.toMatchObject({
            message: 'Repository not found on GitHub',
            status: 404,
        });
    });

    // 429 Rate limit — preserves 429 status
    it('throws an error with status 429 when GitHub rate limit is exceeded', async () => {
        mockRedisGet.mockResolvedValueOnce(null);
        const rateLimitError = Object.assign(new Error('Too Many Requests'), {
            status: 429,
            headers: { 'x-ratelimit-remaining': '0' },
        });
        mockGet.mockRejectedValueOnce(rateLimitError);

        await expect(validateRepo('owner', 'repo')).rejects.toMatchObject({
            status: 429,
        });
    });

    // Unexpected 500 — rethrows with 500 status
    it('throws an error with status 500 on unexpected GitHub API error', async () => {
        mockRedisGet.mockResolvedValueOnce(null);
        const serverError = new Error('Something went wrong');
        // No .status set — should default to 500
        mockGet.mockRejectedValueOnce(serverError);

        await expect(validateRepo('owner', 'repo')).rejects.toMatchObject({
            status: 500,
        });
    });

    // Redis failure doesn't crash — falls through to GitHub API
    it('falls back to GitHub API when Redis GET throws', async () => {
        mockRedisGet.mockRejectedValueOnce(new Error('Redis unreachable'));
        await expect(validateRepo('owner', 'repo')).rejects.toMatchObject({
            status: 500,
        });
    });
});
