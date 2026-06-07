import { artistProfileImageTaskQueue } from '../../../infrastructure/taskQueues/profileImageTaskQueue.js';
import {
    queueArtistReleaseGroupCoversTask,
    queueNewReleaseCoversTask,
    queueReleaseGroupReleaseCoversTask,
    queueTrackLyricsTask,
} from '../../../services/backgroundTaskWorkers.js';
import { addTaskUser } from '../../../services/taskService.js';
import {
    collectReleaseArtistIds,
    collectTrackLyricsRequests,
    getNewReleaseCoverDedupeKey,
} from '../domain/releaseTaskPayloads.js';
import type { ReleaseTaskQueue } from '../ports.js';

export const releaseTaskQueue: ReleaseTaskQueue = {
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
            collectReleaseArtistIds(release),
            ttl,
        );
    },
};
