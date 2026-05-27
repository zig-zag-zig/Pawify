import { randomUUID } from 'crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { createLogger } from '../logging/logger.js';
import { runWithRequestContext } from '../logging/requestContext.js';

type Handler = (req: Request, res: Response, next: NextFunction) => Promise<void> | void;
const logger = createLogger('http');

const resolveRequestId = (req: Request): string => {
    const fromHeader = req.header('x-request-id');
    const normalized = typeof fromHeader === 'string' ? fromHeader.trim() : '';
    return normalized.length > 0 ? normalized : randomUUID();
};

export const asyncHandler = (handler: Handler): RequestHandler => {
    return (req, res, next) => {
        Promise.resolve(handler(req, res, next)).catch(next);
    };
};

export const publicHandler = (
    endpointName: string,
    handler: (req: Request, res: Response) => Promise<void> | void,
): RequestHandler => {
    return asyncHandler(async (req, res) => {
        const requestId = resolveRequestId(req);
        res.setHeader('x-request-id', requestId);

        await runWithRequestContext({
            requestId,
            endpoint: endpointName,
            method: req.method,
            path: req.originalUrl,
        }, async () => {
            const startedAt = Date.now();
            logger.debug('public request started');
            await handler(req, res);
            logger.debug('public request completed', {
                statusCode: res.statusCode,
                durationMs: Date.now() - startedAt,
            });
        });
    });
};
