import { backgroundTaskWorkerConfig } from '../../../config/runtimeConfig.js';
import { createLogger } from '../../../common/logging/logger.js';
import { getExternalLinkUrlsByService } from '../../../utils/helpers/externalLinks.js';
import { getCacheKey } from '../../../utils/helpers/cacheHelpers.js';
import { mapWithConcurrency } from '../../../utils/helpers/promisePool.js';
import type { CachedArtistDetails, CachedArtistImage } from '../../../utils/types/cacheTypes.js';
import type {
    ArtistProfileImageLookup,
    ArtistProfileImageTaskResult,
} from '../../../utils/types/taskTypes.js';
import { getCachedData, replaceCachedData } from '../../cacheService.js';
import { getDiscogsData, getDiscogsUrls } from '../../musicApi/discogsClient.js';
import { fetchMusicBrainzWithStatus } from '../../musicApi/musicBrainzClient.js';
import { isConfirmedMissingFetchFailure, isFetchFailureResult } from '../../musicApi/types.js';
import {
    hasLegacyArtistImageFields,
    mapArtistImageToState,
    normalizeArtistImageState,
    shouldRefetchArtistImageState,
} from '../backgroundTaskMappers.js';
import { syncArtistDetailsDiscogsUrls } from './artistProfileImageCacheSync.js';

const logger = createLogger('services.backgroundTasks.artistImages');

const ARTIST_PROFILE_IMAGE_REQUEST_CONCURRENCY =
    backgroundTaskWorkerConfig.artistProfileImageRequestConcurrency;

export const fetchAndUpsertArtistProfileImages = async (
    _userId: string,
    artistLookups: ArtistProfileImageLookup[],
    ttl: number | undefined,
    signal?: AbortSignal,
): Promise<ArtistProfileImageTaskResult> => {
    const uniqueArtistLookups = Array.from(
        artistLookups
            .reduce((map, lookup) => {
                if (!lookup.artistId) {
                    return map;
                }

                const existing = map.get(lookup.artistId);
                map.set(lookup.artistId, {
                    artistId: lookup.artistId,
                    artistName: lookup.artistName ?? existing?.artistName,
                    discogsUrls: lookup.discogsUrls ?? existing?.discogsUrls,
                });
                return map;
            }, new Map<string, ArtistProfileImageLookup>())
            .values(),
    );
    const artists: { [artistId: string]: string | null | undefined } = {};
    const batchStartedAt = Date.now();
    let cacheHitCount = 0;
    let refetchCount = 0;
    let legacyRewriteCount = 0;
    let musicBrainzNotFoundCount = 0;
    let missingArtistNameCount = 0;
    let discogsImageFoundCount = 0;
    let discogsImageMissingCount = 0;
    let discogsImageTransientCount = 0;
    let lookupBypassMusicBrainzCount = 0;

    logger.debug('artist profile image batch started', {
        artistCount: uniqueArtistLookups.length,
        ttlHours: ttl ?? null,
    });

    await mapWithConcurrency(
        uniqueArtistLookups,
        ARTIST_PROFILE_IMAGE_REQUEST_CONCURRENCY,
        async (lookup) => {
            const artistStartedAt = Date.now();
            const artistId = lookup.artistId;
            const imageCacheKey = getCacheKey(artistId, 'artistImages');
            const providedArtistName =
                typeof lookup.artistName === 'string' && lookup.artistName.trim().length > 0
                    ? lookup.artistName.trim()
                    : undefined;
            const providedDiscogsUrls = Array.isArray(lookup.discogsUrls)
                ? lookup.discogsUrls.filter(
                      (url) => typeof url === 'string' && url.trim().length > 0,
                  )
                : undefined;
            let artistNameForLookup = providedArtistName;
            let discogsUrlsForLookup = providedDiscogsUrls;
            let cachedArtistDetailsForSync: CachedArtistDetails | null | undefined;
            let source:
                | 'cache'
                | 'lookup'
                | 'musicbrainz_not_found'
                | 'musicbrainz_transient'
                | 'artist_name_missing'
                | 'discogs'
                | 'error' = 'cache';
            let musicBrainzDurationMs: number | undefined;
            let discogsDurationMs: number | undefined;
            let usedLookupBypass = false;
            let usedMusicBrainzFetch = false;
            let cachedArtistDetailsHit = false;
            let lookupDiscogsResultState: 'present' | 'null' | 'undefined' | undefined;
            let lookupFallbackToMusicBrainz = false;
            let musicBrainzDiscogsUrlCount: number | undefined;
            let artistDetailsDiscogsSyncUpdated = false;

            try {
                const cachedImage = await getCachedData<CachedArtistImage>(imageCacheKey);

                if (cachedImage && !shouldRefetchArtistImageState(cachedImage)) {
                    cacheHitCount += 1;
                    const state = normalizeArtistImageState(cachedImage);
                    if (hasLegacyArtistImageFields(cachedImage)) {
                        legacyRewriteCount += 1;
                        await replaceCachedData(imageCacheKey, state, ttl);
                    }

                    artists[artistId] = state.url;
                    return;
                }

                refetchCount += 1;

                if (discogsUrlsForLookup === undefined) {
                    cachedArtistDetailsForSync = await getCachedData<CachedArtistDetails>(
                        getCacheKey(artistId, 'artistDetails'),
                    );
                    if (cachedArtistDetailsForSync?.artist) {
                        cachedArtistDetailsHit = true;
                        if (
                            !artistNameForLookup &&
                            typeof cachedArtistDetailsForSync.artist.name === 'string'
                        ) {
                            const cachedName = cachedArtistDetailsForSync.artist.name.trim();
                            if (cachedName.length > 0) {
                                artistNameForLookup = cachedName;
                            }
                        }

                        const legacyArtist =
                            cachedArtistDetailsForSync.artist as typeof cachedArtistDetailsForSync.artist & {
                                discogsUrls?: unknown;
                            };
                        discogsUrlsForLookup = [
                            ...getExternalLinkUrlsByService(
                                cachedArtistDetailsForSync.artist.externalLinks,
                                'discogs',
                            ),
                            ...(Array.isArray(legacyArtist.discogsUrls)
                                ? legacyArtist.discogsUrls.filter(
                                      (url): url is string =>
                                          typeof url === 'string' && url.trim().length > 0,
                                  )
                                : []),
                        ];
                    }
                }

                if (
                    artistNameForLookup &&
                    Array.isArray(discogsUrlsForLookup) &&
                    discogsUrlsForLookup.length > 0
                ) {
                    usedLookupBypass = true;
                    lookupBypassMusicBrainzCount += 1;
                    const discogsStartedAt = Date.now();
                    const discogsResult = await getDiscogsData(
                        artistNameForLookup,
                        discogsUrlsForLookup,
                        signal,
                    );
                    discogsDurationMs = Date.now() - discogsStartedAt;
                    lookupDiscogsResultState =
                        discogsResult.image === undefined
                            ? 'undefined'
                            : discogsResult.image === null
                              ? 'null'
                              : 'present';

                    if (
                        typeof discogsResult.image === 'string' &&
                        discogsResult.image.trim().length > 0
                    ) {
                        source = 'lookup';
                        discogsImageFoundCount += 1;
                        const state = mapArtistImageToState(discogsResult.image);
                        await replaceCachedData(imageCacheKey, state, ttl);
                        artists[artistId] = state.url;
                        return;
                    } else if (discogsResult.image === null) {
                        lookupFallbackToMusicBrainz = true;
                    } else {
                        lookupFallbackToMusicBrainz = true;
                    }
                }

                const musicBrainzStartedAt = Date.now();
                usedMusicBrainzFetch = true;
                const artistData = await fetchMusicBrainzWithStatus(
                    `/artist/${artistId}?fmt=json&inc=url-rels`,
                    'GET',
                    signal,
                    'background',
                );
                musicBrainzDurationMs = Date.now() - musicBrainzStartedAt;

                if (isFetchFailureResult(artistData)) {
                    if (isConfirmedMissingFetchFailure(artistData)) {
                        source = 'musicbrainz_not_found';
                        musicBrainzNotFoundCount += 1;
                        const state = mapArtistImageToState(null);
                        await replaceCachedData(imageCacheKey, state, ttl);
                        artists[artistId] = state.url;
                        return;
                    }

                    source = 'musicbrainz_transient';
                    const state = mapArtistImageToState(undefined);
                    await replaceCachedData(imageCacheKey, state, ttl);
                    artists[artistId] = state.url;
                    return;
                }

                if (artistData === null || artistData === undefined) {
                    source =
                        artistData === null ? 'musicbrainz_not_found' : 'musicbrainz_transient';
                    if (artistData === null) {
                        musicBrainzNotFoundCount += 1;
                    }
                    const state = mapArtistImageToState(artistData === null ? null : undefined);
                    await replaceCachedData(imageCacheKey, state, ttl);
                    artists[artistId] = state.url;
                    return;
                }

                const artistRecord = artistData as { name?: unknown; relations?: any[] };
                const artistName =
                    typeof artistRecord.name === 'string' ? artistRecord.name : undefined;
                const discogsUrls = getDiscogsUrls(artistRecord.relations);
                musicBrainzDiscogsUrlCount = discogsUrls.length;
                artistDetailsDiscogsSyncUpdated = await syncArtistDetailsDiscogsUrls(
                    artistId,
                    discogsUrls,
                    cachedArtistDetailsForSync,
                    ttl,
                );
                if (!artistName?.trim()) {
                    source = 'artist_name_missing';
                    missingArtistNameCount += 1;
                    const state = mapArtistImageToState(null);
                    await replaceCachedData(imageCacheKey, state, ttl);
                    artists[artistId] = state.url;
                    return;
                }

                source = 'discogs';
                const discogsStartedAt = Date.now();
                const discogsResult = await getDiscogsData(artistName, discogsUrls, signal);
                discogsDurationMs = Date.now() - discogsStartedAt;
                const state = mapArtistImageToState(discogsResult.image);
                await replaceCachedData(imageCacheKey, state, ttl);
                artists[artistId] = state.url;

                if (
                    typeof discogsResult.image === 'string' &&
                    discogsResult.image.trim().length > 0
                ) {
                    discogsImageFoundCount += 1;
                } else if (discogsResult.image === null) {
                    discogsImageMissingCount += 1;
                } else {
                    discogsImageTransientCount += 1;
                }
            } catch (error) {
                source = 'error';
                throw error;
            } finally {
                if (artists[artistId] === null) {
                    logger.debug('artist profile image resolved to null', {
                        artistId,
                        source,
                        providedArtistName: providedArtistName !== undefined,
                        providedDiscogsUrlCount: providedDiscogsUrls?.length ?? 0,
                        cachedArtistDetailsHit,
                        lookupDiscogsUrlCount: discogsUrlsForLookup?.length ?? 0,
                        usedLookupBypass,
                        lookupDiscogsResultState,
                        lookupFallbackToMusicBrainz,
                        usedMusicBrainzFetch,
                        musicBrainzDiscogsUrlCount: musicBrainzDiscogsUrlCount ?? 0,
                        artistDetailsDiscogsSyncUpdated,
                        musicBrainzDurationMs,
                        discogsDurationMs,
                        durationMs: Date.now() - artistStartedAt,
                    });
                }
            }
        },
    );

    logger.debug('artist profile image batch completed', {
        artistCount: uniqueArtistLookups.length,
        cacheHitCount,
        refetchCount,
        legacyRewriteCount,
        musicBrainzNotFoundCount,
        missingArtistNameCount,
        discogsImageFoundCount,
        discogsImageMissingCount,
        discogsImageTransientCount,
        lookupBypassMusicBrainzCount,
        durationMs: Date.now() - batchStartedAt,
    });

    return { artists };
};
