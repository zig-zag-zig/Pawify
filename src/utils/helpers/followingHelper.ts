import { getFollowingFromDb } from '../../services/firebase/followingStore.js';
import { cacheConfig } from '../../config/runtimeConfig.js';

const FOLLOWING_MEMBERSHIP_CACHE_TTL_MS = 30_000;
const followingMembershipCache = new Map<string, { artistIds: string[]; expiresAt: number }>();
const followingMembershipLoads = new Map<string, Promise<string[]>>();
const followingMembershipLoadTokens = new Map<string, symbol>();

export const artistCacheTtlHours = cacheConfig.artistTtlHours;
export const transientArtistCacheTtlHours = cacheConfig.transientArtistTtlHours;
const releaseLyricsCacheTtlHours = cacheConfig.releaseLyricsTtlHours;

const dedupeArtistIds = (artistIds: string[]): string[] => Array.from(new Set(artistIds));

const writeLocalFollowingArtistIds = (userId: string, artistIds: string[]): void => {
    followingMembershipCache.set(userId, {
        artistIds: dedupeArtistIds(artistIds),
        expiresAt: Date.now() + FOLLOWING_MEMBERSHIP_CACHE_TTL_MS,
    });
};

export const syncFollowingArtistIds = async (userId: string, artistIds: string[]): Promise<void> => {
    writeLocalFollowingArtistIds(userId, artistIds);
};

const getLocalFollowingArtistIds = (userId: string): string[] | null => {
    const cached = followingMembershipCache.get(userId);

    if (!cached) {
        return null;
    }

    if (cached.expiresAt <= Date.now()) {
        followingMembershipCache.delete(userId);
        return null;
    }

    return [...cached.artistIds];
};

export const invalidateFollowingArtistIdsCache = (userId: string): void => {
    followingMembershipCache.delete(userId);
    followingMembershipLoads.delete(userId);
    followingMembershipLoadTokens.delete(userId);
};

const getFollowingArtistIds = async (userId: string): Promise<string[]> => {
    const localArtistIds = getLocalFollowingArtistIds(userId);
    if (localArtistIds) {
        return localArtistIds;
    }

    const inFlightLoad = followingMembershipLoads.get(userId);
    if (inFlightLoad) {
        return [...await inFlightLoad];
    }

    const loadToken = Symbol(userId);
    followingMembershipLoadTokens.set(userId, loadToken);

    const loadPromise = (async (): Promise<string[]> => {
        const artistIds = dedupeArtistIds(await getFollowingFromDb(userId));
        if (followingMembershipLoadTokens.get(userId) === loadToken) {
            writeLocalFollowingArtistIds(userId, artistIds);
        }

        return [...artistIds];
    })();

    followingMembershipLoads.set(userId, loadPromise);

    try {
        return [...await loadPromise];
    } finally {
        if (followingMembershipLoadTokens.get(userId) === loadToken) {
            followingMembershipLoadTokens.delete(userId);
        }
        followingMembershipLoads.delete(userId);
    }
};

export const getArtistTtl = async (userId: string, _artistId: string): Promise<number> => {
    await getFollowingArtistIds(userId);
    return artistCacheTtlHours;
};

export const getReleaseLyricsTtl = (artistTtl: number | undefined): number => {
    return Math.min(artistTtl ?? releaseLyricsCacheTtlHours, releaseLyricsCacheTtlHours);
};
