import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createGetNewReleasesUseCase } from '../src/features/releases/usecases/getNewReleases.js';
import { createGetArtistReleasesUseCase } from '../src/features/releases/usecases/getArtistReleases.js';
import { createRemoveNewReleasesUseCase } from '../src/features/releases/usecases/removeNewReleases.js';
import { createGetNewReleasesDependencies } from './helpers/releaseUseCaseFakes.js';
import { createNewRelease, createRelease } from './helpers/releaseFixtures.js';
import type { ReleaseReadUseCaseDependencies, ReleaseWriteUseCaseDependencies } from '../src/features/releases/ports.js';

describe('release use cases', () => {
    it('sorts new releases by date before queueing cover tasks', async () => {
        const state = createGetNewReleasesDependencies({
            newReleasesMap: {
                exact: createNewRelease({
                    id: 'exact',
                    date: '2026-02-10',
                    date_for_display: '10.02.2026',
                }),
                older: createNewRelease({
                    id: 'older',
                    date: '2025-01-01',
                    date_for_display: '01.01.2025',
                }),
                unknown: createNewRelease({
                    id: 'unknown',
                    date: null,
                    date_for_display: 'Unknown date',
                }),
            },
            coverPageEntries: [
                { releaseGroupId: 'group-1', releaseIds: ['exact', 'older'] },
            ],
        });
        const useCase = createGetNewReleasesUseCase(state.dependencies);

        const result = await useCase('user-1');

        assert.deepEqual(result.releases.map(release => release.id), [
            'exact',
            'older',
            'unknown',
        ]);
        assert.equal(result.releaseCoverTaskId, 'cover-task-1');
        assert.deepEqual(state.queueCalls, [
            { userId: 'user-1', releaseIds: ['exact', 'older'] },
        ]);
    });

    it('fetches artist releases, queues cover tasks, and adds task user', async () => {
        const fakeRequestDeduper = {
            async run<T>(_key: string, worker: () => Promise<T>): Promise<T> { return worker(); },
        };
        let addedTaskUser: { taskId: string; userId: string } | undefined;
        const deps: Pick<
            ReleaseReadUseCaseDependencies,
            'artistReleaseContextGateway' | 'releaseCatalogGateway' | 'releaseTaskQueue' | 'requestDeduper'
        > = {
            artistReleaseContextGateway: {
                async getArtistTtl() { return 500; },
            },
            releaseCatalogGateway: {
                async getArtistReleases(_artistId, _ttl, _onPage) {
                    return [
                        { id: 'rg-1', title: 'Album', date: '2026-01-01', disambiguation: null, 'primary-type': 'Album', releaseIds: ['r1', 'r2'] },
                    ];
                },
                async getReleaseGroupReleases() { return []; },
                async getRelease() { return null; },
                async releaseExists() { return false; },
            },
            releaseTaskQueue: {
                addTaskUser(taskId, userId) { addedTaskUser = { taskId, userId }; },
                queueArtistReleaseGroupCovers(_userId, _artistId, _entries, _ttl) { return 'cover-task-1'; },
                queueReleaseGroupReleaseCovers() { return ''; },
                queueNewReleaseCovers() { return ''; },
                queueReleaseTrackLyrics() { return ''; },
                queueReleaseArtistProfileImages() { return ''; },
            },
            requestDeduper: fakeRequestDeduper,
        };

        const useCase = createGetArtistReleasesUseCase(deps);
        const result = await useCase('user-1', 'artist-1');

        assert.equal(result.releaseGroups.length, 1);
        assert.equal(result.releaseGroups[0]!.id, 'rg-1');
        assert.equal(result.releaseGroupCoverTaskId, 'cover-task-1');
        assert.deepEqual(addedTaskUser, { taskId: 'cover-task-1', userId: 'user-1' });
    });

    it('deletes releases and notifies clients', async () => {
        const deleteCalls: Array<{ userId: string; releaseIds: string[] }> = [];
        let notifyCalledWith: { userId: string; sourcePushToken?: string } | undefined;
        const deps: Pick<ReleaseWriteUseCaseDependencies, 'newReleasesRepository' | 'releaseNotifier'> = {
            newReleasesRepository: {
                async getNewReleasesSnapshot() { throw new Error('should not run'); },
                async deleteNewReleases(userId, releaseIds) {
                    deleteCalls.push({ userId, releaseIds });
                },
            },
            releaseNotifier: {
                async notifyReleasesChanged(userId, sourcePushToken) {
                    notifyCalledWith = { userId, sourcePushToken };
                },
            },
        };

        const useCase = createRemoveNewReleasesUseCase(deps);
        await useCase('user-1', ['r1', 'r2'], 'push-token-1');

        assert.deepEqual(deleteCalls, [{ userId: 'user-1', releaseIds: ['r1', 'r2'] }]);
        assert.deepEqual(notifyCalledWith, { userId: 'user-1', sourcePushToken: 'push-token-1' });
    });

    describe('getRelease', () => {
        it('returns release with lyrics and profile image task IDs', async () => {
            const { createGetReleaseUseCase } = await import('../src/features/releases/usecases/getRelease.js');
            const fakeRequestDeduper = {
                async run<T>(_key: string, worker: () => Promise<T>): Promise<T> { return worker(); },
            };
            const release = createRelease({ id: 'release-1', title: 'Test Release' });

            const deps: Pick<
                ReleaseReadUseCaseDependencies,
                'releaseCatalogGateway' | 'releaseTaskQueue' | 'requestDeduper'
            > = {
                releaseCatalogGateway: {
                    async getArtistReleases() { throw new Error('should not run'); },
                    async getReleaseGroupReleases() { throw new Error('should not run'); },
                    async getRelease(_releaseId) { return release; },
                    async releaseExists() { throw new Error('should not run'); },
                },
                releaseTaskQueue: {
                    addTaskUser() { },
                    queueArtistReleaseGroupCovers() { return ''; },
                    queueReleaseGroupReleaseCovers() { return ''; },
                    queueNewReleaseCovers() { return ''; },
                    queueReleaseTrackLyrics() { return 'lyrics-task-1'; },
                    queueReleaseArtistProfileImages() { return 'profile-task-1'; },
                },
                requestDeduper: fakeRequestDeduper,
            };

            const useCase = createGetReleaseUseCase(deps);
            const result = await useCase('user-1', 'release-1');

            assert.ok(result);
            assert.equal(result.release.id, 'release-1');
            assert.equal(result.lyricsTaskId, 'lyrics-task-1');
            assert.equal(result.profileImageTaskId, 'profile-task-1');
        });

        it('returns null when release is not found', async () => {
            const { createGetReleaseUseCase } = await import('../src/features/releases/usecases/getRelease.js');
            const fakeRequestDeduper = {
                async run<T>(_key: string, worker: () => Promise<T>): Promise<T> { return worker(); },
            };

            const deps: Pick<
                ReleaseReadUseCaseDependencies,
                'releaseCatalogGateway' | 'releaseTaskQueue' | 'requestDeduper'
            > = {
                releaseCatalogGateway: {
                    async getArtistReleases() { throw new Error('should not run'); },
                    async getReleaseGroupReleases() { throw new Error('should not run'); },
                    async getRelease() { return null; },
                    async releaseExists() { throw new Error('should not run'); },
                },
                releaseTaskQueue: {
                    addTaskUser() { },
                    queueArtistReleaseGroupCovers() { throw new Error('should not run'); },
                    queueReleaseGroupReleaseCovers() { throw new Error('should not run'); },
                    queueNewReleaseCovers() { throw new Error('should not run'); },
                    queueReleaseTrackLyrics() { throw new Error('should not run'); },
                    queueReleaseArtistProfileImages() { throw new Error('should not run'); },
                },
                requestDeduper: fakeRequestDeduper,
            };

            const useCase = createGetReleaseUseCase(deps);
            const result = await useCase('user-1', 'release-missing');

            assert.equal(result, null);
        });
    });

    describe('getReleaseGroupReleases', () => {
        it('returns releases, queues cover tasks, and registers task user', async () => {
            const { createGetReleaseGroupReleasesUseCase } = await import('../src/features/releases/usecases/getReleaseGroupReleases.js');
            const fakeRequestDeduper = {
                async run<T>(_key: string, worker: () => Promise<T>): Promise<T> { return worker(); },
            };
            let coverPageEntries: Array<{ releaseGroupId: string; releaseIds: string[] }> = [];
            let addedTaskUser: { taskId: string; userId: string } | undefined;

            const deps: Pick<
                ReleaseReadUseCaseDependencies,
                'releaseCatalogGateway' | 'releaseTaskQueue' | 'requestDeduper'
            > = {
                releaseCatalogGateway: {
                    async getArtistReleases() { throw new Error('should not run'); },
                    async getReleaseGroupReleases(_releaseGroupId, _ttl, onReleaseIdsPage) {
                        await onReleaseIdsPage('rg-1', ['r1', 'r2'], true);
                        return [{ id: 'r1', title: 'Release 1', date: '2026-01-01', disambiguation: null, 'release-group': { id: 'rg-1', title: 'Group', date: null, disambiguation: null, 'primary-type': 'Album' }, 'artist-credit': [], media: [], artistId: 'artist-1', date_for_display: '01.01.2026', releaseGroupId: 'rg-1', cover_url: null, externalLinks: [] }];
                    },
                    async getRelease() { throw new Error('should not run'); },
                    async releaseExists() { throw new Error('should not run'); },
                },
                releaseTaskQueue: {
                    addTaskUser(taskId, userId) { addedTaskUser = { taskId, userId }; },
                    queueArtistReleaseGroupCovers() { return ''; },
                    queueReleaseGroupReleaseCovers(_userId, _releaseGroupId, entries) {
                        coverPageEntries = entries;
                        return 'cover-task-rg-1';
                    },
                    queueNewReleaseCovers() { return ''; },
                    queueReleaseTrackLyrics() { return ''; },
                    queueReleaseArtistProfileImages() { return ''; },
                },
                requestDeduper: fakeRequestDeduper,
            };

            const useCase = createGetReleaseGroupReleasesUseCase(deps);
            const result = await useCase('user-1', 'rg-1');

            assert.equal(result.releases.length, 1);
            assert.equal(result.releases[0]!.id, 'r1');
            assert.equal(result.releaseCoverTaskId, 'cover-task-rg-1');
            assert.deepEqual(coverPageEntries, [{ releaseGroupId: 'rg-1', releaseIds: ['r1', 'r2'] }]);
            assert.deepEqual(addedTaskUser, { taskId: 'cover-task-rg-1', userId: 'user-1' });
        });
    });
});
