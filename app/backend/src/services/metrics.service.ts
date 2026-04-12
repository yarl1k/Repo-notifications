import client from "prom-client";

export const metrics = new client.Registry();

client.collectDefaultMetrics({ register: metrics });

export const emailsSentCounter = new client.Counter({
    name: 'emails_sent_total',
    help: 'Total number of emails sent',
    labelNames: ['email_type'],
});

metrics.registerMetric(emailsSentCounter);
