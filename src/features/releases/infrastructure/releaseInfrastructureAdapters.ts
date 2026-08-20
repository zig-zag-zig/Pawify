import { getNewReleasesSnapshotFromDb } from '../../../services/firebase/newReleasesStore.js';
import { removeReleaseFromAllUserDocuments } from '../../../services/firebase/missingReleaseCleanupStore.js';
import { sendDataOnlyNotification } from '../../../services/notifications/dataNotificationPublisher.js';
import { notificationEvents } from '../../../services/notifications/notificationEvents.js';
import { deleteNewReleases } from '../../../utils/helpers/cacheManagementHelpers.js';
import {
    getArtistTtl,
    invalidateFollowingArtistIdsCache,
} from '../../../utils/helpers/followingHelper.js';
import type {
    ArtistReleaseContextGateway,
    MissingReleaseCleanupRepository,
    NewReleasesRepository,
    ReleaseNotifier,
} from '../ports.js';

export const artistReleaseContextGateway: ArtistReleaseContextGateway = {
    getArtistTtl: async (userId, artistId) => await getArtistTtl(userId, artistId),
};

export const missingReleaseCleanupRepository: MissingReleaseCleanupRepository = {
    removeMissingRelease: async (releaseId) => {
        const result = await removeReleaseFromAllUserDocuments(releaseId);
        for (const affectedUserId of result.affectedUserIds) {
            invalidateFollowingArtistIdsCache(affectedUserId);
        }

        return result;
    },
};

export const newReleasesRepository: NewReleasesRepository = {
    getNewReleasesSnapshot: async (userId) => await getNewReleasesSnapshotFromDb(userId),
    deleteNewReleases,
};

export const releaseNotifier: ReleaseNotifier = {
    notifyReleasesChanged: async (userId, sourcePushToken) => {
        await sendDataOnlyNotification(userId, notificationEvents.releases, undefined, {
            excludePushToken: sourcePushToken,
        });
    },
};
