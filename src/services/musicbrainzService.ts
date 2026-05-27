import { mapToRelease } from '../infrastructure/musicbrainz/musicbrainzMapper.js';
import { NewRelease, Release, ReleaseGroupReleaseListItem, ReleaseNotificationSettings } from '../modules/models/models.js';
import { replaceCachedData, getCachedData } from './cacheService.js';
import type {
    CachedArtistReleases,
    CachedReleaseGroupReleaseCovers,
    CachedReleaseGroupReleases,
} from '../utils/types/cacheTypes.js';
import {
    getFollowingFromDb,
    getKnownReleasesFromDb,
    getReleaseNotificationSettingsFromDb,
    mergeKnownArtistReleaseIdsInDb,
} from './firebaseService.js';
import { getReleaseCover } from './coverArtService.js';
import { fetchMusicBrainz } from './musicApi.js';
import {
    groupByReleaseGroup,
    mapReleaseGroupsToArtistReleases,
    normalizeReleaseGroups,
} from '../utils/helpers/releaseGroupingHelpers.js';
import {
    getCacheKey,
} from '../utils/helpers/cacheHelpers.js';
import { processArtistReleases } from '../utils/helpers/newReleaseHelpers.js';
import { mapWithConcurrency } from '../utils/helpers/promisePool.js';
import {
    createCachedArtistReleaseGroups,
    createCachedReleaseGroupReleases,
} from '../utils/helpers/artistReleaseCacheHelpers.js';
import {
    dedupeAndSortReleaseGroupReleases,
    fetchAllReleaseIdsForArtist,
    fetchAllReleasesForArtist,
    fetchAllReleasesForReleaseGroup,
    getPrimaryArtistId,
    mapReleaseGroupReleasesList,
    processAndGroupReleases,
} from './musicbrainz/releaseQueries.js';

type GetArtistReleasesOptions = {
    onReleaseGroupPage?: (releaseGroupEntries: { releaseGroupId: string; releaseIds: string[] }[], isLastPage: boolean) => Promise<void> | void;
};

type GetReleaseGroupReleasesOptions = {
    onReleaseIdsPage?: (releaseGroupId: string, releaseIds: string[], isLastPage: boolean) => Promise<void> | void;
};

export const getArtistReleases = async (
    artistId: string,
    useCache: boolean,
    ttl: number | undefined,
    options?: GetArtistReleasesOptions,
): Promise<CachedArtistReleases> => {
    const cacheKey = getCacheKey(artistId, 'artistReleases');
    const cached = await getCachedData<CachedArtistReleases>(cacheKey);

    if (useCache && cached) {
        await options?.onReleaseGroupPage?.(
            cached.map(group => ({ releaseGroupId: group.id, releaseIds: group.releaseIds })),
            true,
        );
        return cached;
    }

    return await fetchAndCacheArtistReleases(artistId, cacheKey, cached, ttl, options);
};

const fetchAndCacheArtistReleases = async (
    artistId: string,
    cacheKey: string,
    cached: CachedArtistReleases | null,
    ttl: number | undefined,
    options?: GetArtistReleasesOptions,
): Promise<CachedArtistReleases> => {
    try {
        return await fetchAndCacheUncachedArtistReleases(artistId, cached, cacheKey, ttl, options);
    } catch (error) {
        throw new Error(`Failed to fetch releases: ${error}`);
    }
};

const fetchAndCacheUncachedArtistReleases = async (
    artistId: string,
    cached: CachedArtistReleases | null,
    cacheKey: string,
    ttl: number | undefined,
    options?: GetArtistReleasesOptions,
): Promise<CachedArtistReleases> => {
    const allReleases = await fetchAllReleasesForArtist(artistId, false, async (pageReleases, isLastPage) => {
        const grouped = groupByReleaseGroup(pageReleases);
        const pageEntries = Array.from(grouped.entries()).map(([releaseGroupId, releases]) => ({
            releaseGroupId,
            releaseIds: releases.map(release => release.id),
        }));

        await options?.onReleaseGroupPage?.(pageEntries, isLastPage);
    });

    const releaseGroupsMap = processAndGroupReleases(allReleases);
    normalizeReleaseGroups(releaseGroupsMap);

    const artistReleaseGroups = mapReleaseGroupsToArtistReleases(releaseGroupsMap);
    const cachedGroups = createCachedArtistReleaseGroups(artistReleaseGroups, cached);

    await cacheReleaseGroupReleasesByGroup(releaseGroupsMap, ttl);
    await replaceCachedData(cacheKey, cachedGroups, ttl);

    return cachedGroups;
};

const cacheReleaseGroupReleasesByGroup = async (
    releaseGroupsMap: Map<string, Release[]>,
    ttl: number | undefined,
): Promise<void> => {
    await mapWithConcurrency(Array.from(releaseGroupsMap.entries()), 10, async ([groupId, releases]) => {
        const cacheKey = getCacheKey(groupId, 'releaseGroupReleases');
        const cached = await getCachedData<CachedReleaseGroupReleases>(cacheKey);
        const cachedReleases = createCachedReleaseGroupReleases(releases, cached);
        await replaceCachedData(cacheKey, cachedReleases, ttl);
    });
};

export const getReleaseGroupReleases = async (
    releaseGroupId: string,
    useCache: boolean,
    ttl: number | undefined,
    options?: GetReleaseGroupReleasesOptions,
): Promise<ReleaseGroupReleaseListItem[]> => {
    const cacheKey = getCacheKey(releaseGroupId, 'releaseGroupReleases');
    const cached = await getCachedData<CachedReleaseGroupReleases>(cacheKey);

    if (useCache && cached && canUseCachedReleaseGroupReleases(cached)) {
        const normalizedCached = await normalizeCachedReleaseGroupReleases(releaseGroupId, cacheKey, cached, ttl);
        await options?.onReleaseIdsPage?.(releaseGroupId, normalizedCached.map(release => release.id), true);
        return mapReleaseGroupReleasesList(normalizedCached);
    }

    const releases = await fetchAndCacheReleaseGroupReleases(releaseGroupId, cacheKey, ttl, options);
    return mapReleaseGroupReleasesList(releases);
};

export const getArtistKnownReleaseIds = async (
    artistId: string,
    _ttl: number | undefined,
): Promise<string[]> => {
    const cachedArtistReleases = await getCachedArtistReleaseGroups(artistId);

    if (cachedArtistReleases) {
        return getArtistReleaseIds(cachedArtistReleases);
    }

    return await fetchAllReleaseIdsForArtist(artistId);
};

const getCachedArtistReleaseGroups = async (artistId: string): Promise<CachedArtistReleases | null> => (
    await getCachedData<CachedArtistReleases>(getCacheKey(artistId, 'artistReleases'))
);

const getArtistReleaseIds = (artistReleases: CachedArtistReleases): string[] => (
    Array.from(new Set(artistReleases.flatMap(group => group.releaseIds)))
);

const canUseCachedReleaseGroupReleases = (releases: CachedReleaseGroupReleases): boolean => {
    if (releases.length <= 1) {
        return true;
    }

    return releases.some(release => release.media.some(media => (media.tracks?.length ?? 0) > 0));
};

const fetchAndCacheReleaseGroupReleases = async (
    releaseGroupId: string,
    cacheKey: string,
    ttl: number | undefined,
    options?: GetReleaseGroupReleasesOptions,
): Promise<Release[]> => {
    const allReleases = await fetchAllReleasesForReleaseGroup(releaseGroupId);
    const { releases, prunedReleaseIds } = dedupeAndSortReleaseGroupReleases(releaseGroupId, allReleases);

    const cachedReleases = createCachedReleaseGroupReleases(releases, null);
    await replaceCachedData(cacheKey, cachedReleases, ttl);
    await pruneDuplicateReleaseIdsFromCaches(releaseGroupId, prunedReleaseIds, allReleases, cachedReleases, ttl);
    await options?.onReleaseIdsPage?.(releaseGroupId, cachedReleases.map(release => release.id), true);

    return cachedReleases;
};

const normalizeCachedReleaseGroupReleases = async (
    releaseGroupId: string,
    cacheKey: string,
    cached: CachedReleaseGroupReleases,
    ttl: number | undefined,
): Promise<CachedReleaseGroupReleases> => {
    const { releases, prunedReleaseIds } = dedupeAndSortReleaseGroupReleases(releaseGroupId, cached);

    if (prunedReleaseIds.length === 0) {
        return cached;
    }

    const cachedReleases = createCachedReleaseGroupReleases(releases, cached);
    await replaceCachedData(cacheKey, cachedReleases, ttl);
    await pruneDuplicateReleaseIdsFromCaches(releaseGroupId, prunedReleaseIds, cached, cachedReleases, ttl);

    return cachedReleases;
};

const pruneDuplicateReleaseIdsFromCaches = async (
    releaseGroupId: string,
    prunedReleaseIds: string[],
    releases: Release[],
    dedupedReleases: Release[],
    ttl: number | undefined,
): Promise<void> => {
    if (prunedReleaseIds.length === 0) {
        return;
    }

    await Promise.all([
        pruneArtistReleaseGroupCaches(releaseGroupId, prunedReleaseIds, releases, dedupedReleases, ttl),
        pruneReleaseGroupReleaseCoverCache(releaseGroupId, prunedReleaseIds, ttl),
    ]);
};

const pruneArtistReleaseGroupCaches = async (
    releaseGroupId: string,
    prunedReleaseIds: string[],
    releases: Release[],
    dedupedReleases: Release[],
    ttl: number | undefined,
): Promise<void> => {
    const artistIds = getReleaseArtistIds(releases);
    const prunedReleaseIdSet = new Set(prunedReleaseIds);

    await mapWithConcurrency(artistIds, 10, async (artistId) => {
        const cacheKey = getCacheKey(artistId, 'artistReleases');
        const cached = await getCachedData<CachedArtistReleases>(cacheKey);

        if (!cached) {
            return;
        }

        let changed = false;
        const nextCache = cached.flatMap(releaseGroup => {
            if (releaseGroup.id !== releaseGroupId) {
                return [releaseGroup];
            }

            const prunedReleaseIdsForGroup = releaseGroup.releaseIds.filter(releaseId => !prunedReleaseIdSet.has(releaseId));
            const releaseIds = prunedReleaseIdsForGroup.length > 0
                ? prunedReleaseIdsForGroup
                : getReleaseIdsForArtist(dedupedReleases, artistId);

            if (releaseIds.length !== releaseGroup.releaseIds.length ||
                releaseIds.some((releaseId, index) => releaseId !== releaseGroup.releaseIds[index])) {
                changed = true;
            }

            return releaseIds.length > 0 ? [{ ...releaseGroup, releaseIds }] : [];
        });

        if (changed) {
            await replaceCachedData(cacheKey, nextCache, ttl);
        }
    });
};

const getReleaseIdsForArtist = (releases: Release[], artistId: string): string[] => {
    return releases
        .filter(release => releaseBelongsToArtist(release, artistId))
        .map(release => release.id);
};

const releaseBelongsToArtist = (release: Release, artistId: string): boolean => {
    return release.artistId === artistId ||
        (release['artist-credit'] ?? []).some(artist => artist.id === artistId);
};

const pruneReleaseGroupReleaseCoverCache = async (
    releaseGroupId: string,
    prunedReleaseIds: string[],
    ttl: number | undefined,
): Promise<void> => {
    const cacheKey = getCacheKey(releaseGroupId, 'releaseGroupReleaseCovers');
    const cached = await getCachedData<CachedReleaseGroupReleaseCovers>(cacheKey);

    if (!cached) {
        return;
    }

    let changed = false;
    for (const releaseId of prunedReleaseIds) {
        if (cached[releaseId]) {
            delete cached[releaseId];
            changed = true;
        }
    }

    if (changed) {
        await replaceCachedData(cacheKey, cached, ttl);
    }
};

const getReleaseArtistIds = (releases: Release[]): string[] => {
    const artistIds = new Set<string>();

    for (const release of releases) {
        if (release.artistId) {
            artistIds.add(release.artistId);
        }

        for (const artist of release['artist-credit'] ?? []) {
            if (artist.id) {
                artistIds.add(artist.id);
            }
        }
    }

    return Array.from(artistIds);
};

export const getRelease = async (
    releaseId: string,
): Promise<Release | null> => {
    try {
        const musicbrainzResult = await fetchMusicBrainz(`/release/${releaseId}?fmt=json&inc=recordings+release-groups+artist-credits+url-rels`);

        if (musicbrainzResult === null) {
            return null;
        }

        const release = mapToRelease(musicbrainzResult, getPrimaryArtistId(musicbrainzResult));
        const cover = await getReleaseCover(release.id, release.releaseGroupId, undefined);
        release.cover_url = cover.state.url;

        return release;
    } catch (error) {
        throw new Error(`Failed to fetch release: ${error}`);
    }
};

type ArtistProcessResult = {
    deletedReleaseIds: string[];
    newReleases: NewRelease[];
};

const getArtistReleasesForProcessing = async (
    artistId: string,
    _useCache: boolean,
    _ttl: number | undefined,
): Promise<Release[]> => {
    return await fetchAllReleasesForArtist(artistId, true);
};

const processSingleArtist = async (
    userId: string,
    artistId: string,
    currentReleasesByArtist: { [artistId: string]: string[] },
    releaseNotificationSettings: ReleaseNotificationSettings,
): Promise<ArtistProcessResult> => {
    return await processArtistReleases(
        userId,
        artistId,
        getArtistReleasesForProcessing,
        currentReleasesByArtist,
        releaseNotificationSettings,
    );
};

const mergeKnownReleasesForFollowedReleaseArtists = async (
    userId: string,
    followedArtistIds: string[],
    newReleases: NewRelease[],
): Promise<void> => {
    const followedArtistIdSet = new Set(followedArtistIds);
    const releaseIdsByFollowedArtist = new Map<string, Set<string>>();

    for (const release of newReleases) {
        for (const artistId of Object.keys(release.artists)) {
            if (!followedArtistIdSet.has(artistId)) {
                continue;
            }

            const releaseIds = releaseIdsByFollowedArtist.get(artistId) ?? new Set<string>();
            releaseIds.add(release.id);
            releaseIdsByFollowedArtist.set(artistId, releaseIds);
        }
    }

    await mapWithConcurrency(
        Array.from(releaseIdsByFollowedArtist.entries()),
        4,
        async ([artistId, releaseIds]) => {
            await mergeKnownArtistReleaseIdsInDb(userId, artistId, Array.from(releaseIds));
        },
    );
};

export const getNewReleases = async (userId: string): Promise<NewRelease[]> => {
    try {
        const followingArtists = await getFollowingFromDb(userId);
        const releaseNotificationSettings = await getReleaseNotificationSettingsFromDb(userId);
        const currentReleasesByArtist = await getKnownReleasesFromDb(userId);
        for (const artistId of followingArtists) {
            currentReleasesByArtist[artistId] ??= [];
        }
        const result: NewRelease[] = [];

        const artistResults = await mapWithConcurrency(
            followingArtists,
            4,
            async (artistId) => await processSingleArtist(
                userId,
                artistId,
                currentReleasesByArtist,
                releaseNotificationSettings,
            ),
        );

        for (const { newReleases } of artistResults) {
            if (newReleases.length > 0) {
                result.push(...newReleases);
            }
        }

        if (result.length > 0) {
            await mergeKnownReleasesForFollowedReleaseArtists(userId, followingArtists, result);
        }

        return result;
    } catch (error) {
        throw new Error(`Failed to fetch new releases: ${error}`);
    }
};
