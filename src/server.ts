import type { Express } from 'express';
import { createLogger } from './common/logging/logger.js';
import { serverConfig } from './config/runtimeConfig.js';
import { captureError, flushErrorMonitoring } from './infrastructure/monitoring/sentry.js';

const logger = createLogger('server');

export const startServer = (app: Express): void => {
    app.listen(serverConfig.port, () => {
        logger.info('server started', { port: serverConfig.port });
    });
};

process.on('unhandledRejection', (reason) => {
    logger.error('unhandled promise rejection', { reason });
    captureError(reason, { source: 'unhandledRejection' });
});

process.on('uncaughtException', (error) => {
    logger.error('uncaught exception', { error });
    captureError(error, { source: 'uncaughtException' });
    void flushErrorMonitoring().finally(() => {
        process.exit(1);
    });
});
