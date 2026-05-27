import type { Express } from 'express';
import { createLogger } from './common/logging/logger.js';
import { serverConfig } from './config/runtimeConfig.js';
import { captureError, flushErrorMonitoring } from './infrastructure/monitoring/sentry.js';

const logger = createLogger('server');

const startKeepAlive = (): void => {
    const keepAliveUrl = serverConfig.keepAliveUrl;
    if (!keepAliveUrl) {
        return;
    }

    const keepAlive = () => {
        void fetch(keepAliveUrl).catch(() => { });
    };

    keepAlive();
    setInterval(keepAlive, serverConfig.keepAliveIntervalMs).unref?.();
};

export const startServer = (app: Express): void => {
    app.listen(serverConfig.port, () => {
        logger.info('server started', { port: serverConfig.port });
        startKeepAlive();
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
