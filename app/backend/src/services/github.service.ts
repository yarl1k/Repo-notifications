import { octokit } from '../services/octokit_setup/octokit.js';
import { redisConnection } from './redis/redis.setup.js';

export const validateRepo = async (owner: string, repo: string) => {
    if (!owner || !repo || typeof owner !== 'string' || typeof repo !== 'string') {
        const error: any = new Error('Invalid repository data format.');
        error.status = 400;
        throw error;
    }

    const cacheKey = `github:repo:${owner}/${repo}`;

    try {
        const cachedRepo = await redisConnection.get(cacheKey);
        if (cachedRepo) {
            return JSON.parse(cachedRepo);
        }

        const response = await octokit.rest.repos.get({ owner, repo });
        console.log(`[GitHub] Validated ${owner}/${repo}. Rate limit remaining: ${response.headers['x-ratelimit-remaining']}`);

        await redisConnection.setex(cacheKey, 600, JSON.stringify(response.data));
        return response.data;

    } catch (error: any) {
        const status = error.status || 500;
        const rateLimitRemaining = error.headers?.['x-ratelimit-remaining'] || 'unknown';

        let message = 'Internal server error';
        if (status === 404) message = 'Repository not found on GitHub';
        else if (status === 403 || status === 429) message = 'GitHub API rate limit exceeded';
        else if (error.message) message = error.message;

        console.error(`[GitHub Error] Status: ${status}, Message: ${message}, Limit: ${rateLimitRemaining}`);

        const customError: any = new Error(message);
        customError.status = status;

        throw customError;
    }
}