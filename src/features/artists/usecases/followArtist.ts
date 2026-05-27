import type { ArtistWriteUseCaseDependencies } from '../ports.js';
import { artistCacheTtlHours } from '../../../utils/helpers/followingHelper.js';

const getSummaryDiscogsUrls = (
    summary: { id: string; name: string } | null,
): string[] | undefined => {
    if (!summary) {
        return undefined;
    }

    const candidate = summary as typeof summary & {
        discogsUrls?: unknown;
    };

    if (!Array.isArray(candidate.discogsUrls)) {
        return undefined;
    }

    const urls = candidate.discogsUrls
        .filter((url): url is string => typeof url === 'string' && url.trim().length > 0);

    return urls.length > 0 ? urls : undefined;
};

export const createFollowArtistUseCase = ({
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
>) => async (
    userId: string,
    artistId: string,
    sourcePushToken?: string,
): Promise<void> => {
    const artistSummary = await artistDetailsGateway.getFollowedArtistSummary(userId, artistId, {
        skipTtlLookup: true,
    });
    const ttl = await cacheTtlGateway.getArtistTtl(userId, artistId);
    const releaseIds = await artistReleaseCatalogGateway.getArtistReleaseIds(artistId, ttl);

    await artistFollowingRepository.saveFollowedArtist(userId, artistId, releaseIds, artistSummary ?? undefined);
    artistProfileImageQueue.queueArtistProfileImagesWithLookups(
        userId,
        'follow_artist',
        [{
            artistId,
            artistName: artistSummary?.name,
            discogsUrls: getSummaryDiscogsUrls(artistSummary),
        }],
        artistCacheTtlHours,
    );

    await followingNotifier.notifyFollowingChanged(userId, sourcePushToken);
};
