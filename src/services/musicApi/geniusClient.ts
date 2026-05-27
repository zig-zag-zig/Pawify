import {
    getGeniusAccessToken,
    logMissingOptionalCredentialOnce,
} from './credentials.js';
import { fetchWithRetry } from './httpClient.js';
import { isFetchFailureResult } from './types.js';
import type { HttpOptions } from './types.js';

const GENIUS_BASE_URL = "https://api.genius.com";

export const fetchGeniusLyrics = async (
    artistName: string,
    trackName: string,
    signal?: AbortSignal,
): Promise<string | null | undefined> => {
    if (!getGeniusAccessToken()) {
        logMissingOptionalCredentialOnce('GENIUS_ACCESS_TOKEN');
        return undefined;
    }

    const queryEncoded = encodeURIComponent(`${trackName} ${artistName}`);
    const url = `${GENIUS_BASE_URL}/search?q=${queryEncoded}`;
    const options: HttpOptions = {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${getGeniusAccessToken()}`,
        },
    };

    try {
        const response = await fetchWithRetry(url, options, false, false, 'status', signal);
        if (!response || isFetchFailureResult(response)) {
            return undefined;
        }

        const hits = response.response.hits as any[];

        for (const hit of hits) {
            if (
                hit.result.artist_names.toLowerCase().includes(artistName.toLowerCase().trim()) &&
                hit.result.title.toLowerCase().trim() === trackName.toLowerCase().trim()
            ) {
                return hit.result.url ?? null;
            }
        }

        return null;
    } catch (error) {
        if (error instanceof Error && error.message.includes('Max retries')) {
            return undefined;
        }
        throw error;
    }
};
