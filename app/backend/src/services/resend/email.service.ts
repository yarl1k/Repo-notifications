import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Resend } from 'resend';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const templatesDir = path.join(__dirname, 'mail-templates');

const confirmTemlate = fs.readFileSync(path.join(templatesDir, 'confirmation.html'), 'utf-8');
const notificationTemplate = fs.readFileSync(path.join(templatesDir, 'release.html'), 'utf-8');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000/api';
const GITHUB_BASE_URL = 'https://github.com';

const resend = new Resend(process.env.RESEND_API_KEY);

export const sendMail = async (email: string, subject: string, htmlToSend: string): Promise<void> => {
    try {
        const { data, error } = await resend.emails.send({
            from: process.env.RESEND_USER_FROM || '"RepoNotify" <noreply@yarl1k.tech>',
            to: [email],
            subject: subject,
            html: htmlToSend
        });
    }
    catch (error: any) {
        console.error(`[Mail Service] Error sending email to ${email}:`, error);
    }
}

export const sendEmailNotification = async (email: string, releaseTag: string,
    repoName: string, unsubscribeToken: string): Promise<void> => {
    const releaseLink = `${GITHUB_BASE_URL}/${repoName}/releases/tag/${releaseTag}`;

    const htmlToSend = notificationTemplate
        .replaceAll('{{repo_name}}', repoName)
        .replaceAll('{{release_tag}}', releaseTag)
        .replaceAll('{{release_link}}', releaseLink)
        .replaceAll('{{unsubscribe_code}}', unsubscribeToken);

    await sendMail(email, `New Release ${releaseTag} in ${repoName}`, htmlToSend);
}

export const sendEmailSubscriptionConfirmation = async (email: string, token: string, repoName: string): Promise<void> => {
    const htmlToSend = confirmTemlate
        .replaceAll('{{repo_name}}', repoName)
        .replaceAll('{{code}}', token);

    await sendMail(email, `Confirm Your Subscription to ${repoName}`, htmlToSend);
};