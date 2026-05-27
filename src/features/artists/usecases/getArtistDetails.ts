import type { Artist } from '../../../modules/models/models.js';
import { getExternalLinkUrlsByService } from '../../../utils/helpers/externalLinks.js';
import type { ArtistReadUseCaseDependencies } from '../ports.js';

type GetArtistDetailsResult = {
    artist: Artist;
    profileImageTaskId: string;
} | null;

export const createGetArtistDetailsUseCase = ({
    artistDetailsGateway,
    artistProfileImageQueue,
    cacheTtlGateway,
    requestDeduper,
}: Pick<
    ArtistReadUseCaseDependencies,
    | 'artistDetailsGateway'
    | 'artistProfileImageQueue'
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

    return {
        artist,
        profileImageTaskId: artistProfileImageQueue.queueArtistProfileImagesWithLookups(
            userId,
            'artist_details',
            [{
                artistId,
                artistName: artist.name,
                discogsUrls: getExternalLinkUrlsByService(artist.externalLinks, 'discogs'),
            }],
            ttl,
        ),
    };
};
