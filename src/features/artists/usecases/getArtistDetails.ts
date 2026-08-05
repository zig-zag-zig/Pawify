import type { Artist } from '../../../modules/models/models.js';
import { mapArtistToProfileImageLookup } from '../domain/profileImageLookups.js';
import type { ArtistReadUseCaseDependencies } from '../ports.js';

type GetArtistDetailsResult = {
    artist: Artist;
    profileImageTaskId: string | null;
    profileImages: Record<string, string | null>;
} | null;

export const createGetArtistDetailsUseCase = ({
    artistDetailsGateway,
    assetPlanner,
    cacheTtlGateway,
    requestDeduper,
}: Pick<
    ArtistReadUseCaseDependencies,
    | 'artistDetailsGateway'
    | 'assetPlanner'
    | 'cacheTtlGateway'
    | 'requestDeduper'
>) => async (
    userId: string,
    artistId: string,
): Promise<GetArtistDetailsResult> => {
    const ttl = await cacheTtlGateway.getArtistTtl(userId, artistId);
    const artist = await requestDeduper.run(
        `getArtistDetails:${userId}:${artistId}`,
        async () => await artistDetailsGateway.getArtistDetails(userId, artistId, {
            skipTtlLookup: true,
            cacheTtlOverride: ttl,
        }),
    );

    if (!artist) {
        return null;
    }

    const lookup = mapArtistToProfileImageLookup(artistId, artist);
    const plan = await assetPlanner.planArtistProfileImages({
        userId,
        scope: 'artist_details',
        lookups: [lookup],
        ttl,
    });

    return {
        artist,
        profileImages: plan.resolved,
        profileImageTaskId: plan.taskId,
    };
};
