import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import type { Logger } from '../logging/logger.js';
import { runWithRequestContext } from '../logging/requestContext.js';

type HttpRequestScopeOptions = {
    endpointName: string;
    handler: () => Promise<void> | void;
    logger: Logger;
    requestKind: 'authenticated' | 'public';
    req: Request;
    res: Response;
};

const resolveRequestId = (req: Request): string => {
    const fromHeader = req.header('x-request-id');
    const normalized = typeof fromHeader === 'string' ? fromHeader.trim() : '';
    return normalized.length > 0 ? normalized : randomUUID();
};

export const runHttpRequestScope = async ({
    endpointName,
    handler,
    logger,
    requestKind,
    req,
    res,
}: HttpRequestScopeOptions): Promise<void> => {
    const requestId = resolveRequestId(req);
    res.setHeader('x-request-id', requestId);

    await runWithRequestContext(
        {
            requestId,
            endpoint: endpointName,
            method: req.method,
            path: req.originalUrl,
        },
        async () => {
            const startedAt = Date.now();
            logger.debug(`${requestKind} request started`);

            await handler();

            logger.debug(`${requestKind} request completed`, {
                statusCode: res.statusCode,
                durationMs: Date.now() - startedAt,
            });
        },
    );
};
