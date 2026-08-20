import { createLogger } from '../logging/logger.js';

const DEFAULT_DEDUP_TTL_MS = 60_000;
const DEFAULT_CLEANUP_INTERVAL_MS = 20_000;
const DEFAULT_IN_FLIGHT_DEDUPE_BUFFER_MS = 5_000;
const MIN_IN_FLIGHT_DEDUPE_AGE_MS = 1_000;
const READ_ONLY_OPERATION_VERBS = ['fetch', 'get', 'list', 'read', 'search', 'verify'];

const logger = createLogger('common.requestDeduper');

export const getDefaultInFlightDedupeAgeMs = (ttlMs: number): number => {
    const withBuffer = ttlMs - DEFAULT_IN_FLIGHT_DEDUPE_BUFFER_MS;
    if (withBuffer >= MIN_IN_FLIGHT_DEDUPE_AGE_MS) {
        return withBuffer;
    }

    // Keep a small but non-zero window for very small TTL values.
    return Math.max(Math.floor(ttlMs * 0.9), 0);
};

export const classifyOperationKey = (
    key: string,
): { operationName: string; isReadOnly: boolean } => {
    const operationName = key.split(':', 1)[0]?.trim().toLowerCase() ?? '';

    return {
        operationName,
        isReadOnly: READ_ONLY_OPERATION_VERBS.some(
            (verb) => operationName === verb || operationName.startsWith(verb),
        ),
    };
};

type RecentResult = {
    value: unknown;
    expiresAt: number;
};

type InFlightRequest = {
    startedAt: number;
    promise: Promise<unknown>;
};

export interface RequestDeduperPort {
    run<T>(key: string, worker: () => Promise<T>): Promise<T>;
}

class RequestDeduper implements RequestDeduperPort {
    private readonly inFlightRequests = new Map<string, InFlightRequest>();
    private readonly recentResults = new Map<string, RecentResult>();
    private readonly ttlMs: number;
    private readonly inFlightDedupeAgeMs: number;

    constructor(
        ttlMs = DEFAULT_DEDUP_TTL_MS,
        inFlightDedupeAgeMs = getDefaultInFlightDedupeAgeMs(ttlMs),
    ) {
        this.ttlMs = ttlMs;
        this.inFlightDedupeAgeMs = Math.max(Math.min(inFlightDedupeAgeMs, ttlMs), 0);
    }

    async run<T>(key: string, worker: () => Promise<T>): Promise<T> {
        const operation = classifyOperationKey(key);
        if (!operation.isReadOnly) {
            logger.warn('skipping dedupe for non-read operation key', {
                operationName: operation.operationName,
                keyLength: key.length,
            });

            return await worker();
        }

        this.cleanupExpiredResults();

        const now = Date.now();
        const recent = this.recentResults.get(key);
        if (recent && recent.expiresAt > now) {
            return recent.value as T;
        }

        const inFlight = this.inFlightRequests.get(key);
        if (inFlight) {
            const inFlightAgeMs = now - inFlight.startedAt;
            if (inFlightAgeMs <= this.inFlightDedupeAgeMs) {
                return (await inFlight.promise) as T;
            }
        }

        const promise = worker()
            .then((value) => {
                this.recentResults.set(key, {
                    value,
                    expiresAt: Date.now() + this.ttlMs,
                });
                return value;
            })
            .finally(() => {
                const currentInFlight = this.inFlightRequests.get(key);
                if (currentInFlight?.promise === promise) {
                    this.inFlightRequests.delete(key);
                }
            });

        this.inFlightRequests.set(key, {
            startedAt: now,
            promise,
        });
        return await promise;
    }

    cleanupExpiredResults(): void {
        const now = Date.now();

        for (const [key, entry] of this.recentResults.entries()) {
            if (entry.expiresAt <= now) {
                this.recentResults.delete(key);
            }
        }
    }
}

export const requestDeduper = new RequestDeduper();

setInterval(() => requestDeduper.cleanupExpiredResults(), DEFAULT_CLEANUP_INTERVAL_MS).unref?.();
