import type { ArtistWriteUseCaseDependencies } from '../ports.js';

export const createUnfollowArtistsUseCase = ({
    artistFollowingRepository,
    followingNotifier,
}: Pick<
    ArtistWriteUseCaseDependencies,
    'artistFollowingRepository' | 'followingNotifier'
>) => {
    const unfollowSingleArtist = async (userId: string, artistId: string): Promise<void> => {
        await artistFollowingRepository.deleteFollowedArtist(userId, artistId);
    };

    return async (
        userId: string,
        artistIds: string[],
        sourcePushToken?: string,
    ): Promise<void> => {
        for (const artistId of artistIds) {
            await unfollowSingleArtist(userId, artistId);
        }

        await followingNotifier.notifyFollowingChanged(userId, sourcePushToken);
    };
};
