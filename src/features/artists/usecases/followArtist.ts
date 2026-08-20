import type { ArtistWriteUseCaseDependencies } from '../ports.js';
import { artistCacheTtlHours } from '../../../utils/helpers/followingHelper.js';
import { mapArtistSummaryToProfileImageLookup } from '../domain/profileImageLookups.js';

export const createFollowArtistUseCase =
    ({
        artistDetailsGateway,
        artistFollowingRepository,
        artistReleaseCatalogGateway,
        artistProfileImageQueue,
        cacheTtlGateway,
        followingNotifier,
    }: Pick<
        ArtistWriteUseCaseDependencies,
        | 'artistDetailsGateway'
        | 'artistFollowingRepository'
        | 'artistReleaseCatalogGateway'
        | 'artistProfileImageQueue'
        | 'cacheTtlGateway'
        | 'followingNotifier'
    >) =>
    async (userId: string, artistId: string, sourcePushToken?: string): Promise<void> => {
        const artistSummary = await artistDetailsGateway.getFollowedArtistSummary(
            userId,
            artistId,
            {
                skipTtlLookup: true,
            },
        );
        const ttl = await cacheTtlGateway.getArtistTtl(userId, artistId);
        const releaseIds = await artistReleaseCatalogGateway.getArtistReleaseIds(artistId, ttl);

        await artistFollowingRepository.saveFollowedArtist(
            userId,
            artistId,
            releaseIds,
            artistSummary ?? undefined,
        );
        artistProfileImageQueue.queueArtistProfileImagesWithLookups(
            userId,
            'follow_artist',
            artistSummary ? [mapArtistSummaryToProfileImageLookup(artistSummary)] : [{ artistId }],
            artistCacheTtlHours,
        );

        await followingNotifier.notifyFollowingChanged(userId, sourcePushToken);
    };
