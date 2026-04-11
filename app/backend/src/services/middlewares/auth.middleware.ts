import type { Request, Response, NextFunction } from "express";

export const requireApiKeyAuth = (req: Request, res: Response, next: NextFunction) => {
    const apiKey = req.headers['x-api-key'];
    const validKey = process.env.ADMIN_API_KEY;
    if (!validKey) {
        console.error('[API MIDDLEWARE]ADMIN_API_KEY is not defined in the environment variables');
        res.status(500).json({ error: 'Internal server error' });
        return;
    }
    if (!apiKey || apiKey !== validKey) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    next();
}