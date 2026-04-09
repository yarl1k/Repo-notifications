import { Octokit } from '@octokit/rest';

const octokitOptions = {
    userAgent: 'RepoNotificationsApp',
    ...(process.env.GITHUB_ACCESS_TOKEN && { auth: process.env.GITHUB_ACCESS_TOKEN })
};

const octokit = new Octokit(octokitOptions);

export const validateRepo = async (owner: string, repo: string) => {
    try {
        if(!owner || !repo || typeof owner !== 'string' || typeof repo !== 'string') {
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
        return response.data;
    }
catch (error: any) {
        const status = error.status || 500;
        const message = status === 404 ? 'Репозиторій не знайдено' : (error.message || 'Internal server error');
        const rateLimitRemaining = error.headers ? error.headers['x-ratelimit-remaining'] : 'unknown';
        
        console.error(`Error! Status: ${status}, Message: ${message}, Rate limit remaining: ${rateLimitRemaining}`);

        const customError = new Error(message);
        (customError as any).status = status; 
        throw customError; 
    }
}