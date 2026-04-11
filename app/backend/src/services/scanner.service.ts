import { Cron } from 'croner';
import { prisma } from "../services/prisma_setup/database.js";
import { octokit } from '../services/octokit_setup/octokit.js';
import { emailQueue } from '../services/redis/queue.service.js';

export const initScanner = () => {
    const job = new Cron('*/5 * * * *', async () => {
        console.log('[Scanner] job started at', new Date().toISOString());
        try {
            const activeRepos = await prisma.repository.findMany({
                where: { subscriptions: { some: { confirmed: true } } }
            });
            console.log(`[Scanner] Found ${activeRepos.length} active repositories with confirmed subscriptions.`);

            for (const repo of activeRepos) {
                try {
                    const [owner, repoName] = repo.fullName.split('/');

                    if (!owner || !repoName) {
                        console.error(`[Scanner] Невалідний формат репозиторію в БД: ${repo.fullName}`);
                        continue;
                    }

                    const requestOptions: any = {
                        owner: owner,
                        repo: repoName
                    };
                    if (repo.etag) {
                        requestOptions.headers = {
                            'If-None-Match': repo.etag
                        };
                    }

                    const response = await octokit.rest.repos.getLatestRelease(requestOptions);
                    const latestRelease = response.data;

                    const latest_tag = latestRelease.tag_name;
                    const newEtag = response.headers.etag;

                    // Somewhere here will be putted the logic of sending emails

                    if (newEtag && latest_tag !== repo.lastSeenTag) {
                        console.log(`[Scanner] New release was detected for ${repo.fullName}: ${latestRelease.tag_name} (previous: ${repo.lastSeenTag})`);
                        const subscribers = await prisma.subscription.findMany({
                            where: {
                                repositoryId: repo.id,
                                confirmed: true
                            },
                            include: {
                                user: true
                            }
                        });
                        for (const sub of subscribers) {
                            await emailQueue.add('email-job', {
                                type: "release_notification",
                                data: {
                                    email: sub.user.email,
                                    repoName: repo.fullName,
                                    releaseTag: latest_tag,
                                    unsubscribeToken: sub.unsubscribeToken
                                }
                            });
                        }
                        await prisma.repository.update({
                            where: { id: repo.id },
                            data: {
                                lastSeenTag: latest_tag,
                                etag: newEtag
                            }
                        });
                    }
                    else if (newEtag && newEtag !== repo.etag) {
                        console.log(`[Scanner] No new release for ${repo.fullName}, but ETag has changed. Updating ETag in database.`);
                        await prisma.repository.update({
                            where: { id: repo.id },
                            data: { etag: newEtag }
                        });
                    }
                }
                catch (apiError: any) {
                    if (apiError.status === 304) {
                        console.log(`[Scanner] No new release for ${repo.fullName}.`);
                    }
                    else if (apiError.status === 404) {
                        console.warn(`[Scanner] No releases found for ${repo.fullName}. Skipping.`);
                    }
                    else if (apiError.status === 429) {
                        console.error(`[Scanner] Rate limit exceeded for ${repo.fullName}.`);
                    }
                    else {
                        console.error(`[Scanner] Error scanning ${repo.fullName}:`, apiError.message || apiError);
                    }
                }
            }
        }

        catch (scannerError: any) {
            console.error(`[Scanner] Error in scanner job:`, scannerError.message || scannerError);
        }
    });
}