import transporter from '../nodemailer/transporter.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const templatesDir = path.join(__dirname, 'mail-templates');

const confirmTemlate = fs.readFileSync(path.join(templatesDir, 'confirmation.html'), 'utf-8');
const unsubscribeTemplate = fs.readFileSync(path.join(templatesDir, 'unsubscription.html'), 'utf-8');
const notificationTemplate = fs.readFileSync(path.join(templatesDir, 'release.html'), 'utf-8');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000/api';
const GITHUB_BASE_URL = 'https://github.com';

export const sendEmailNotification = async (email: string, releaseTag: string,
    repoName: string, unsubscribeToken: string): Promise<void> => {
    try {
        const releaseLink = `${GITHUB_BASE_URL}/${repoName}/releases/tag/${releaseTag}`;

        const htmlToSend = notificationTemplate
            .replaceAll('{{repo_name}}', repoName)
            .replaceAll('{{release_tag}}', releaseTag)
            .replaceAll('{{release_link}}', releaseLink)
            .replaceAll('{{unsubscribe_code}}', unsubscribeToken);

        await transporter.sendMail({
            from: process.env.SMTP_USER,
            to: email,
            subject: `New Release ${releaseTag} in ${repoName}`,
            html: htmlToSend
        });
    }
    catch (error: any) {
        console.error('Error sending notification email:', error);
    }
}

export const sendEmailSubscriptionConfirmation = async (email: string, token: string, repoName: string): Promise<void> => {
    try {
        const htmlToSend = confirmTemlate
            .replaceAll('{{repo_name}}', repoName)
            .replaceAll('{{code}}', token);

        await transporter.sendMail({
            from: process.env.SMTP_USER,
            to: email,
            subject: `Confirm Your Subscription to ${repoName}`,
            html: htmlToSend
        });
    } catch (error: any) {
        console.error('Error sending subscription confirmation email:', error);
    }
};

export const sendEmailUnsubscriptionNotify = async (email: string, repoName: string): Promise<void> => {
    try {
        const htmlToSend = unsubscribeTemplate.replace('{{repo_name}}', repoName);

        await transporter.sendMail({
            from: process.env.SMTP_USER,
            to: email,
            subject: `Unsubscription from ${repoName} Confirmed`,
            html: htmlToSend
        });
    }
    catch (error: any) {
        console.error('Error sending unsubscription notification email:', error);
    }
}