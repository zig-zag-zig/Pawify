import { requestDeduper } from '../../../common/request/requestDeduper.js';
import { createLogger } from '../../../common/logging/logger.js';
import { artistProfileImageTaskQueue } from '../../../infrastructure/taskQueues/profileImageTaskQueue.js';
import {
    getFollowingFromDb,
    getFollowingStateFromDb,
    saveFollowingArtistSummariesToDb,
} from '../../../services/firebase/followingStore.js';
import { saveArtistAndKnownReleasesToDb } from '../../../services/firebase/artistStore.js';
import {
    getArtistDetails as getArtistDetailsFromService,
    getFollowedArtistSummary as getFollowedArtistSummaryFromService,
} from '../../../services/artistDetailsService.js';
import { getArtistKnownReleaseIds } from '../../../services/musicbrainz/cachedReleaseCatalog.js';
import { sendDataOnlyNotification } from '../../../services/notifications/dataNotificationPublisher.js';
import { notificationEvents } from '../../../services/notifications/notificationEvents.js';
import { deleteArtist } from '../../../utils/helpers/cacheManagementHelpers.js';
import {
    getArtistTtl,
    invalidateFollowingArtistIdsCache,
    syncFollowingArtistIds,
} from '../../../utils/helpers/followingHelper.js';
import { searchForArtist } from '../../../utils/helpers/artistSearchHelpers.js';
import type { ArtistUseCaseDependencies } from '../ports.js';

const logger = createLogger('features.artists.dependencies');

export const artistDependencies: Omit<ArtistUseCaseDependencies, 'assetPlanner'> = {
    artistDetailsGateway: {
        getArtistDetails: async (userId, artistId, options) => {
            const artist = await getArtistDetailsFromService(userId, artistId, options);

            if (artist === null) {
                await deleteArtist(userId, artistId);
            }

            return artist;
        },
        getFollowedArtistSummary: async (userId, artistId, options) => {
            const summary = await getFollowedArtistSummaryFromService(userId, artistId, options);

            if (summary === null) {
                await deleteArtist(userId, artistId);
            }

            return summary;
        },
    },
    artistFollowingRepository: {
        getFollowingArtistIds: async (userId) => {
            const artistIds = await getFollowingFromDb(userId);
            await syncFollowingArtistIds(userId, artistIds);
            return artistIds;
        },
        getFollowingState: async (userId) => {
            const state = await getFollowingStateFromDb(userId);
            await syncFollowingArtistIds(userId, state.artistIds);
            return state;
        },
        saveFollowedArtist: async (userId, artistId, releaseIds, artistSummary) => {
            await saveArtistAndKnownReleasesToDb(userId, artistId, releaseIds, [], artistSummary);
            invalidateFollowingArtistIdsCache(userId);
            try {
                await syncFollowingArtistIds(userId, await getFollowingFromDb(userId));
            } catch (error) {
                logger.warn('failed to refresh followed artist cache membership', { artistId, error });
            }
        },
        saveFollowingArtistSummaries: async (userId, artistSummaries) => {
            await saveFollowingArtistSummariesToDb(userId, artistSummaries);
        },
        deleteFollowedArtist: async (userId, artistId) => {
            await deleteArtist(userId, artistId);
        },
    },
    artistReleaseCatalogGateway: {
        getArtistReleaseIds: async (artistId, ttl) => await getArtistKnownReleaseIds(artistId, ttl),
    },
    artistProfileImageQueue: artistProfileImageTaskQueue,
    artistSearchGateway: {
        searchArtists: async (userId, query, offset, limit) => await searchForArtist(userId, query, offset, limit),
    },
    cacheTtlGateway: {
        getArtistTtl: async (userId, artistId) => await getArtistTtl(userId, artistId),
    },
    followingNotifier: {
        notifyFollowingChanged: async (userId, sourcePushToken) => {
            await sendDataOnlyNotification(userId, notificationEvents.following, undefined, {
                excludePushToken: sourcePushToken,
            });
        },
    },
    requestDeduper,
};
