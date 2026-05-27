import { fetchWithRetry } from './httpClient.js';
import type { FetchFailureResult, HttpOptions, MusicBrainzPriority } from './types.js';

const MUSICBRAINZ_BASE_URL = "https://musicbrainz.org/ws/2";

export const fetchMusicBrainzWithStatus = async (
    endpoint: string,
    method: 'GET' | 'HEAD' = 'GET',
    signal?: AbortSignal,
    priority: MusicBrainzPriority = 'foreground',
): Promise<unknown | FetchFailureResult> => {
    const url = `${MUSICBRAINZ_BASE_URL}${endpoint}`;
    const options: HttpOptions = {
        method,
        headers: {},
    };
    return await fetchWithRetry(url, options, true, false, 'status', signal, priority);
};

export const fetchMusicBrainz = async (
    endpoint: string,
    method: 'GET' | 'HEAD' = 'GET',
    signal?: AbortSignal,
    priority: MusicBrainzPriority = 'foreground',
) => {
    const url = `${MUSICBRAINZ_BASE_URL}${endpoint}`;
    const options: HttpOptions = {
        method,
        headers: {},
    };
    return await fetchWithRetry(url, options, true, false, 'null', signal, priority);
};
