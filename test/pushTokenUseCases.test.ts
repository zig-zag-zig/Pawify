import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    createSavePushTokenUseCase,
    createDeletePushTokenUseCase,
} from '../src/features/pushTokens/usecases/pushTokenUseCases.js';
import type { PushTokenUseCaseDependencies } from '../src/features/pushTokens/ports.js';

const createFakeDependencies = (
    overrides: Partial<PushTokenUseCaseDependencies> = {},
): PushTokenUseCaseDependencies => ({
    pushTokenGateway: {
        async savePushToken() { },
        async deletePushToken() { },
        ...overrides.pushTokenGateway,
    },
});

describe('push token use cases', () => {
    describe('savePushToken', () => {
        it('calls pushTokenGateway.savePushToken with correct arguments', async () => {
            const calls: Array<{ userId: string; deviceId: string; pushToken: string }> = [];
            const deps = createFakeDependencies({
                pushTokenGateway: {
                    ...createFakeDependencies().pushTokenGateway,
                    async savePushToken(userId, deviceId, pushToken) {
                        calls.push({ userId, deviceId, pushToken });
                    },
                },
            });
            const useCase = createSavePushTokenUseCase(deps);

            await useCase('user-1', 'device-1', 'ExpoPushToken[abc123]');

            assert.deepEqual(calls, [{
                userId: 'user-1',
                deviceId: 'device-1',
                pushToken: 'ExpoPushToken[abc123]',
            }]);
        });
    });

    describe('deletePushToken', () => {
        it('calls pushTokenGateway.deletePushToken with correct arguments', async () => {
            const calls: Array<{ userId: string; deviceId: string }> = [];
            const deps = createFakeDependencies({
                pushTokenGateway: {
                    ...createFakeDependencies().pushTokenGateway,
                    async deletePushToken(userId, deviceId) {
                        calls.push({ userId, deviceId });
                    },
                },
            });
            const useCase = createDeletePushTokenUseCase(deps);

            await useCase('user-1', 'device-1');

            assert.deepEqual(calls, [{ userId: 'user-1', deviceId: 'device-1' }]);
        });
    });
});
