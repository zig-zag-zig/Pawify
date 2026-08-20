import { mapToNewRelease } from '../../infrastructure/musicbrainz/musicbrainzMapper.js';
import {
    DEFAULT_RELEASE_NOTIFICATION_SETTINGS,
    NewRelease,
    Release,
    ReleaseNotificationSettings,
} from '../../modules/models/models.js';
import { sortReleasesByDate } from '../../modules/utils/dateUtil.js';
import { getReleaseCover } from '../../services/coverArtService.js';
import { saveArtistAndKnownReleasesToDb } from '../../services/firebase/artistStore.js';
import type { StoredNewRelease } from '../../services/firebase/types.js';
import {
    getCurrentReleases,
    analyzeReleaseChanges,
    removePrunedNewReleases,
} from './releaseProcessingHelpers.js';
import { updateArtistCacheIfExists } from './cacheUpdateHelpers.js';
import { artistCacheTtlHours } from './followingHelper.js';
import { mapWithConcurrency } from './promisePool.js';

type ProcessArtistResult = {
    newReleases: NewRelease[];
    deletedReleaseIds: string[];
};

const NEW_RELEASE_COVER_CACHE_CONCURRENCY = 10;

const createStoredNewReleases = (
    newReleases: NewRelease[],
    sourceReleases: Release[],
): StoredNewRelease[] => {
    const releaseGroupIdsByReleaseId = new Map(
        sourceReleases.map((release) => [release.id, release.releaseGroupId]),
    );

    return newReleases.map((release) => ({
        ...release,
        releaseGroupId: releaseGroupIdsByReleaseId.get(release.id) ?? null,
    }));
};

export const processArtistReleases = async (
    userId: string,
    artistId: string,
    getArtistReleases: (artistId: string) => Promise<Release[]>,
    currentReleasesByArtist?: { [artistId: string]: string[] },
    releaseNotificationSettings: ReleaseNotificationSettings = DEFAULT_RELEASE_NOTIFICATION_SETTINGS,
): Promise<ProcessArtistResult> => {
    const ttl = artistCacheTtlHours;
    const allReleasesFlat = await getArtistReleases(artistId);

    const currentReleases =
        currentReleasesByArtist?.[artistId] ?? (await getCurrentReleases(userId, artistId));
    const {
        deletedReleaseIds,
        duplicateReleaseIds,
        prunedReleaseIds,
        artistNewReleases,
        notificationCandidateReleases,
        releasesChanged,
    } = analyzeReleaseChanges(currentReleases, allReleasesFlat, releaseNotificationSettings);
    const eligibleNewReleases = artistNewReleases;
    const sortedEligibleNewReleases = [...eligibleNewReleases];
    sortReleasesByDate(sortedEligibleNewReleases);
    const mappedNewReleases = sortedEligibleNewReleases.map(mapToNewRelease);

    if (releasesChanged) {
        await handleReleaseChanges(
            userId,
            artistId,
            deletedReleaseIds,
            duplicateReleaseIds,
            notificationCandidateReleases,
            artistNewReleases,
            sortedEligibleNewReleases,
            mappedNewReleases,
            ttl,
        );
    }

    const anyPruned = await removePrunedNewReleases(userId, prunedReleaseIds);

    return {
        deletedReleaseIds: anyPruned ? deletedReleaseIds : [],
        newReleases: mappedNewReleases,
    };
};

const handleReleaseChanges = async (
    userId: string,
    artistId: string,
    deletedReleaseIds: string[],
    duplicateReleaseIds: string[],
    notificationCandidateReleases: Release[],
    artistNewReleases: Release[],
    eligibleNewReleases: Release[],
    mappedNewReleases: NewRelease[],
    ttl: number | undefined,
): Promise<void> => {
    const releaseIdsToSave = notificationCandidateReleases.map((release) => release.id);

    await saveArtistAndKnownReleasesToDb(
        userId,
        artistId,
        releaseIdsToSave,
        createStoredNewReleases(mappedNewReleases, eligibleNewReleases),
        undefined,
    );
    await cacheNewReleaseCovers(eligibleNewReleases, ttl);

    await updateArtistCacheIfExists(
        artistId,
        [...deletedReleaseIds, ...duplicateReleaseIds],
        artistNewReleases,
        ttl,
    );
};

const cacheNewReleaseCovers = async (
    releases: Release[],
    ttl: number | undefined,
): Promise<void> => {
    await mapWithConcurrency(releases, NEW_RELEASE_COVER_CACHE_CONCURRENCY, async (release) => {
        await getReleaseCover(release.id, release.releaseGroupId, ttl);
    });
};
