import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { installFirebaseServiceFake } from './helpers/moduleFakes.js';
import { createRelease, createReleaseNotificationSettings } from './helpers/releaseFixtures.js';
import { createUserSettingsDependencies } from './helpers/userSettingsUseCaseFakes.js';

installFirebaseServiceFake();

describe('user settings use cases', () => {
    it('saves notification settings, rebuilds known releases, prunes new releases, and notifies clients', async () => {
        const { createUpdateReleaseNotificationSettingsUseCase } = await import(
            '../src/features/userSettings/usecases/updateReleaseNotificationSettings.js'
        );
        const nextSettings = createReleaseNotificationSettings();
        const state = createUserSettingsDependencies({
            catalog: {
                'artist-1': [
                    createRelease({ id: 'tracked', artistId: 'artist-1', date: '2026-01-01' }),
                    createRelease({ id: 'missing-date', artistId: 'artist-1', date: null }),
                    createRelease({ id: 'future', artistId: 'artist-1', date: '2999-01-01' }),
                ],
                'artist-2': [
                    createRelease({ id: 'older-included', artistId: 'artist-2', date: '2020-01-01' }),
                ],
            },
        });
        const useCase = createUpdateReleaseNotificationSettingsUseCase(state.dependencies);

        const result = await useCase('user-1', nextSettings, 'push-token-1');

        assert.deepEqual(result, nextSettings);
        assert.deepEqual(state.saveCalls, [nextSettings]);
        assert.deepEqual(state.replaceCalls, [
            { userId: 'user-1', artistId: 'artist-1', releaseIds: ['tracked'] },
            { userId: 'user-1', artistId: 'artist-2', releaseIds: ['older-included'] },
        ]);
        assert.deepEqual(state.removeCalls, [
            { userId: 'user-1', settings: nextSettings },
        ]);
        assert.deepEqual(state.notificationCalls.sort(), [
            'releases:push-token-1',
            'settings:push-token-1',
        ]);
    });

    it('rolls settings back and skips notifications when known release rebuild fails', async () => {
        const { createUpdateReleaseNotificationSettingsUseCase } = await import(
            '../src/features/userSettings/usecases/updateReleaseNotificationSettings.js'
        );
        const previousSettings = createReleaseNotificationSettings({
            oldestReleaseDateMonths: 12,
            includeReleasesWithoutDate: true,
        });
        const nextSettings = createReleaseNotificationSettings();
        const state = createUserSettingsDependencies({
            catalog: {
                'artist-1': [createRelease({ id: 'tracked', artistId: 'artist-1' })],
                'artist-2': [createRelease({ id: 'never-read', artistId: 'artist-2' })],
            },
            failArtistId: 'artist-2',
            previousSettings,
        });
        const useCase = createUpdateReleaseNotificationSettingsUseCase(state.dependencies);

        await assert.rejects(
            () => useCase('user-1', nextSettings, 'push-token-1'),
            /catalog failed/,
        );

        assert.deepEqual(state.saveCalls, [nextSettings, previousSettings]);
        assert.deepEqual(state.notificationCalls, []);
    });
});
