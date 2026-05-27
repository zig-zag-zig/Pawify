import { fetchWithRetry, isAbortError } from './httpClient.js';
import { isConfirmedMissingFetchFailure } from './types.js';
import type { HttpOptions } from './types.js';

const coverArtInFlight = new Map<string, Promise<string | null | undefined>>();
type CoverProbeResult = 'found' | 'missing' | 'transient';

export const getCoverArtArchiveUrl = async (
    baseUrl: string,
    signal?: AbortSignal,
): Promise<string | null | undefined> => {
    if (signal) {
        return await fetchCoverArt(baseUrl, signal);
    }

    const existing = coverArtInFlight.get(baseUrl);
    if (existing) {
        return await existing;
    }

    const promise = fetchCoverArt(baseUrl);
    coverArtInFlight.set(baseUrl, promise);
    promise.finally(() => coverArtInFlight.delete(baseUrl));

    return await promise;
};

const fetchCoverArt = async (
    url: string,
    signal?: AbortSignal,
): Promise<string | null | undefined> => {
    const urlThumbnail = `${url}-500`;
    const thumbnailResult = await probeCoverUrl(urlThumbnail, signal);
    if (thumbnailResult === 'found') {
        return urlThumbnail;
    }

    const originalResult = await probeCoverUrl(url, signal);
    if (originalResult === 'found') {
        return url;
    }

    if (thumbnailResult === 'transient' || originalResult === 'transient') {
        return undefined;
    }

    return null;
};

const probeCoverUrl = async (
    url: string,
    signal?: AbortSignal,
): Promise<CoverProbeResult> => {
    const options: HttpOptions = {
        method: 'HEAD',
        headers: {},
    };

    try {
        const result = await fetchWithRetry(url, options, true, true, 'status', signal);
        if (result === true) {
            return 'found';
        }

        if (isConfirmedMissingFetchFailure(result)) {
            return 'missing';
        }

        return 'transient';
    } catch (error) {
        if (isAbortError(error)) {
            throw error;
        }

        return 'transient';
    }
};
