import { requestDeduper } from '../../../common/request/requestDeduper.js';
import { artistProfileImageTaskQueue } from '../../../infrastructure/taskQueues/profileImageTaskQueue.js';
import type { Release } from '../../../modules/models/models.js';
import {
    getArtistReleases as getArtistReleasesFromService,
    getRelease as getReleaseFromService,
    getReleaseGroupReleases as getReleaseGroupReleasesFromService,
} from '../../../services/musicbrainzService.js';
import {
    getNewReleasesSnapshotFromDb,
    removeReleaseFromAllUserDocuments,
} from '../../../services/firebaseService.js';
import {
    fetchMusicBrainzWithStatus,
    isConfirmedMissingFetchFailure,
} from '../../../services/musicApi.js';
import { sendDataOnlyNotification } from '../../../services/notificationService.js';
import { addTaskUser } from '../../../services/taskService.js';
import {
    queueArtistReleaseGroupCoversTask,
    queueNewReleaseCoversTask,
    queueReleaseGroupReleaseCoversTask,
    queueTrackLyricsTask,
} from '../../../services/backgroundTaskWorkers.js';
import { deleteNewReleases } from '../../../utils/helpers/cacheManagementHelpers.js';
import { getArtistTtl, invalidateFollowingArtistIdsCache } from '../../../utils/helpers/followingHelper.js';
import type { TrackLyricsRequest } from '../../../utils/types/taskTypes.js';
import type { ReleaseUseCaseDependencies } from '../ports.js';

const collectUniqueTrackArtistIds = (release: Release): string[] => {
    const ids = new Set<string>();

    for (const artistCredit of release['artist-credit'] ?? []) {
        if (artistCredit.id) {
            ids.add(artistCredit.id);
        }
    }

    for (const media of release.media ?? []) {
        for (const track of media.tracks ?? []) {
            for (const artistCredit of track['artist-credit'] ?? []) {
                if (artistCredit.id) {
                    ids.add(artistCredit.id);
                }
            }
        }
    }

    return Array.from(ids);
};

const collectTrackLyricsRequests = (release: Release): TrackLyricsRequest[] => {
    const requests: TrackLyricsRequest[] = [];

    for (const media of release.media ?? []) {
        if (!media.tracks || media.tracks.length === 0) {
            continue;
        }

        for (const track of media.tracks) {
            const artistName = track['artist-credit']?.[0]?.name ?? release['artist-credit']?.[0]?.name;

            if (!artistName?.trim() || !track.title?.trim()) {
                continue;
            }

            requests.push({
                releaseId: release.id,
                trackId: track.id,
                artistName,
                trackName: track.title,
            });
        }
    }

    return requests;
};

const getNewReleaseCoverDedupeKey = (entries: { releaseGroupId: string; releaseIds: string[] }[]): string => {
    const releaseIds = Array.from(new Set(
        entries.flatMap((entry) => entry.releaseIds.map((releaseId) => `${entry.releaseGroupId}:${releaseId}`)),
    )).sort((left, right) => left.localeCompare(right));

    return `new_release_covers:${releaseIds.join(',')}`;
};

export const releaseDependencies: ReleaseUseCaseDependencies = {
    artistReleaseContextGateway: {
        getArtistTtl: async (userId, artistId) => await getArtistTtl(userId, artistId),
    },
    missingReleaseCleanupRepository: {
        removeMissingRelease: async (releaseId) => {
            const result = await removeReleaseFromAllUserDocuments(releaseId);
            for (const affectedUserId of result.affectedUserIds) {
                invalidateFollowingArtistIdsCache(affectedUserId);
            }

            return result;
        },
    },
    newReleasesRepository: {
        getNewReleasesSnapshot: async (userId) => await getNewReleasesSnapshotFromDb(userId),
        deleteNewReleases,
    },
    releaseCatalogGateway: {
        getArtistReleases: async (artistId, ttl, onReleaseGroupPage) => {
            return await getArtistReleasesFromService(artistId, true, ttl, { onReleaseGroupPage });
        },
        getReleaseGroupReleases: async (releaseGroupId, ttl, onReleaseIdsPage) => {
            return await getReleaseGroupReleasesFromService(releaseGroupId, true, ttl, { onReleaseIdsPage });
        },
        getRelease: async (releaseId) => await getReleaseFromService(releaseId),
        releaseExists: async (releaseId) => {
            const result = await fetchMusicBrainzWithStatus(`/release/${releaseId}?fmt=json`, 'HEAD');

            if (result === true) {
                return true;
            }

            if (isConfirmedMissingFetchFailure(result)) {
                return false;
            }

            throw new Error(`Failed to verify release existence for ${releaseId}`);
        },
    },
    releaseNotifier: {
        notifyReleasesChanged: async (userId, sourcePushToken) => {
            await sendDataOnlyNotification(userId, 'releases', undefined, {
                excludePushToken: sourcePushToken,
            });
        },
    },
    releaseTaskQueue: {
        addTaskUser,
        queueArtistReleaseGroupCovers: (userId, artistId, pageEntries, ttl) => {
            return queueArtistReleaseGroupCoversTask(userId, artistId, pageEntries, ttl);
        },
        queueReleaseGroupReleaseCovers: (userId, releaseGroupId, pageEntries, ttl) => {
            return queueReleaseGroupReleaseCoversTask(userId, releaseGroupId, pageEntries, ttl);
        },
        queueNewReleaseCovers: (userId, pageEntries, ttl) => {
            const taskId = queueNewReleaseCoversTask(
                userId,
                getNewReleaseCoverDedupeKey(pageEntries),
                pageEntries,
                ttl,
            );
            addTaskUser(taskId, userId);
            return taskId;
        },
        queueReleaseTrackLyrics: (userId, release, ttl) => {
            const taskId = queueTrackLyricsTask(userId, release.id, collectTrackLyricsRequests(release), ttl);
            addTaskUser(taskId, userId);
            return taskId;
        },
        queueReleaseArtistProfileImages: (userId, release, ttl) => {
            return artistProfileImageTaskQueue.queueArtistProfileImages(
                userId,
                `release:${release.id}`,
                collectUniqueTrackArtistIds(release),
                ttl,
            );
        },
    },
    requestDeduper,
};
