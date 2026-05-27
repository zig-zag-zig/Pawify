import { musicApiConfig } from '../../config/runtimeConfig.js';
import type { MusicBrainzPriority } from './types.js';

export type ExternalService = 'musicbrainz' | 'coverartarchive' | 'discogs' | 'genius' | 'other';

const RATE_LIMIT_CONFIG = {
    musicbrainzForeground: { maxConcurrent: 1, delayMs: musicApiConfig.musicBrainzDelayMs },
    musicbrainzBackground: { maxConcurrent: 1, delayMs: musicApiConfig.musicBrainzBackgroundDelayMs },
    discogs: { maxConcurrent: 10, delayMs: 0 },
    genius: { maxConcurrent: 30, delayMs: 0 },
    coverartarchive: { maxConcurrent: 40, delayMs: 0 },
};

export class RateLimiter {
    maxConcurrent: number;
    delayMs: number;
    queue: Array<() => void>;
    activeRequests: number;
    lastDispatchTime: number;
    processing: boolean;
    backoffUntil: number;

    constructor(maxConcurrent: number, delayMs: number) {
        this.maxConcurrent = maxConcurrent;
        this.delayMs = delayMs;
        this.queue = [];
        this.activeRequests = 0;
        this.lastDispatchTime = 0;
        this.processing = false;
        this.backoffUntil = 0;
    }

    async acquire(): Promise<() => void> {
        return new Promise<() => void>((resolve) => {
            this.queue.push(() => {
                resolve(() => this.release());
            });
            if (!this.processing) {
                this.processQueue();
            }
        });
    }

    private release() {
        this.activeRequests = Math.max(0, this.activeRequests - 1);
        setTimeout(() => this.processQueue(), 10);
    }

    setBackoff(ms: number) {
        this.backoffUntil = Date.now() + ms;
    }

    processQueue() {
        if (this.queue.length === 0) {
            this.processing = false;
            return;
        }

        if (Date.now() < this.backoffUntil) {
            setTimeout(() => this.processQueue(), this.backoffUntil - Date.now());
            return;
        }

        this.processing = true;
        const now = Date.now();
        const timeSinceLastDispatch = now - this.lastDispatchTime;

        if (this.activeRequests >= this.maxConcurrent) {
            setTimeout(() => this.processQueue(), 50);
            return;
        }

        if (timeSinceLastDispatch < this.delayMs) {
            setTimeout(() => this.processQueue(), this.delayMs - timeSinceLastDispatch);
            return;
        }

        this.activeRequests++;
        this.lastDispatchTime = now;
        const next = this.queue.shift();
        if (next) next();

        if (this.queue.length > 0 && this.activeRequests < this.maxConcurrent) {
            setTimeout(() => this.processQueue(), this.delayMs);
        } else {
            this.processing = false;
        }
    }
}

const rateLimiters = {
    musicbrainzForeground: new RateLimiter(
        RATE_LIMIT_CONFIG.musicbrainzForeground.maxConcurrent,
        RATE_LIMIT_CONFIG.musicbrainzForeground.delayMs,
    ),
    musicbrainzBackground: new RateLimiter(
        RATE_LIMIT_CONFIG.musicbrainzBackground.maxConcurrent,
        RATE_LIMIT_CONFIG.musicbrainzBackground.delayMs,
    ),
    discogs: new RateLimiter(RATE_LIMIT_CONFIG.discogs.maxConcurrent, RATE_LIMIT_CONFIG.discogs.delayMs),
    genius: new RateLimiter(RATE_LIMIT_CONFIG.genius.maxConcurrent, RATE_LIMIT_CONFIG.genius.delayMs),
    coverartarchive: new RateLimiter(RATE_LIMIT_CONFIG.coverartarchive.maxConcurrent, RATE_LIMIT_CONFIG.coverartarchive.delayMs),
};

export const getRateLimiter = (url: string, priority: MusicBrainzPriority = 'foreground') => {
    if (url.includes('musicbrainz.org')) {
        return priority === 'background'
            ? rateLimiters.musicbrainzBackground
            : rateLimiters.musicbrainzForeground;
    }
    if (url.includes('discogs.com')) return rateLimiters.discogs;
    if (url.includes('genius.com')) return rateLimiters.genius;
    if (url.includes('coverartarchive.org')) return rateLimiters.coverartarchive;
    return rateLimiters.musicbrainzForeground;
};

export const classifyServiceFromUrl = (url: string): ExternalService => {
    if (url.includes('musicbrainz.org')) return 'musicbrainz';
    if (url.includes('coverartarchive.org')) return 'coverartarchive';
    if (url.includes('discogs.com')) return 'discogs';
    if (url.includes('genius.com')) return 'genius';
    return 'other';
};

const isMusicBrainzRateLimitedStatus = (status: number): boolean => status === 429 || status === 503;

export const applyRateLimitHeaders = (
    response: Response,
    rateLimiter: RateLimiter,
    service: ExternalService,
): number => {
    let backoffMs = 0;

    const retryAfter = response.headers.get('retry-after');
    if (retryAfter) {
        const retryAfterMsRaw = /^\d+$/.test(retryAfter) ? parseInt(retryAfter, 10) * 1000 : 0;
        const retryAfterMs = service === 'musicbrainz' && retryAfterMsRaw > 0
            ? retryAfterMsRaw + musicApiConfig.musicBrainzRetryAfterBufferMs
            : retryAfterMsRaw;
        if (retryAfterMs > 0) {
            backoffMs = Math.max(backoffMs, retryAfterMs);
        }
    }

    const discogsRemaining = response.headers.get('x-discogs-ratelimit-remaining');
    const discogsReset = response.headers.get('x-ratelimit-reset');
    if (discogsRemaining !== null && discogsReset !== null) {
        const remaining = parseInt(discogsRemaining, 10);
        const resetTime = parseInt(discogsReset, 10) * 1000;
        if (remaining <= 0 && resetTime > 0) {
            backoffMs = Math.max(backoffMs, resetTime);
        }
    }

    const genericRemaining = response.headers.get('x-ratelimit-remaining');
    const genericReset = response.headers.get('x-ratelimit-reset');
    if (genericRemaining !== null && genericReset !== null) {
        const remaining = parseInt(genericRemaining, 10);
        const resetTime = parseInt(genericReset, 10) * 1000;
        if (remaining <= 0 && resetTime > 0) {
            backoffMs = Math.max(backoffMs, resetTime);
        }
    }

    if (service === 'musicbrainz' && isMusicBrainzRateLimitedStatus(response.status)) {
        backoffMs = Math.max(backoffMs, musicApiConfig.musicBrainzMinRateLimitWaitMs);
    }

    if (backoffMs > 0) {
        rateLimiter.setBackoff(backoffMs);
    }

    return backoffMs;
};
