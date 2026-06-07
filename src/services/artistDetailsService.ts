import { getArtistMetadataCacheTtlHours } from '../features/artists/artistMetadataRefresh.js';
import { mapToArtist } from '../infrastructure/musicbrainz/musicbrainzMapper.js';
import { mapArtistToFollowedArtistSummary } from '../features/artists/followedArtistSummary.js';
import { Artist } from '../modules/models/models.js';
import {
    getExternalLinkUrlsByService,
    mapRelationsToExternalLinks,
} from '../utils/helpers/externalLinks.js';
import { replaceCachedData, getCachedData } from './cacheService.js';
import type { CachedArtistDetails } from '../utils/types/cacheTypes.js';
import {
    fetchMusicBrainzWithStatus,
} from './musicApi/musicBrainzClient.js';
import {
    isConfirmedMissingFetchFailure,
    isFetchFailureResult,
} from './musicApi/types.js';
import { getArtistTtl } from '../utils/helpers/followingHelper.js';
import { getCacheKey } from '../utils/helpers/cacheHelpers.js';
import type { FollowedArtistSummary } from '../utils/types/followedArtistTypes.js';

type GetArtistDetailsOptions = {
    cacheTtlOverride?: number;
    skipTtlLookup?: boolean;
};

const getArtistDiscogsUrls = (artist: Artist): string[] => {
    const discogsUrls = getExternalLinkUrlsByService(artist.externalLinks, 'discogs');
    if (discogsUrls.length > 0) {
        return discogsUrls;
    }

    const legacyArtist = artist as Artist & { discogsUrls?: unknown };
    return Array.isArray(legacyArtist.discogsUrls)
        ? legacyArtist.discogsUrls.filter((url): url is string => typeof url === 'string' && url.trim().length > 0)
        : [];
};

const hasExternalLinks = (artist: Artist): boolean => (
    Array.isArray((artist as Artist & { externalLinks?: unknown }).externalLinks)
);

const fetchArtistData = async (
    artistId: string,
    include: string,
): Promise<unknown | null> => {
    const artistData = await fetchMusicBrainzWithStatus(`/artist/${artistId}?fmt=json&inc=${include}`);

    if (isFetchFailureResult(artistData)) {
        if (isConfirmedMissingFetchFailure(artistData)) {
            return null;
        }

        throw new Error(`MusicBrainz artist lookup failed for ${artistId}`);
    }

    return artistData;
};

export const getArtistDetails = async (
    userId: string,
    artistId: string,
    options?: GetArtistDetailsOptions,
): Promise<Artist | null> => {
    const result = await getArtistDetailsRecord(userId, artistId, options);
    return result?.artist ?? null;
};

export const getFollowedArtistSummary = async (
    _userId: string,
    artistId: string,
    _options?: GetArtistDetailsOptions,
): Promise<FollowedArtistSummary | null> => {
    const mapSummaryWithDiscogsUrls = (
        summary: FollowedArtistSummary,
        discogsUrls: unknown,
    ): FollowedArtistSummary => {
        const summaryWithLookups = summary as FollowedArtistSummary & {
            discogsUrls?: string[];
        };

        if (Array.isArray(discogsUrls)) {
            summaryWithLookups.discogsUrls = discogsUrls
                .filter((url): url is string => typeof url === 'string' && url.trim().length > 0);
        }

        return summaryWithLookups;
    };

    const cached = await getCachedData<CachedArtistDetails>(getCacheKey(artistId, 'artistDetails'));
    if (cached?.artist) {
        return mapSummaryWithDiscogsUrls(
            mapArtistToFollowedArtistSummary(cached.artist),
            getArtistDiscogsUrls(cached.artist),
        );
    }

    const artistData = await fetchArtistData(artistId, 'url-rels');
    if (artistData === null) {
        return null;
    }

    const artistRecord = artistData as { name?: unknown; relations?: any[] };
    const rawName = typeof artistRecord.name === 'string' ? artistRecord.name.trim() : '';
    const summary = {
        id: artistId,
        name: rawName.length > 0 ? rawName : artistId,
        refreshedAt: Date.now(),
    } satisfies FollowedArtistSummary;

    const externalLinks = mapRelationsToExternalLinks(artistRecord.relations);
    return mapSummaryWithDiscogsUrls(summary, getExternalLinkUrlsByService(externalLinks, 'discogs'));
};

const fetchArtistDetailsRecord = async (
    artistId: string,
): Promise<CachedArtistDetails | null> => {
    const artistData = await fetchArtistData(artistId, 'aliases+artist-rels+url-rels');

    if (artistData === null) {
        return null;
    }

    const mappedArtist = mapToArtist(artistData);

    return {
        artist: mappedArtist,
    };
};

const writeArtistDetailsCache = async (
    artistId: string,
    result: CachedArtistDetails,
    ttl: number | undefined,
): Promise<void> => {
    const ttlInHours = getArtistMetadataCacheTtlHours(ttl);
    await replaceCachedData(
        getCacheKey(artistId, 'artistDetails'),
        {
            artist: result.artist,
        } satisfies CachedArtistDetails,
        ttlInHours,
    );
};

const getArtistDetailsRecord = async (
    userId: string,
    artistId: string,
    options?: GetArtistDetailsOptions,
): Promise<CachedArtistDetails | null> => {
    const cacheKey = getCacheKey(artistId, 'artistDetails');
    const cached: CachedArtistDetails | null = await getCachedData<CachedArtistDetails>(cacheKey);

    if (cached?.artist && hasExternalLinks(cached.artist)) {
        return {
            artist: cached.artist,
        };
    }

    const result = await fetchArtistDetailsRecord(artistId);
    if (!result) {
        return null;
    }

    const ttl = options?.skipTtlLookup
        ? options.cacheTtlOverride
        : await getArtistTtl(userId, artistId);
    await writeArtistDetailsCache(artistId, result, ttl);

    return {
        artist: result.artist,
    };
};
