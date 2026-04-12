import { Cron } from 'croner';
import { prisma } from "../prisma_setup/database.js";
import { octokit } from '../octokit_setup/octokit.js';
import {
    notifySubscribers,
    updateRepoState,
    handleGitHubScannerError
} from './scanner-helper.service.js';

const processRepo = async (repo: any) => {
    try {
        const [owner, repoName] = repo.fullName.split('/');
        if (!owner || !repoName) {
            console.error(`[Scanner] Invalid repository format in DB: ${repo.fullName}`);
            return;
        }

        const requestOptions: any = { owner, repo: repoName };
        if (repo.etag) requestOptions.headers = { 'If-None-Match': repo.etag };

        const response = await octokit.rest.repos.getLatestRelease(requestOptions);

        const latestTag = response.data.tag_name;
        const newEtag = response.headers.etag;

        if (newEtag && latestTag !== repo.lastSeenTag) {
            console.log(`[Scanner] New release for ${repo.fullName}: ${latestTag} (prev: ${repo.lastSeenTag})`);

            await notifySubscribers(repo.id, repo.fullName, latestTag);
            await updateRepoState(repo.id, newEtag, latestTag);

        } else if (newEtag && newEtag !== repo.etag) {
            console.log(`[Scanner] ETag updated for ${repo.fullName}.`);
            await updateRepoState(repo.id, newEtag);
        }

    } catch (error: any) {
        handleGitHubScannerError(error, repo.fullName);
    }
};

export const initScanner = () => {
    const job = new Cron('*/5 * * * *', async () => {
        console.log('[Scanner] job started at', new Date().toISOString());
        try {
            const activeRepos = await prisma.repository.findMany({
                where: { subscriptions: { some: { confirmed: true } } }
            });
            console.log(`[Scanner] Found ${activeRepos.length} active repositories with confirmed subscriptions.`);

            for (const repo of activeRepos) {
                await processRepo(repo);
            }
        }

        catch (scannerError: any) {
            console.error(`[Scanner] Error in scanner job:`, scannerError.message || scannerError);
        }
    });
}