import express, { type Router } from 'express';
import { artistRoutes } from '../features/artists/artistRoutes.js';
import { authRoutes } from '../features/auth/authRoutes.js';
import { healthRoutes } from '../features/health/healthRoutes.js';
import { notificationRoutes } from '../features/notifications/notificationRoutes.js';
import { pushTokenRoutes } from '../features/pushTokens/pushTokenRoutes.js';
import { releaseRoutes } from '../features/releases/releaseRoutes.js';
import { taskRoutes } from '../features/tasks/taskRoutes.js';
import { userSettingsRoutes } from '../features/userSettings/userSettingsRoutes.js';

export const API_V1_PREFIX = '/v1';

const v1RouteModules: readonly Router[] = [
    healthRoutes,
    authRoutes,
    pushTokenRoutes,
    artistRoutes,
    releaseRoutes,
    userSettingsRoutes,
    notificationRoutes,
    taskRoutes,
];

export const createApiV1Routes = (): Router => {
    const router = express.Router();

    for (const routeModule of v1RouteModules) {
        router.use(routeModule);
    }

    return router;
};
