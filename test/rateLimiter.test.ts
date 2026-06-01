import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, it } from 'node:test';

process.env.MUSICBRAINZ_RETRY_AFTER_BUFFER_MS = '1000';
process.env.MUSICBRAINZ_MIN_RATE_LIMIT_WAIT_MS = '1500';

const importRateLimiter = async () => import('../src/services/musicApi/rateLimiter.js');

describe('music API rate limiting', () => {
    it('selects provider limiters without upstream URLs', async () => {
        const { getRateLimiter } = await importRateLimiter();

        assert.notEqual(getRateLimiter('musicbrainz', 'foreground'), getRateLimiter('musicbrainz', 'background'));
        assert.equal(getRateLimiter('discogs'), getRateLimiter('discogs'));
        assert.equal(getRateLimiter('genius'), getRateLimiter('genius'));
        assert.equal(getRateLimiter('coverartarchive'), getRateLimiter('coverartarchive'));
    });

    it('applies retry headers and MusicBrainz status backoff to the limiter', async () => {
        const { RateLimiter, applyRateLimitHeaders } = await importRateLimiter();
        const limiter = new RateLimiter(1, 0);
        const before = Date.now();
        const response = new Response(null, {
            status: 429,
            headers: {
                'retry-after': '2',
            },
        });

        const backoffMs = applyRateLimitHeaders(response, limiter, 'musicbrainz');

        assert.equal(backoffMs, 3000);
        assert.ok(limiter.backoffUntil >= before + backoffMs);
    });

    it('honors max concurrency until the active request releases its slot', async () => {
        const { RateLimiter } = await importRateLimiter();
        const limiter = new RateLimiter(1, 0);
        const firstRelease = await limiter.acquire();
        let secondResolved = false;
        const secondReleasePromise = limiter.acquire().then((release) => {
            secondResolved = true;
            return release;
        });

        await delay(20);
        assert.equal(secondResolved, false);
        assert.equal(limiter.activeRequests, 1);

        firstRelease();
        const secondRelease = await secondReleasePromise;

        assert.equal(secondResolved, true);
        assert.equal(limiter.activeRequests, 1);

        secondRelease();
        await delay(20);
        assert.equal(limiter.activeRequests, 0);
    });
});
