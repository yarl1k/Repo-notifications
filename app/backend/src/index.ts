import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import mainRouter from "./routers/index.js";
import { initScanner } from './services/scanner/scanner.service.js';
import './services/redis/queue.service.js';
import { prisma } from './services/prisma_setup/database.js';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { metrics } from './services/metrics.service.js';
import { requireApiKeyAuth } from './services/middlewares/auth.middleware.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.set('trust proxy', 1);

app.use(helmet({
    contentSecurityPolicy: false,
}));

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: 'Too many requests from this IP, please try again after 15 minutes',
});

app.use('/api', apiLimiter);
app.use(express.json());

app.use('/api', mainRouter);

if (process.env.NODE_ENV !== 'production') {
    try {
        const { default: swaggerUi } = await import('swagger-ui-express');
        const { default: YAML } = await import('yaml');
        const fs = await import('fs');

        const swaggerPath = path.join(__dirname, '../swagger.yaml');
        const fileContents = fs.readFileSync(swaggerPath, 'utf-8');
        const swaggerDoc = YAML.parse(fileContents);

        app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDoc));
        console.log('📘 [Swagger] UI available at http://localhost:3000/api-docs');
    } catch (error) {
        console.error('❌ [Swagger] Помилка завантаження:', error);
    }
}

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

const frontendPath = path.join(__dirname, '../../frontend');
app.use(express.static(frontendPath));

app.get(/.*/, (req, res) => {
    res.sendFile(path.join(frontendPath, 'index.html'));
});
const PORT = process.env.PORT || 3000;

const startServer = async () => {
    try {
        await prisma.$connect();
        console.log('Database connected successfully.');

        app.listen(PORT, () => {
            console.log(`API Сервер запущено на порту ${PORT}`);
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