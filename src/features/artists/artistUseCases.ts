import { createLogger } from '../../common/logging/logger.js';
import { withOperationLogging } from '../../common/logging/operationLogger.js';
import { artistDependencies } from './infrastructure/artistDependencies.js';
import { createFollowArtistUseCase } from './usecases/followArtist.js';
import { createGetArtistDetailsUseCase } from './usecases/getArtistDetails.js';
import { createGetFollowingUseCase } from './usecases/getFollowing.js';
import { createSearchArtistsUseCase } from './usecases/searchArtists.js';
import { createUnfollowArtistsUseCase } from './usecases/unfollowArtists.js';

const logger = createLogger('features.artists');

export const artistUseCases = {
    followArtist: withOperationLogging(logger, 'followArtist', createFollowArtistUseCase(artistDependencies), {
        successLevel: 'info',
        getMetadata: (_userId, artistId, _sourcePushToken) => ({ artistId }),
    }),
    getArtistDetails: withOperationLogging(logger, 'getArtistDetails', createGetArtistDetailsUseCase(artistDependencies), {
        getMetadata: (_userId, artistId) => ({ artistId }),
        getResultMetadata: (result) => ({
            found: result !== null,
            profileImageTaskId: result?.profileImageTaskId,
        }),
    }),
    getFollowing: withOperationLogging(logger, 'getFollowing', createGetFollowingUseCase(artistDependencies), {
        getResultMetadata: (result) => ({
            artistCount: result.artists.length,
            profileImageTaskId: result.profileImageTaskId,
        }),
    }),
    searchArtists: withOperationLogging(logger, 'searchArtists', createSearchArtistsUseCase(artistDependencies), {
        getMetadata: (_userId, query, offset, limit) => ({ query, offset, limit }),
        getResultMetadata: (result) => ({ resultCount: result.artists.length }),
    }),
    unfollowArtists: withOperationLogging(logger, 'unfollowArtists', createUnfollowArtistsUseCase(artistDependencies), {
        successLevel: 'info',
        getMetadata: (_userId, artistIds, _sourcePushToken) => ({ artistCount: artistIds.length }),
    }),
};
