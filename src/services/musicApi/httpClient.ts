import { invokeHttpEndpoint, type DaprEndpointName } from '../../infrastructure/dapr/daprHttp.js';
import { getMusicBrainzUserAgent } from './credentials.js';
import { createAbortError, delayWithAbort, isAbortError } from './abortableDelay.js';
import { applyRateLimitHeaders, getRateLimiter, type ExternalService } from './rateLimiter.js';
import type {
    FetchFailureResult,
    HttpOptions,
    MusicBrainzPriority,
} from './types.js';

export { isAbortError } from './abortableDelay.js';

let pendingForegroundMusicBrainzRequests = 0;
let activeForegroundMusicBrainzRequests = 0;

const nonRetriableStatusCodes = new Set([400, 401, 403, 404, 405, 410, 422]);

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

const toExternalService = (endpoint: DaprEndpointName): ExternalService => endpoint;

export const fetchDaprProvider = async (
    endpoint: DaprEndpointName,
    methodPathAndQuery: string,
    options: HttpOptions,
    addUserAgent = true,
    noRetry = false,
    failureMode: 'null' | 'status' = 'null',
    signal?: AbortSignal,
    priority: MusicBrainzPriority = 'foreground',
): Promise<any> => {
    if (signal?.aborted) {
        throw createAbortError();
    }

    const service = toExternalService(endpoint);
    const rateLimiter = getRateLimiter(service, priority);
    const useForegroundTracking = service === 'musicbrainz' && priority === 'foreground';
    const waitForForegroundDrain = service === 'musicbrainz' && priority === 'background';
    const headers = { ...options.headers };

    if (addUserAgent) {
        headers['User-Agent'] = getMusicBrainzUserAgent();
    }

    let release: (() => void) | null = null;
    let isForegroundActive = false;
    let isForegroundPending = false;

    try {
        if (waitForForegroundDrain) {
            await waitForForegroundMusicBrainzDrain(signal);
        }

        if (signal?.aborted) {
            throw createAbortError();
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

        const response = await invokeHttpEndpoint(endpoint, methodPathAndQuery, {
            ...options,
            headers,
            signal,
        });

        applyRateLimitHeaders(response, rateLimiter, service);

        if (!response.ok) {
            if (failureMode === 'status') {
                return createFetchFailureResult(
                    nonRetriableStatusCodes.has(response.status) || noRetry
                        ? response.status
                        : null,
                );
            }

            return null;
        }

        if (options.method === 'HEAD') {
            return true;
        }

        return await response.json();
    } catch (error) {
        if (isAbortError(error)) {
            throw error;
        }

        return failureMode === 'status'
            ? createFetchFailureResult(null)
            : null;
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
};
