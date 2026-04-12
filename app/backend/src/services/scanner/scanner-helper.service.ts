import { prisma } from "../prisma_setup/database.js";
import { emailQueue } from "../redis/queue.service.js";

export const notifySubscribers = async (repoId: number, repoFullName: string, latestTag: string): Promise<void> => {
    const subscribers = await prisma.subscription.findMany({
        where: { repositoryId: repoId, confirmed: true },
        include: { user: true }
    });

    if (subscribers.length === 0) return;

    const jobsToInsert = subscribers.map(sub => ({
        name: 'email-job',
        data: {
            type: "release_notification",
            data: {
                email: sub.user.email,
                repoName: repoFullName,
                releaseTag: latestTag,
                unsubscribeToken: sub.unsubscribeToken
            }
        }
    }));
    await emailQueue.addBulk(jobsToInsert);

    console.log(`[Queue] Successfully added ${jobsToInsert.length} email jobs to queue for ${repoFullName}`);
};

export const updateRepoState = async (repoId: number, newEtag: string, latestTag?: string): Promise<void> => {
    const dataToUpdate: any = { etag: newEtag };
    if (latestTag) {
        dataToUpdate.lastSeenTag = latestTag;
    }

    await prisma.repository.update({
        where: { id: repoId },
        data: dataToUpdate
    });
};

export const handleGitHubScannerError = (apiError: any, repoFullName: string): void => {
    if (apiError.status === 304) {
        console.log(`[Scanner] No releases found for ${repoFullName}. Skipping.`);
    } else if (apiError.status === 404) {
        console.warn(`[Scanner] No releases found for ${repoFullName}. Skipping.`);
    } else if (apiError.status === 429) {
        console.error(`[Scanner] Rate limit exceeded for ${repoFullName}.`);
    } else {
        console.error(`[Scanner] Error scanning ${repoFullName}:`, apiError.message || apiError);
    }
};