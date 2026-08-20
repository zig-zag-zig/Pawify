import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    classifyOperationKey,
    getDefaultInFlightDedupeAgeMs,
} from '../../../src/common/request/requestDeduper.js';

describe('classifyOperationKey', () => {
    it('classifies read-only operations', () => {
        assert.deepEqual(classifyOperationKey('fetch:artist:123'), {
            operationName: 'fetch',
            isReadOnly: true,
        });
        assert.deepEqual(classifyOperationKey('getArtistDetails:user:1'), {
            operationName: 'getartistdetails',
            isReadOnly: true,
        });
        assert.deepEqual(classifyOperationKey('searchArtists:user:query'), {
            operationName: 'searchartists',
            isReadOnly: true,
        });
        assert.deepEqual(classifyOperationKey('listFollowing:user'), {
            operationName: 'listfollowing',
            isReadOnly: true,
        });
        assert.deepEqual(classifyOperationKey('verifyOtp:user:123'), {
            operationName: 'verifyotp',
            isReadOnly: true,
        });
    });

    it('classifies non-read-only operations', () => {
        assert.deepEqual(classifyOperationKey('delete:artist:123'), {
            operationName: 'delete',
            isReadOnly: false,
        });
        assert.deepEqual(classifyOperationKey('save:pushToken:abc'), {
            operationName: 'save',
            isReadOnly: false,
        });
        assert.deepEqual(classifyOperationKey('notify:user:1'), {
            operationName: 'notify',
            isReadOnly: false,
        });
    });

    it('handles empty key', () => {
        const result = classifyOperationKey('');
        assert.equal(result.operationName, '');
        assert.equal(result.isReadOnly, false);
    });

    it('handles key with no colon separator', () => {
        const result = classifyOperationKey('fetch');
        assert.equal(result.operationName, 'fetch');
        assert.equal(result.isReadOnly, true);
    });
});

describe('getDefaultInFlightDedupeAgeMs', () => {
    it('subtracts buffer from ttl when result is above minimum', () => {
        const result = getDefaultInFlightDedupeAgeMs(60_000);
        assert.equal(result, 55_000); // 60000 - 5000
    });

    it('returns 90% of ttl for very small ttl values', () => {
        const result = getDefaultInFlightDedupeAgeMs(1_000);
        // 1000 - 5000 = -4000 < 1000, so fallback to max(floor(1000 * 0.9), 0) = 900
        assert.equal(result, 900);
    });

    it('returns 0 for zero ttl', () => {
        const result = getDefaultInFlightDedupeAgeMs(0);
        assert.equal(result, 0);
    });
});

describe('requestDeduper run()', () => {
    it('deduplicates concurrent in-flight read requests', async () => {
        const { requestDeduper } = await import('../../../src/common/request/requestDeduper.js');
        let callCount = 0;

        const { setTimeout: delay } = await import('node:timers/promises');
        const key = `get:rd-test:${Date.now()}:${Math.random()}`;
        const worker = async () => {
            callCount += 1;
            await delay(20);
            return callCount;
        };

        const [r1, r2] = await Promise.all([
            requestDeduper.run(key, worker),
            requestDeduper.run(key, worker),
        ]);

        assert.equal(r1, 1);
        assert.equal(r2, 1);
        assert.equal(callCount, 1);
    });

    it('does not deduplicate write operations', async () => {
        const { requestDeduper } = await import('../../../src/common/request/requestDeduper.js');
        let callCount = 0;

        const key = `delete:rd-test:${Date.now()}:${Math.random()}`;
        const worker = async () => {
            callCount += 1;
            return callCount;
        };

        const r1 = await requestDeduper.run(key, worker);
        const r2 = await requestDeduper.run(key, worker);

        assert.equal(r1, 1);
        assert.equal(r2, 2);
        assert.equal(callCount, 2);
    });

    it('propagates worker errors without caching', async () => {
        const { requestDeduper } = await import('../../../src/common/request/requestDeduper.js');
        let callCount = 0;

        const key = `get:rd-err:${Date.now()}:${Math.random()}`;
        const worker = async () => {
            callCount += 1;
            throw new Error('worker failed');
        };

        await assert.rejects(() => requestDeduper.run(key, worker), /worker failed/);

        await assert.rejects(() => requestDeduper.run(key, worker), /worker failed/);
        assert.equal(callCount, 2);
    });

    it('returns cached result within TTL for recent completion', async () => {
        const { requestDeduper } = await import('../../../src/common/request/requestDeduper.js');
        let callCount = 0;

        const key = `get:rd-cache:${Date.now()}:${Math.random()}`;
        const worker = async () => {
            callCount += 1;
            return `result-${callCount}`;
        };

        const r1 = await requestDeduper.run(key, worker);
        const r2 = await requestDeduper.run(key, async () => {
            throw new Error('should not be called');
        });

        assert.equal(r1, 'result-1');
        assert.equal(r2, 'result-1');
        assert.equal(callCount, 1);
    });
});
