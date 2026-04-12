import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { requireApiKeyAuth } from './auth.middleware.js';

function makeRes() {
    return {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
    } as unknown as Response;
}

describe('requireApiKeyAuth', () => {
    const originalEnv = process.env;

    afterEach(() => {
        process.env = { ...originalEnv };
    });

    it('returns 500 when ADMIN_API_KEY is not configured', () => {
        delete process.env['ADMIN_API_KEY'];
        const req = { headers: { 'x-api-key': 'any-key' } } as unknown as Request;
        const res = makeRes();
        const next = vi.fn() as NextFunction;

        requireApiKeyAuth(req, res, next);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({ error: 'Internal server error' });
        expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 when x-api-key header is missing', () => {
        process.env['ADMIN_API_KEY'] = 'secret';
        const req = { headers: {} } as unknown as Request;
        const res = makeRes();
        const next = vi.fn() as NextFunction;

        requireApiKeyAuth(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
        expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 when x-api-key is wrong', () => {
        process.env['ADMIN_API_KEY'] = 'secret';
        const req = { headers: { 'x-api-key': 'wrong-key' } } as unknown as Request;
        const res = makeRes();
        const next = vi.fn() as NextFunction;

        requireApiKeyAuth(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
    });

    it('calls next() when correct API key is provided', () => {
        process.env['ADMIN_API_KEY'] = 'secret';
        const req = { headers: { 'x-api-key': 'secret' } } as unknown as Request;
        const res = makeRes();
        const next = vi.fn() as NextFunction;

        requireApiKeyAuth(req, res, next);

        expect(next).toHaveBeenCalledOnce();
        expect(res.status).not.toHaveBeenCalled();
    });
});
