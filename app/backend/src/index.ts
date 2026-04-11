import express from 'express';
import mainRouter from "./routers/index.js";
import { initScanner } from './services/scanner.service.js';
import './services/redis/queue.service.js';
import { prisma } from './services/prisma_setup/database.js';



const app = express();

app.use(express.json());

// Main API Router
app.use('/api', mainRouter);

// Basic health check route
app.get('/', (req, res) => {
    res.json({ message: 'API is running' });
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
