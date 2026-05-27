import { getMusicBrainzUserAgent } from './credentials.js';
import { createAbortError, delayWithAbort, isAbortError } from './abortableDelay.js';
import { applyRateLimitHeaders, classifyServiceFromUrl, getRateLimiter } from './rateLimiter.js';
import type {
    FetchFailureResult,
    HttpOptions,
    MusicBrainzPriority,
} from './types.js';

export { isAbortError } from './abortableDelay.js';

const MAX_RETRIES = 3;
const INITIAL_DELAY = 1000;

let pendingForegroundMusicBrainzRequests = 0;
let activeForegroundMusicBrainzRequests = 0;

const waitForForegroundMusicBrainzDrain = async (signal?: AbortSignal): Promise<void> => {
    while ((pendingForegroundMusicBrainzRequests > 0 || activeForegroundMusicBrainzRequests > 0)) {
        await delayWithAbort(50, signal);
    }
};

const createFetchFailureResult = (status: number | null): FetchFailureResult => {
    return {
        __fetchFailure: true,
        status,
    };
};

export const fetchWithRetry = async (
    url: string,
    options: HttpOptions,
    addUserAgent = true,
    noRetry = false,
    failureMode: 'null' | 'status' = 'null',
    signal?: AbortSignal,
    priority: MusicBrainzPriority = 'foreground',
): Promise<any> => {
    const nonRetriableStatusCodes = {
        400: 'Bad Request',
        401: 'Unauthorized',
        403: 'Forbidden',
        404: 'Not Found',
        405: 'Method Not Allowed',
        410: 'Gone',
        422: 'Unprocessable Entity',
    } as { [key: number]: string };

    let attempts = 0;
    const rateLimiter = getRateLimiter(url, priority);
    const service = classifyServiceFromUrl(url);
    const useForegroundTracking = service === 'musicbrainz' && priority === 'foreground';
    const waitForForegroundDrain = service === 'musicbrainz' && priority === 'background';

    if (addUserAgent) options.headers["User-Agent"] = getMusicBrainzUserAgent();

    while (true) {
        if (signal?.aborted) {
            throw createAbortError();
        }

        let release: (() => void) | null = null;
        let isForegroundActive = false;
        let isForegroundPending = false;
        const attempt = attempts + 1;

        try {
            if (waitForForegroundDrain) {
                await waitForForegroundMusicBrainzDrain(signal);
            }

            if (useForegroundTracking) {
                pendingForegroundMusicBrainzRequests += 1;
                isForegroundPending = true;
            }

            release = await rateLimiter.acquire();
            if (useForegroundTracking) {
                if (isForegroundPending) {
                    pendingForegroundMusicBrainzRequests = Math.max(0, pendingForegroundMusicBrainzRequests - 1);
                    isForegroundPending = false;
                }

                activeForegroundMusicBrainzRequests += 1;
                isForegroundActive = true;
            }
            const response = await fetch(url, { ...options, signal });

            applyRateLimitHeaders(response, rateLimiter, service);

            if (!response.ok) {
                if (release) {
                    release();
                    release = null;
                }
                if (isForegroundActive) {
                    activeForegroundMusicBrainzRequests = Math.max(0, activeForegroundMusicBrainzRequests - 1);
                    isForegroundActive = false;
                }

                if (nonRetriableStatusCodes[response.status] || noRetry) {
                    return failureMode === 'status'
                        ? createFetchFailureResult(response.status)
                        : null;
                }

                throw new Error(`HTTP ${response.status}`);
            }

            if (release) {
                release();
                release = null;
            }
            if (isForegroundActive) {
                activeForegroundMusicBrainzRequests = Math.max(0, activeForegroundMusicBrainzRequests - 1);
                isForegroundActive = false;
            }

            if (options.method === 'HEAD') return true;

            return await response.json();

        } catch (error) {
            if (release) {
                release();
                release = null;
            }
            if (isForegroundActive) {
                activeForegroundMusicBrainzRequests = Math.max(0, activeForegroundMusicBrainzRequests - 1);
                isForegroundActive = false;
            }

            if (isAbortError(error)) {
                throw error;
            }

            const willRetry = !(noRetry || attempts >= MAX_RETRIES);
            const retryDelayMs = willRetry ? INITIAL_DELAY * Math.pow(2, attempt) : undefined;

            if (!willRetry) {
                return failureMode === 'status'
                    ? createFetchFailureResult(null)
                    : null;
            }

            attempts++;
            const delayMs = retryDelayMs ?? INITIAL_DELAY * Math.pow(2, attempts);

            await delayWithAbort(delayMs, signal);
        } finally {
            if (isForegroundPending) {
                pendingForegroundMusicBrainzRequests = Math.max(0, pendingForegroundMusicBrainzRequests - 1);
            }
            if (isForegroundActive) {
                activeForegroundMusicBrainzRequests = Math.max(0, activeForegroundMusicBrainzRequests - 1);
            }
            if (release) {
                release();
            }
        }
    }
};
