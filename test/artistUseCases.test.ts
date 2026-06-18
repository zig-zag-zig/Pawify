import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { installFirebaseServiceFake } from './helpers/moduleFakes.js';
import type { ArtistWriteUseCaseDependencies, ArtistReadUseCaseDependencies } from '../src/features/artists/ports.js';
import type { FollowedArtistSummary } from '../src/utils/types/followedArtistTypes.js';

// Prevent Firebase store modules from loading and triggering firebaseInit.js
// which requires credentials. The fake prevents transitive load of firebaseInit.
installFirebaseServiceFake();

describe('artist use cases', () => {
    it('follows an artist, saves known releases, queues profile images, and notifies clients', async () => {
        const { createFollowArtistUseCase } = await import('../src/features/artists/usecases/followArtist.js');
        const saveCalls: Array<{
            artistId: string;
            releaseIds: string[];
            summary?: FollowedArtistSummary;
        }> = [];
        const queueCalls: Array<{
            scope: string;
            artistLookups: Array<{ artistId: string; artistName?: string; discogsUrls?: string[] }>;
            ttl: number | undefined;
        }> = [];
        const notificationCalls: string[] = [];
        const summary = {
            id: 'artist-1',
            name: 'Artist One',
            refreshedAt: 100,
            discogsUrls: ['https://discogs.com/artist/1', ''],
        } as FollowedArtistSummary & { discogsUrls: string[] };

        const dependencies: Pick<
            ArtistWriteUseCaseDependencies,
            | 'artistDetailsGateway'
            | 'artistFollowingRepository'
            | 'artistReleaseCatalogGateway'
            | 'artistProfileImageQueue'
            | 'cacheTtlGateway'
            | 'followingNotifier'
        > = {
            artistDetailsGateway: {
                async getArtistDetails() {
                    throw new Error('getArtistDetails should not run');
                },
                async getFollowedArtistSummary() {
                    return summary;
                },
            },
            artistFollowingRepository: {
                async getFollowingArtistIds() {
                    throw new Error('getFollowingArtistIds should not run');
                },
                async getFollowingState() {
                    throw new Error('getFollowingState should not run');
                },
                async saveFollowedArtist(_userId, artistId, releaseIds, artistSummary) {
                    saveCalls.push({ artistId, releaseIds, summary: artistSummary });
                },
                async saveFollowingArtistSummaries() {
                    throw new Error('saveFollowingArtistSummaries should not run');
                },
                async deleteFollowedArtist() {
                    throw new Error('deleteFollowedArtist should not run');
                },
            },
            artistReleaseCatalogGateway: {
                async getArtistReleaseIds(_artistId, ttl) {
                    assert.equal(ttl, 123);
                    return ['release-1', 'release-2'];
                },
            },
            artistProfileImageQueue: {
                queueArtistProfileImages() {
                    throw new Error('queueArtistProfileImages should not run');
                },
                queueArtistProfileImagesWithLookups(_userId, scope, artistLookups, ttl) {
                    queueCalls.push({ scope, artistLookups, ttl });
                    return 'profile-task-1';
                },
            },
            cacheTtlGateway: {
                async getArtistTtl() {
                    return 123;
                },
            },
            followingNotifier: {
                async notifyFollowingChanged(_userId, sourcePushToken) {
                    notificationCalls.push(sourcePushToken ?? '');
                },
            },
        };

        const useCase = createFollowArtistUseCase(dependencies);

        await useCase('user-1', 'artist-1', 'source-token');

        assert.deepEqual(saveCalls, [{
            artistId: 'artist-1',
            releaseIds: ['release-1', 'release-2'],
            summary,
        }]);
        assert.equal(queueCalls.length, 1);
        assert.equal(queueCalls[0]?.scope, 'follow_artist');
        assert.deepEqual(queueCalls[0]?.artistLookups, [{
            artistId: 'artist-1',
            artistName: 'Artist One',
            discogsUrls: ['https://discogs.com/artist/1'],
        }]);
        assert.ok(queueCalls[0]?.ttl && queueCalls[0].ttl > 0);
        assert.deepEqual(notificationCalls, ['source-token']);
    });

    it('unfollows multiple artists and notifies clients', async () => {
        const { createUnfollowArtistsUseCase } = await import('../src/features/artists/usecases/unfollowArtists.js');
        const deleteCalls: string[] = [];
        let notifyCalled = false;

        const deps: Pick<ArtistWriteUseCaseDependencies, 'artistFollowingRepository' | 'followingNotifier'> = {
            artistFollowingRepository: {
                async getFollowingArtistIds() { throw new Error('should not run'); },
                async getFollowingState() { throw new Error('should not run'); },
                async saveFollowedArtist() { throw new Error('should not run'); },
                async saveFollowingArtistSummaries() { throw new Error('should not run'); },
                async deleteFollowedArtist(_userId, artistId) { deleteCalls.push(artistId); },
            },
            followingNotifier: {
                async notifyFollowingChanged(_userId, sourcePushToken) {
                    notifyCalled = true;
                    assert.equal(sourcePushToken, 'push-token-1');
                },
            },
        };

        const useCase = createUnfollowArtistsUseCase(deps);
        await useCase('user-1', ['artist-1', 'artist-2', 'artist-3'], 'push-token-1');

        assert.deepEqual(deleteCalls, ['artist-1', 'artist-2', 'artist-3']);
        assert.equal(notifyCalled, true);
    });

    it('returns artist details and queues profile image task', async () => {
        const { createGetArtistDetailsUseCase } = await import('../src/features/artists/usecases/getArtistDetails.js');
        const fakeRequestDeduper = {
            async run<T>(_key: string, worker: () => Promise<T>): Promise<T> {
                return worker();
            },
        };
        const artist = {
            id: 'artist-1',
            name: 'Artist One',
            type: 'Group' as const,
            disambiguation: null,
            aliases: [],
            members: [],
            externalLinks: [],
            lifeSpan: { begin: null, end: null, ended: false },
            beginArea: { name: null },
        };
        const deps: Pick<
            ArtistReadUseCaseDependencies,
            'artistDetailsGateway' | 'artistProfileImageQueue' | 'cacheTtlGateway' | 'requestDeduper'
        > = {
            artistDetailsGateway: {
                async getArtistDetails(_userId, _artistId, options) {
                    assert.equal(options?.skipTtlLookup, true);
                    return artist;
                },
                async getFollowedArtistSummary() { throw new Error('should not run'); },
            },
            artistProfileImageQueue: {
                queueArtistProfileImages() { throw new Error('should not run'); },
                queueArtistProfileImagesWithLookups() { return 'task-1'; },
            },
            cacheTtlGateway: {
                async getArtistTtl() { return 500; },
            },
            requestDeduper: fakeRequestDeduper,
        };

        const useCase = createGetArtistDetailsUseCase(deps);
        const result = await useCase('user-1', 'artist-1');

        assert.ok(result);
        assert.equal(result.artist.id, 'artist-1');
        assert.equal(result.profileImageTaskId, 'task-1');
    });

    it('returns null when artist is not found', async () => {
        const { createGetArtistDetailsUseCase } = await import('../src/features/artists/usecases/getArtistDetails.js');
        const fakeRequestDeduper = {
            async run<T>(_key: string, worker: () => Promise<T>): Promise<T> {
                return worker();
            },
        };
        const deps: Pick<
            ArtistReadUseCaseDependencies,
            'artistDetailsGateway' | 'artistProfileImageQueue' | 'cacheTtlGateway' | 'requestDeduper'
        > = {
            artistDetailsGateway: {
                async getArtistDetails() { return null; },
                async getFollowedArtistSummary() { throw new Error('should not run'); },
            },
            artistProfileImageQueue: {
                queueArtistProfileImages() { throw new Error('should not run'); },
                queueArtistProfileImagesWithLookups() { throw new Error('should not run'); },
            },
            cacheTtlGateway: {
                async getArtistTtl() { return undefined; },
            },
            requestDeduper: fakeRequestDeduper,
        };

        const useCase = createGetArtistDetailsUseCase(deps);
        const result = await useCase('user-1', 'artist-missing');

        assert.equal(result, null);
    });

    describe('getFollowing', () => {
        it('returns artists and queues profile image task', async () => {
            const { createGetFollowingUseCase } = await import('../src/features/artists/usecases/getFollowing.js');
            const fakeRequestDeduper = {
                async run<T>(_key: string, worker: () => Promise<T>): Promise<T> { return worker(); },
            };
            const summaries: Record<string, import('../src/utils/types/followedArtistTypes.js').FollowedArtistSummary> = {
                'artist-1': { id: 'artist-1', name: 'Artist One', refreshedAt: Date.now() },
                'artist-2': { id: 'artist-2', name: 'Artist Two', refreshedAt: Date.now() },
            };
            let queueScope = '';
            let queuedLookups: Array<{ artistId: string; artistName?: string }> = [];

            const deps: Pick<
                ArtistReadUseCaseDependencies,
                'artistDetailsGateway' | 'artistFollowingRepository' | 'artistProfileImageQueue' | 'requestDeduper'
            > = {
                artistDetailsGateway: {
                    async getArtistDetails() { throw new Error('should not run'); },
                    async getFollowedArtistSummary() { throw new Error('should not run'); },
                },
                artistFollowingRepository: {
                    async getFollowingArtistIds() { throw new Error('should not run'); },
                    async getFollowingState() {
                        return {
                            artistIds: ['artist-1', 'artist-2'],
                            artistSummaries: summaries,
                        };
                    },
                    async saveFollowedArtist() { throw new Error('should not run'); },
                    async saveFollowingArtistSummaries() { },
                    async deleteFollowedArtist() { throw new Error('should not run'); },
                },
                artistProfileImageQueue: {
                    queueArtistProfileImages() { throw new Error('should not run'); },
                    queueArtistProfileImagesWithLookups(_userId, scope, lookups) {
                        queueScope = scope;
                        queuedLookups = lookups;
                        return 'profile-task-1';
                    },
                },
                requestDeduper: fakeRequestDeduper,
            };

            const useCase = createGetFollowingUseCase(deps);
            const result = await useCase('user-1');

            assert.equal(result.artists.length, 2);
            assert.equal(result.artists[0]!.id, 'artist-1');
            assert.equal(result.artists[1]!.id, 'artist-2');
            assert.equal(result.profileImageTaskId, 'profile-task-1');
            assert.equal(queueScope, 'following');
            assert.equal(queuedLookups.length, 2);
        });

        it('returns empty artists list when following state has no artistIds', async () => {
            const { createGetFollowingUseCase } = await import('../src/features/artists/usecases/getFollowing.js');
            const fakeRequestDeduper = {
                async run<T>(_key: string, worker: () => Promise<T>): Promise<T> { return worker(); },
            };

            const deps: Pick<
                ArtistReadUseCaseDependencies,
                'artistDetailsGateway' | 'artistFollowingRepository' | 'artistProfileImageQueue' | 'requestDeduper'
            > = {
                artistDetailsGateway: {
                    async getArtistDetails() { throw new Error('should not run'); },
                    async getFollowedArtistSummary() { throw new Error('should not run'); },
                },
                artistFollowingRepository: {
                    async getFollowingArtistIds() { throw new Error('should not run'); },
                    async getFollowingState() {
                        return { artistIds: [], artistSummaries: {} };
                    },
                    async saveFollowedArtist() { throw new Error('should not run'); },
                    async saveFollowingArtistSummaries() { },
                    async deleteFollowedArtist() { throw new Error('should not run'); },
                },
                artistProfileImageQueue: {
                    queueArtistProfileImages() { throw new Error('should not run'); },
                    queueArtistProfileImagesWithLookups(_userId, _scope, _lookups) {
                        return 'profile-task-empty';
                    },
                },
                requestDeduper: fakeRequestDeduper,
            };

            const useCase = createGetFollowingUseCase(deps);
            const result = await useCase('user-1');

            assert.equal(result.artists.length, 0);
            assert.equal(result.profileImageTaskId, 'profile-task-empty');
        });

        it('refetches stale summaries and persists them, swallowing persistence errors', async () => {
            const { createGetFollowingUseCase } = await import('../src/features/artists/usecases/getFollowing.js');
            const fakeRequestDeduper = {
                async run<T>(_key: string, worker: () => Promise<T>): Promise<T> { return worker(); },
            };
            const staleSummary: import('../src/utils/types/followedArtistTypes.js').FollowedArtistSummary = {
                id: 'artist-1',
                name: 'Old Name',
                refreshedAt: 1,
            };
            const freshSummary: import('../src/utils/types/followedArtistTypes.js').FollowedArtistSummary = {
                id: 'artist-1',
                name: 'Fresh Name',
                refreshedAt: Date.now(),
            };
            const persistedSummaries: import('../src/utils/types/followedArtistTypes.js').FollowedArtistSummary[] = [];

            const deps: Pick<
                ArtistReadUseCaseDependencies,
                'artistDetailsGateway' | 'artistFollowingRepository' | 'artistProfileImageQueue' | 'requestDeduper'
            > = {
                artistDetailsGateway: {
                    async getArtistDetails() { throw new Error('should not run'); },
                    async getFollowedArtistSummary() { return freshSummary; },
                },
                artistFollowingRepository: {
                    async getFollowingArtistIds() { throw new Error('should not run'); },
                    async getFollowingState() {
                        return {
                            artistIds: ['artist-1'],
                            artistSummaries: { 'artist-1': staleSummary },
                        };
                    },
                    async saveFollowedArtist() { throw new Error('should not run'); },
                    async saveFollowingArtistSummaries(_userId, summaries) {
                        persistedSummaries.push(...summaries);
                        throw new Error('persistence failed — should be swallowed');
                    },
                    async deleteFollowedArtist() { throw new Error('should not run'); },
                },
                artistProfileImageQueue: {
                    queueArtistProfileImages() { throw new Error('should not run'); },
                    queueArtistProfileImagesWithLookups() { return 'profile-task-1'; },
                },
                requestDeduper: fakeRequestDeduper,
            };

            const useCase = createGetFollowingUseCase(deps);
            const result = await useCase('user-1');

            // Should still return the fresh name despite persistence failure
            assert.equal(result.artists.length, 1);
            assert.equal(result.artists[0]!.name, 'Fresh Name');
            assert.equal(persistedSummaries.length, 1);
            assert.equal(persistedSummaries[0]!.name, 'Fresh Name');
        });
    });

    describe('searchArtists', () => {
        it('returns search results with profile image task ID', async () => {
            const { createSearchArtistsUseCase } = await import('../src/features/artists/usecases/searchArtists.js');
            const fakeRequestDeduper = {
                async run<T>(_key: string, worker: () => Promise<T>): Promise<T> { return worker(); },
            };
            let queuedScope = '';
            let queuedLookups: Array<{ artistId: string; artistName?: string }> = [];

            const deps: Pick<
                ArtistReadUseCaseDependencies,
                'artistProfileImageQueue' | 'artistSearchGateway' | 'requestDeduper'
            > = {
                artistProfileImageQueue: {
                    queueArtistProfileImages() { throw new Error('should not run'); },
                    queueArtistProfileImagesWithLookups(_userId, scope, lookups) {
                        queuedScope = scope;
                        queuedLookups = lookups;
                        return 'search-task-1';
                    },
                },
                artistSearchGateway: {
                    async searchArtists(_userId, _query, _offset, _limit) {
                        return {
                            artists: [
                                { id: 'artist-1', name: 'Band One', type: 'Group', disambiguation: null, aliases: [], members: [], externalLinks: [], lifeSpan: { begin: null, end: null, ended: false }, beginArea: { name: null } },
                                { id: 'artist-2', name: 'Band Two', type: 'Group', disambiguation: null, aliases: [], members: [], externalLinks: [], lifeSpan: { begin: null, end: null, ended: false }, beginArea: { name: null } },
                            ],
                            count: 2,
                            offset: 0,
                        };
                    },
                },
                requestDeduper: fakeRequestDeduper,
            };

            const useCase = createSearchArtistsUseCase(deps);
            const result = await useCase('user-1', 'band', 0, 25);

            assert.equal(result.count, 2);
            assert.equal(result.artists.length, 2);
            assert.equal(result.artists[0]!.name, 'Band One');
            assert.equal(result.profileImageTaskId, 'search-task-1');
            assert.ok(queuedScope.startsWith('search:band'));
            assert.equal(queuedLookups.length, 2);
            assert.equal(queuedLookups[0]!.artistId, 'artist-1');
        });
    });
});
