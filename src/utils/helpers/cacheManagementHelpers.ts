import { deleteArtistFromDb } from '../../services/firebase/artistStore.js';

export const deleteArtist = async (userId: string, artistId: string): Promise<void> => {
    await deleteArtistFromDb(userId, artistId);
};
