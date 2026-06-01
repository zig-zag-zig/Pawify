import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it, afterEach, beforeEach } from 'node:test';

process.env.DAPR_HTTP_ENDPOINT = 'http://dapr.test';
process.env.MUSICBRAINZ_DELAY_MS = '1';
process.env.MUSICBRAINZ_BACKGROUND_DELAY_MS = '1';
process.env.NOTIFY_NEW_RELEASES_LOCK_TTL_MS = '3600001';

const originalFetch = globalThis.fetch;

const installFetch = (
    handler: (url: string, init: RequestInit) => Promise<Response> | Response,
): void => {
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => (
        await handler(String(input), init ?? {})
    )) as typeof fetch;
};

afterEach(() => {
    globalThis.fetch = originalFetch;
});

describe('Dapr provider HTTP migration', () => {
    it('invokes a Dapr HTTP endpoint once for a successful provider call', async () => {
        const calls: Array<{ url: string; init: RequestInit }> = [];
        installFetch((url, init) => {
            calls.push({ url, init });
            return new Response(JSON.stringify({ artist: 'Pawify' }), { status: 200 });
        });

        const { fetchMusicBrainzWithStatus } = await import('../src/services/musicApi/musicBrainzClient.js');
        const result = await fetchMusicBrainzWithStatus('/artist?query=test&fmt=json');

        assert.deepEqual(result, { artist: 'Pawify' });
        assert.equal(calls.length, 1);
        assert.equal(
            calls[0].url,
            'http://dapr.test/v1.0/invoke/musicbrainz/method/ws/2/artist?query=test&fmt=json',
        );
        assert.equal(new Headers(calls[0].init.headers).get('User-Agent'), 'MusicReleaseNotifier/1.0');
    });

    it('does not retry transient final provider failures in app code', async () => {
        let callCount = 0;
        installFetch(() => {
            callCount += 1;
            return new Response('temporary upstream failure', { status: 500 });
        });

        const { fetchDaprProvider } = await import('../src/services/musicApi/httpClient.js');
        const result = await fetchDaprProvider(
            'discogs',
            '/artists/1',
            { method: 'GET', headers: {} },
            false,
            false,
            'status',
        );

        assert.equal(callCount, 1);
        assert.deepEqual(result, { __fetchFailure: true, status: null });
    });

    it('preserves HEAD success and abort behavior', async () => {
        const controller = new AbortController();
        controller.abort();
        let callCount = 0;
        installFetch(() => {
            callCount += 1;
            return new Response(null, { status: 204 });
        });

        const { fetchDaprProvider, isAbortError } = await import('../src/services/musicApi/httpClient.js');
        const headResult = await fetchDaprProvider(
            'coverartarchive',
            '/release/abc/front',
            { method: 'HEAD', headers: {} },
            true,
            true,
            'status',
        );

        await assert.rejects(
            () => fetchDaprProvider(
                'coverartarchive',
                '/release/abc/front',
                { method: 'HEAD', headers: {} },
                true,
                true,
                'status',
                controller.signal,
            ),
            (error) => isAbortError(error),
        );
        assert.equal(headResult, true);
        assert.equal(callCount, 1);
    });

    it('keeps retry policy in Dapr resiliency configuration', async () => {
        const resiliency = await readFile('dapr/components/resiliency.yaml', 'utf8');

        assert.match(resiliency, /httpStatusCodes: "429,500-599"/);
        assert.match(resiliency, /coverartarchive:\n\s+retry: noRetry/);
        assert.match(resiliency, /musicbrainz:\n\s+retry: externalHttpRetry/);
        assert.match(resiliency, /musicbrainzTimeout: 30s/);
        assert.match(resiliency, /pawify-state:\n\s+outbound:\n\s+retry: redisRetry/);
    });

    it('reads the Redis password from the Dapr sidecar environment', async () => {
        const envSecrets = await readFile('dapr/components/env-secrets.yaml', 'utf8');
        const redisState = await readFile('dapr/components/redis-state.yaml', 'utf8');
        const redisLock = await readFile('dapr/components/redis-lock.yaml', 'utf8');

        assert.match(envSecrets, /type: secretstores\.local\.env/);
        assert.match(redisState, /secretStore: pawify-env-secrets/);
        assert.match(redisState, /name: REDIS_PASSWORD/);
        assert.match(redisLock, /secretStore: pawify-env-secrets/);
        assert.match(redisLock, /name: REDIS_PASSWORD/);
    });
});

describe('Dapr state cache migration', () => {
    const state = new Map<string, string>();
    const savedItems: Array<Record<string, unknown>> = [];
    const deletedKeys: string[] = [];

    beforeEach(() => {
        state.clear();
        savedItems.length = 0;
        deletedKeys.length = 0;
        installFetch((url, init) => {
            const parsed = new URL(url);
            const statePrefix = '/v1.0/state/pawify-state';
            assert.ok(parsed.pathname.startsWith(statePrefix));

            if (init.method === 'POST') {
                const items = JSON.parse(String(init.body)) as Array<{ key: string; value: string }>;
                savedItems.push(...items);
                items.forEach((item) => state.set(item.key, item.value));
                return new Response(null, { status: 204 });
            }

            const key = decodeURIComponent(parsed.pathname.slice(`${statePrefix}/`.length));
            if (init.method === 'DELETE') {
                deletedKeys.push(key);
                state.delete(key);
                return new Response(null, { status: 204 });
            }

            const value = state.get(key);
            return value === undefined
                ? new Response(null, { status: 204 })
                : new Response(JSON.stringify(value), { status: 200 });
        });
    });

    it('round trips simple and undefined cache values with TTL metadata', async () => {
        const { getCachedData, replaceCachedData } = await import('../src/services/cacheService.js');

        await replaceCachedData('simple', { name: 'test' }, 2);
        assert.deepEqual(await getCachedData('simple'), { name: 'test' });
        assert.deepEqual(savedItems.at(-1)?.metadata, { ttlInSeconds: '7200' });

        await replaceCachedData('undefined-value', undefined);
        assert.equal(await getCachedData('undefined-value'), undefined);
    });

    it('chunks large values and deletes partial chunked entries', async () => {
        const { deleteCachedData, getCachedData, replaceCachedData } = await import('../src/services/cacheService.js');
        const largeValue = 'x'.repeat(1024 * 1024 + 128);

        await replaceCachedData('large', largeValue, 1);

        const metadata = state.get('large:metadata');
        assert.ok(metadata);
        const totalChunks = Number(JSON.parse(metadata).totalChunks);
        assert.ok(totalChunks > 1);
        assert.equal(await getCachedData('large'), largeValue);

        state.delete('large:chunk0000');
        assert.equal(await getCachedData('large'), null);
        assert.ok(deletedKeys.includes('large:metadata'));

        await replaceCachedData('large-delete', largeValue, 1);
        await deleteCachedData('large-delete');
        assert.ok(deletedKeys.includes('large-delete'));
        assert.ok(deletedKeys.includes('large-delete:metadata'));
        assert.ok(deletedKeys.includes('large-delete:chunk0000'));
    });
});

describe('Dapr lock, binding, and secret migration', () => {
    it('acquires and releases the notifyNewReleases distributed lock through Dapr', async () => {
        const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
        installFetch((url, init) => {
            requests.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
            return new Response(JSON.stringify({ success: true }), { status: 200 });
        });

        const {
            acquireNotifyNewReleasesLock,
            releaseNotifyNewReleasesLock,
        } = await import('../src/services/firebase/notificationRunLockStore.js');

        const lock = await acquireNotifyNewReleasesLock();
        assert.ok(lock);
        await releaseNotifyNewReleasesLock(lock);

        assert.equal(requests[0].url, 'http://dapr.test/v1.0-alpha1/lock/pawify-lock');
        assert.equal(requests[0].body.resourceId, 'notifyNewReleases');
        assert.equal(requests[0].body.expiryInSeconds, 3601);
        assert.equal(requests[1].url, 'http://dapr.test/v1.0-alpha1/unlock/pawify-lock');
        assert.equal(requests[1].body.lockOwner, lock.ownerId);
    });

    it('returns null when Dapr reports a lock conflict', async () => {
        installFetch(() => new Response(null, { status: 409 }));

        const { acquireNotifyNewReleasesLock } = await import('../src/services/firebase/notificationRunLockStore.js');

        assert.equal(await acquireNotifyNewReleasesLock(), null);
    });

    it('sends OTP email through the Dapr SMTP binding', async () => {
        let requestBody: Record<string, any> | undefined;
        installFetch((url, init) => {
            assert.equal(url, 'http://dapr.test/v1.0/bindings/smtp-gmail');
            requestBody = JSON.parse(String(init.body)) as Record<string, any>;
            return new Response(null, { status: 204 });
        });

        const { sendOtpEmail } = await import('../src/services/emailService.js');
        await sendOtpEmail('person@example.com', '123456', 10);

        assert.equal(requestBody?.operation, 'create');
        assert.equal(requestBody?.metadata.emailTo, 'person@example.com');
        assert.equal(requestBody?.metadata.subject, 'Your Password Reset OTP');
        assert.match(String(requestBody?.data), /123456/);
        assert.match(String(requestBody?.data), /10 minutes/);
    });

    it('reads optional provider tokens from Dapr secrets', async () => {
        const calls: string[] = [];
        installFetch((url) => {
            calls.push(url);
            return new Response(JSON.stringify({ 'discogs-token': 'discogs-secret' }), { status: 200 });
        });

        const { clearDaprSecretCache, getDaprSecret } = await import('../src/infrastructure/dapr/daprSecrets.js');
        clearDaprSecretCache();

        assert.equal(await getDaprSecret('discogs-token'), 'discogs-secret');
        assert.equal(await getDaprSecret('discogs-token'), 'discogs-secret');
        assert.equal(calls.length, 1);
        assert.equal(calls[0], 'http://dapr.test/v1.0/secrets/pawify-secrets/discogs-token');
    });
});

describe('Dapr Expo push migration', () => {
    it('chunks push sends through the Expo Dapr endpoint', async () => {
        const sendBatchSizes: number[] = [];
        installFetch((url, init) => {
            assert.equal(url, 'http://dapr.test/v1.0/invoke/expo/method/--/api/v2/push/send');
            const messages = JSON.parse(String(init.body)) as unknown[];
            sendBatchSizes.push(messages.length);
            return new Response(JSON.stringify({
                data: messages.map((_, index) => ({ status: 'ok', id: `ticket-${sendBatchSizes.length}-${index}` })),
            }), { status: 200 });
        });

        const { sendPushNotificationToTokens } = await import('../src/services/notifications/pushNotificationDelivery.js');
        const tokens = Array.from({ length: 101 }, (_, index) => `ExpoPushToken[token_${index}]`);
        const sent = await sendPushNotificationToTokens('user-1', tokens, {
            title: 'Hello',
            body: 'World',
        });

        assert.equal(sent, true);
        assert.deepEqual(sendBatchSizes, [100, 1]);
    });
});
