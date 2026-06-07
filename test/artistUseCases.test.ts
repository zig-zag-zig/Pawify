import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { installFirebaseServiceFake } from './helpers/moduleFakes.js';
import type { ArtistWriteUseCaseDependencies } from '../src/features/artists/ports.js';
import type { FollowedArtistSummary } from '../src/utils/types/followedArtistTypes.js';

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
});
