import express from 'express';
import mainRouter from "./routers/index.js";
import { initScanner } from './services/scanner/scanner.service.js';
import './services/redis/queue.service.js';
import { prisma } from './services/prisma_setup/database.js';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import { metrics } from './services/metrics.service.js';
import { requireApiKeyAuth } from './services/middlewares/auth.middleware.js';

const app = express();

app.set('trust proxy', 1);

app.use(helmet());

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: 'Too many requests from this IP, please try again after 15 minutes',
})
app.use('/api', apiLimiter);

app.use(express.json());

app.use('/api', mainRouter);

app.get('/', (req, res) => {
    res.json({ message: 'API is running' });
});

app.get('/metrics', requireApiKeyAuth, async (req, res) => {
    try {
        res.set('Content-Type', metrics.contentType);
        res.end(await metrics.metrics());
    }
    catch (error: any) {
        console.error('Error getting metrics:', error.message || error);
        res.status(500).json({ error: error.message || 'An error occurred while getting metrics.' });
    }
});
const PORT = process.env.PORT || 3000;

const startServer = async () => {
    try {
        await prisma.$connect();
        console.log('Database connected successfully.');

        app.listen(PORT, () => {
            console.log(`API Сервер запущено на http://localhost:${PORT}`);
        });

        initScanner();
        console.log('Scanner initialized.');
        console.log('BullMQ started');
    }
    catch (error: any) {
        console.error('Error starting server:', error.message || error);
        process.exit(1);
    }
}

startServer();
