import { octokit } from '../services/octokit_setup/octokit.js';
import { redisConnection } from './redis/redis.setup.js';

export const validateRepo = async (owner: string, repo: string) => {
    const cacheKey = `github:repo:${owner}/${repo}`;
    try {
        const cachedRepo = await redisConnection.get(cacheKey);
        if (cachedRepo) {
            return JSON.parse(cachedRepo);
        }

        if (!owner || !repo || typeof owner !== 'string' || typeof repo !== 'string') {
            const error = new Error('Invalid repository data format.');
            (error as any).status = 400;
            throw error;
        }
        const response = await octokit.rest.repos.get({
            owner: owner,
            repo: repo
        });
        console.log(`Success! Status: ${response.status}, Repository: ${owner}/${repo} is valid.
                     Rate limit remaining: ${response.headers['x-ratelimit-remaining']}`);
        await redisConnection.setex(cacheKey, 600, JSON.stringify(response.data));
        return response.data;
    }
    catch (error: any) {
        const status = error.status || 500;
        const message = status === 404 ? 'Repository not found on GitHub' : (error.message || 'Internal server error');
        const rateLimitRemaining = error.headers ? error.headers['x-ratelimit-remaining'] : 'unknown';

        console.error(`Error! Status: ${status}, Message: ${message}, Rate limit remaining: ${rateLimitRemaining}`);

        const customError = new Error(message);
        (customError as any).status = status;
        throw customError;
    }
}