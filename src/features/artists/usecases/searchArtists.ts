import type { ArtistSearchResult } from '../../../modules/models/models.js';
import { transientArtistCacheTtlHours } from '../../../utils/helpers/followingHelper.js';
import type { ArtistReadUseCaseDependencies } from '../ports.js';

export type SearchArtistsResult = ArtistSearchResult & {
    profileImageTaskId: string;
};

export const createSearchArtistsUseCase = ({
    artistProfileImageQueue,
    artistSearchGateway,
    requestDeduper,
}: Pick<
    ArtistReadUseCaseDependencies,
    'artistProfileImageQueue' | 'artistSearchGateway' | 'requestDeduper'
>) => async (
    userId: string,
    query: string,
    offset: number,
    limit: number,
): Promise<SearchArtistsResult> => {
    return await requestDeduper.run(`searchArtists:${userId}:${query}:${limit}:${offset}`, async () => {
        const result = await artistSearchGateway.searchArtists(userId, query, offset, limit);
        const artistLookups = result.artists.map((artist) => ({
            artistId: artist.id,
            artistName: artist.name,
        }));

        return {
            ...result,
            profileImageTaskId: artistProfileImageQueue.queueArtistProfileImagesWithLookups(
                userId,
                `search:${query}:${limit}:${offset}`,
                artistLookups,
                transientArtistCacheTtlHours,
            ),
        };
    });
};
