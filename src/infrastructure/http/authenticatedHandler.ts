import { randomUUID } from 'crypto';
import type { Request, RequestHandler, Response } from 'express';
import { asyncHandler } from '../../common/http/handlers.js';
import { UnauthorizedError } from '../../common/http/errors.js';
import { createLogger } from '../../common/logging/logger.js';
import {
    runWithRequestContext,
    setRequestContextFields,
} from '../../common/logging/requestContext.js';
import { checkAuth } from '../../services/firebaseService.js';

type AuthenticatedHandler = (context: {
    req: Request;
    res: Response;
    userId: string;
}) => Promise<void> | void;

const logger = createLogger('http.auth');

const resolveRequestId = (req: Request): string => {
    const fromHeader = req.header('x-request-id');
    const normalized = typeof fromHeader === 'string' ? fromHeader.trim() : '';
    return normalized.length > 0 ? normalized : randomUUID();
};

export const authenticatedHandler = (
    endpointName: string,
    handler: AuthenticatedHandler,
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
            logger.debug('authenticated request started');

            // Authenticated API responses are user-specific and should always be fresh.
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');

            const userId = await checkAuth(req).catch((error) => {
                logger.debug('authentication failed', { error });
                throw new UnauthorizedError();
            });

            setRequestContextFields({ userId });

            await handler({ req, res, userId });
            logger.debug('authenticated request completed', {
                statusCode: res.statusCode,
                durationMs: Date.now() - startedAt,
            });
        });
    });
};
