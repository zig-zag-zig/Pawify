import {
    getDiscogsToken,
    logMissingOptionalCredentialOnce,
} from './credentials.js';
import { fetchWithRetry, isAbortError } from './httpClient.js';
import {
    isConfirmedMissingFetchFailure,
    isFetchFailureResult,
} from './types.js';
import type {
    DiscogsResult,
    FetchFailureResult,
    HttpOptions,
} from './types.js';

const DISCOGS_BASE_URL = "https://api.discogs.com";

type DiscogsFetchResult = FetchFailureResult | Record<string, any> | null | undefined;

type DiscogsLookupResult =
    | { type: 'data'; data: any; image: string | null }
    | { type: 'missing' }
    | { type: 'transient' };

const fetchDiscogs = async (
    endpoint: string,
    signal?: AbortSignal,
): Promise<DiscogsFetchResult> => {
    if (!getDiscogsToken()) {
        logMissingOptionalCredentialOnce('DISCOGS_TOKEN');
        return undefined;
    }

    const url = `${DISCOGS_BASE_URL}${endpoint}`;
    const options: HttpOptions = {
        method: 'GET',
        headers: {
            'Authorization': `Discogs token=${getDiscogsToken()}`,
        },
    };

    try {
        return await fetchWithRetry(url.replace("/artist/", "/artists/"), options, true, false, 'status', signal);
    } catch (error) {
        if (isAbortError(error)) {
            throw error;
        }

        if (error instanceof Error && error.message.includes('Max retries')) {
            return undefined;
        }
        throw error;
    }
};

const normalizeDiscogsEndpoint = (discogsUrl: string): string => {
    return discogsUrl
        .replace(/^https?:\/\/(?:www\.)?discogs\.com/i, '')
        .replace(/^https?:\/\/api\.discogs\.com/i, '');
};

const getDiscogsLookupResult = async (
    discogsUrl: string,
    signal?: AbortSignal,
): Promise<DiscogsLookupResult> => {
    const discogsData = await fetchDiscogs(normalizeDiscogsEndpoint(discogsUrl), signal);

    if (discogsData === undefined || discogsData === null) {
        return { type: 'transient' };
    }

    if (isFetchFailureResult(discogsData)) {
        return isConfirmedMissingFetchFailure(discogsData)
            ? { type: 'missing' }
            : { type: 'transient' };
    }

    return {
        type: 'data',
        data: discogsData,
        image: mapToResult(discogsData).image ?? null,
    };
};

export const getDiscogsUrls = (relationships?: any[]): string[] => {
    if (!relationships || relationships.length === 0) return [];
    const discogsRelation = relationships.filter((rel) => rel.type === 'discogs');
    if (discogsRelation.length === 0) return [];
    const urls = discogsRelation.flatMap(d => d.url);
    return urls ? urls.filter(u => u.resource).map(u => u.resource) : [];
};

export const getDiscogsData = async (
    name: string,
    discogsUrls: string[],
    signal?: AbortSignal,
): Promise<DiscogsResult> => {
    if (discogsUrls.length === 0) {
        return { image: null };
    }

    let result: DiscogsResult = { image: undefined };
    let anyUndefined = false;
    const normalizedName = name.trim().toLowerCase();

    if (discogsUrls.length === 1) {
        const discogsUrl = discogsUrls[0];

        try {
            const discogsResult = await getDiscogsLookupResult(discogsUrl, signal);
            if (discogsResult.type === 'transient') {
                anyUndefined = true;
            } else if (discogsResult.type === 'missing') {
                result.image = null;
            } else {
                result.image = discogsResult.image;
            }
        } catch (error) {
            if (isAbortError(error)) {
                throw error;
            }

            anyUndefined = true;
        }
    } else {
        for (const discogsUrl of discogsUrls) {
            let discogsResult: DiscogsLookupResult;

            try {
                discogsResult = await getDiscogsLookupResult(discogsUrl, signal);
            } catch (error) {
                if (isAbortError(error)) {
                    throw error;
                }

                anyUndefined = true;
                continue;
            }

            if (discogsResult.type === 'transient') {
                anyUndefined = true;
                continue;
            }

            if (discogsResult.type === 'missing') {
                if (result.image === undefined) {
                    result.image = null;
                }
                continue;
            }

            if (discogsResult.image || result.image === undefined || result.image === null) {
                result.image = discogsResult.image;
            }

            if (typeof discogsResult.data?.name !== 'string') {
                continue;
            }

            const discogsName = discogsResult.data.name
                .replace(/\s?\(\d+\)(?!.*\(\d+\))/, '')
                .trim()
                .toLowerCase();
            const nameMatch = discogsName.length > normalizedName.length
                ? discogsName.includes(normalizedName)
                : normalizedName.includes(discogsName);

            if (nameMatch && result.image) {
                break;
            }
        }
    }

    if (result.image === null && anyUndefined) {
        result.image = undefined;
    }

    return result;
};

const mapToResult = (discogsData: any): DiscogsResult => {
    if (discogsData === undefined) return { image: undefined };
    return { image: discogsData?.images?.[0]?.uri ?? null };
};
