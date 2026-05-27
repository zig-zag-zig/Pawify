import { createLogger } from '../../common/logging/logger.js';
import { withOperationLogging } from '../../common/logging/operationLogger.js';
import { releaseDependencies } from './infrastructure/releaseDependencies.js';
import { createGetArtistReleasesUseCase } from './usecases/getArtistReleases.js';
import { createGetNewReleasesUseCase } from './usecases/getNewReleases.js';
import { createGetReleaseUseCase } from './usecases/getRelease.js';
import { createGetReleaseGroupReleasesUseCase } from './usecases/getReleaseGroupReleases.js';
import { createRemoveNewReleasesUseCase } from './usecases/removeNewReleases.js';
import { createVerifyReleaseExistenceUseCase } from './usecases/verifyReleaseExistence.js';

const logger = createLogger('features.releases');

export const releaseUseCases = {
    getArtistReleases: withOperationLogging(logger, 'getArtistReleases', createGetArtistReleasesUseCase(releaseDependencies), {
        getMetadata: (_userId, artistId) => ({ artistId }),
        getResultMetadata: (result) => ({
            releaseGroupCount: result.releaseGroups.length,
            releaseGroupCoverTaskId: result.releaseGroupCoverTaskId,
        }),
    }),
    getNewReleases: withOperationLogging(logger, 'getNewReleases', createGetNewReleasesUseCase(releaseDependencies), {
        getResultMetadata: (result) => ({
            releaseCount: result.releases.length,
            releaseCoverTaskId: result.releaseCoverTaskId,
        }),
    }),
    getRelease: withOperationLogging(logger, 'getRelease', createGetReleaseUseCase(releaseDependencies), {
        getMetadata: (_userId, releaseId) => ({ releaseId }),
        getResultMetadata: (result) => ({
            found: result !== null,
            lyricsTaskId: result?.lyricsTaskId,
            profileImageTaskId: result?.profileImageTaskId,
        }),
    }),
    getReleaseGroupReleases: withOperationLogging(logger, 'getReleaseGroupReleases', createGetReleaseGroupReleasesUseCase(releaseDependencies), {
        getMetadata: (_userId, releaseGroupId) => ({ releaseGroupId }),
        getResultMetadata: (result) => ({
            releaseCount: result.releases.length,
            releaseCoverTaskId: result.releaseCoverTaskId,
        }),
    }),
    removeNewReleases: withOperationLogging(logger, 'removeNewReleases', createRemoveNewReleasesUseCase(releaseDependencies), {
        successLevel: 'info',
        getMetadata: (_userId, releaseIds, _sourcePushToken) => ({ releaseCount: releaseIds.length }),
    }),
    verifyReleaseExistence: withOperationLogging(logger, 'verifyReleaseExistence', createVerifyReleaseExistenceUseCase(releaseDependencies), {
        successLevel: 'info',
        getMetadata: (_userId, releaseId) => ({ releaseId }),
        getResultMetadata: (result) => ({ exists: result.exists }),
    }),
};
