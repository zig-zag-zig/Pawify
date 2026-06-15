import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    classifyOperationKey,
    getDefaultInFlightDedupeAgeMs,
} from '../src/common/request/requestDeduper.js';

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
