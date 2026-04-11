import { Octokit } from "@octokit/rest";

const octokitOptions = {
    userAgent: 'RepoNotificationsApp',
    ...(process.env.GITHUB_ACCESS_TOKEN && { auth: process.env.GITHUB_ACCESS_TOKEN })
};

export const octokit: Octokit = new Octokit(octokitOptions);