import express, { type Router } from 'express';
import { healthRoutes } from '../features/health/healthRoutes.js';
import { authRoutes } from '../features/auth/authRoutes.js';
import { pushTokenRoutes } from '../features/pushTokens/pushTokenRoutes.js';
import { createArtistRoutes } from '../features/artists/artistRoutes.js';
import { createReleaseRoutes } from '../features/releases/releaseRoutes.js';
import { userSettingsRoutes } from '../features/userSettings/userSettingsRoutes.js';
import { notificationRoutes } from '../features/notifications/notificationRoutes.js';
import { taskRoutes } from '../features/tasks/taskRoutes.js';
import { artistPresentersV2, artistUseCasesV2 } from './useCaseVariants.js';
import { releasePresentersV2, releaseUseCasesV2 } from './useCaseVariants.js';

export const API_V2_PREFIX = '/v2';

export const createApiV2Routes = (): Router => {
    const router = express.Router();

    router.use(healthRoutes);
    router.use(authRoutes);
    router.use(pushTokenRoutes);
    router.use(createArtistRoutes(artistUseCasesV2, artistPresentersV2));
    router.use(createReleaseRoutes(releaseUseCasesV2, releasePresentersV2));
    router.use(userSettingsRoutes);
    router.use(notificationRoutes);
    router.use(taskRoutes);

    return router;
};
