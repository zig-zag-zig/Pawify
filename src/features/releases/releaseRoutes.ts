import express from 'express';
import {
    getArtistReleasesHandler,
    getNewReleasesHandler,
    getReleaseGroupReleasesHandler,
    getReleaseHandler,
    removeNewReleasesHandler,
    verifyReleaseExistenceHandler,
} from './handlers/releaseHandlers.js';

export const releaseRoutes = express.Router();

releaseRoutes.get('/getNewReleases', getNewReleasesHandler);
releaseRoutes.post('/removeNewReleases', removeNewReleasesHandler);
releaseRoutes.post('/getArtistReleases', getArtistReleasesHandler);
releaseRoutes.post('/getReleaseGroupReleases', getReleaseGroupReleasesHandler);
releaseRoutes.post('/getRelease', getReleaseHandler);
releaseRoutes.post('/verifyReleaseExistence', verifyReleaseExistenceHandler);
