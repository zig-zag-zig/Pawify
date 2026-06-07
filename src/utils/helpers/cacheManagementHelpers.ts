import { deleteArtistFromDb } from '../../services/firebase/artistStore.js';
import { getFollowingFromDb } from '../../services/firebase/followingStore.js';
import { removeNewReleasesFromDb } from '../../services/firebase/newReleasesStore.js';
import { invalidateFollowingArtistIdsCache, syncFollowingArtistIds } from './followingHelper.js';

export const deleteNewReleases = async (userId: string, releaseIds: string[]): Promise<void> => {
    await removeNewReleasesFromDb(userId, releaseIds);
};

export const deleteArtist = async (userId: string, artistId: string): Promise<void> => {
    await deleteArtistFromDb(userId, artistId);
    invalidateFollowingArtistIdsCache(userId);
    await syncFollowingArtistIds(userId, await getFollowingFromDb(userId));
};
