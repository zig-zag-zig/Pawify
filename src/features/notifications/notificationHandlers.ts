import { timingSafeEqual } from 'crypto';
import { publicHandler } from '../../common/http/handlers.js';
import { UnauthorizedError } from '../../common/http/errors.js';
import { createLogger } from '../../common/logging/logger.js';
import { notificationConfig } from '../../config/runtimeConfig.js';
import { notificationUseCases } from './notificationUseCases.js';

const logger = createLogger('features.notifications.handlers');

const timingSafeStringEquals = (left: string, right: string): boolean => {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);

    return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
};

const assertNotifyApiKey = (headerValue: string | undefined): void => {
    const configuredApiKey = notificationConfig.notifyApiKey;
    if (!configuredApiKey) {
        logger.error('notify api key is not configured');
        throw new UnauthorizedError();
    }

    const providedApiKey = headerValue?.trim();
    if (!providedApiKey || !timingSafeStringEquals(providedApiKey, configuredApiKey)) {
        throw new UnauthorizedError();
    }
};

export const notifyNewReleasesHandler = publicHandler('/notifyNewReleases', async (req, res) => {
    assertNotifyApiKey(req.header('x-api-key'));
    notificationUseCases.notifyNewReleases();
    res.status(200).send('Task to notify new releases has been triggered');
});
