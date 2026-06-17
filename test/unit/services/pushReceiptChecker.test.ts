import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { installFetch } from '../../helpers/daprTestHelpers.js';
import { installModuleFake } from '../../helpers/moduleFakes.js';

describe('pushReceiptChecker', () => {
    it('swallows errors from receipt checking and logs instead of throwing', async () => {
        const deletedTokens: string[] = [];

        installFetch((url) => {
            if (url.includes('/push/getReceipts')) {
                throw new Error('network failure');
            }
            if (url.includes('/state/pawify-state')) {
                return new Response(null, { status: 204 });
            }
            return new Response('not found', { status: 404 });
        });

        installModuleFake('../../src/services/notifications/pushTokenStoreAdapter.js', {
            deletePushTokensFromStore: async (_userId: string, tokens: string[]) => {
                deletedTokens.push(...tokens);
            },
        });

        const { checkPushReceipts } = await import('../../../src/services/notifications/pushReceiptChecker.js');
        const receiptTokens = new Map([['receipt-1', 'ExpoPushToken[abc]']]);

        // Should not throw — errors are caught and logged
        await checkPushReceipts('user-1', 'visible', 'testEvent', receiptTokens);
        assert.equal(deletedTokens.length, 0);
    });

    it('identifies DeviceNotRegistered receipts and removes invalid tokens', async () => {
        const deletedTokens: string[] = [];

        installFetch((url) => {
            if (url.includes('/push/getReceipts')) {
                return new Response(JSON.stringify({
                    data: {
                        'receipt-1': {
                            status: 'error',
                            message: 'DeviceNotRegistered',
                            details: { error: 'DeviceNotRegistered', expoPushToken: 'ExpoPushToken[bad1]' },
                        },
                        'receipt-2': { status: 'ok' },
                    },
                }), { status: 200 });
            }
            if (url.includes('/state/pawify-state')) {
                return new Response(null, { status: 204 });
            }
            return new Response('not found', { status: 404 });
        });

        installModuleFake('../../src/services/notifications/pushTokenStoreAdapter.js', {
            deletePushTokensFromStore: async (_userId: string, tokens: string[]) => {
                deletedTokens.push(...tokens);
            },
        });

        const { checkPushReceipts } = await import('../../../src/services/notifications/pushReceiptChecker.js');
        const receiptTokens = new Map([
            ['receipt-1', 'ExpoPushToken[bad1]'],
            ['receipt-2', 'ExpoPushToken[good2]'],
        ]);

        await checkPushReceipts('user-1', 'visible', 'testEvent', receiptTokens);

        assert.deepEqual(deletedTokens, ['ExpoPushToken[bad1]']);
    });

    it('does not delete tokens for non-DeviceNotRegistered errors', async () => {
        const deletedTokens: string[] = [];

        installFetch((url) => {
            if (url.includes('/push/getReceipts')) {
                return new Response(JSON.stringify({
                    data: {
                        'receipt-1': {
                            status: 'error',
                            message: 'MessageTooBig',
                            details: { error: 'MessageTooBig' },
                        },
                    },
                }), { status: 200 });
            }
            if (url.includes('/state/pawify-state')) {
                return new Response(null, { status: 204 });
            }
            return new Response('not found', { status: 404 });
        });

        installModuleFake('../../src/services/notifications/pushTokenStoreAdapter.js', {
            deletePushTokensFromStore: async (_userId: string, tokens: string[]) => {
                deletedTokens.push(...tokens);
            },
        });

        const { checkPushReceipts } = await import('../../../src/services/notifications/pushReceiptChecker.js');
        const receiptTokens = new Map([['receipt-1', 'ExpoPushToken[abc]']]);

        await checkPushReceipts('user-1', 'visible', 'testEvent', receiptTokens);

        assert.equal(deletedTokens.length, 0);
    });
});
