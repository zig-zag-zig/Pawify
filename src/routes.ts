import type { Express } from 'express';
import { API_V1_PREFIX, createApiV1Routes } from './api/v1Routes.js';

export const registerRoutes = (app: Express): void => {
    app.use(API_V1_PREFIX, createApiV1Routes());

    // Compatibility alias for clients still using the original unversioned paths.
    app.use(createApiV1Routes());
};
