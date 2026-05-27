import { authenticatedHandler } from '../../../infrastructure/http/authenticatedHandler.js';
import {
    optionalIntegerInRange,
    optionalPositiveInteger,
    optionalString,
    requireString,
    requireStringArray,
} from '../../../common/http/validation.js';
import { NotFoundError } from '../../../common/http/errors.js';
import { artistUseCases } from '../artistUseCases.js';

export const getFollowingHandler = authenticatedHandler('/getFollowing', async ({ res, userId }) => {
    res.status(200).send(await artistUseCases.getFollowing(userId));
});

export const getArtistDetailsHandler = authenticatedHandler('/getArtistDetails', async ({ req, res, userId }) => {
    const artistId = requireString(req.body, 'artistId');
    const payload = await artistUseCases.getArtistDetails(userId, artistId);

    if (!payload) {
        throw new NotFoundError('Artist was not found in Musicbrainz');
    }

    res.status(200).send(payload);
});

export const searchArtistsHandler = authenticatedHandler('/searchArtists', async ({ req, res, userId }) => {
    const query = requireString(req.body, 'query');
    const limit = optionalIntegerInRange(req.body, 'limit', 25, 1, 100);
    const offset = optionalPositiveInteger(req.body, 'offset', 0);

    res.status(200).send(await artistUseCases.searchArtists(userId, query, offset, limit));
});

export const followArtistHandler = authenticatedHandler('/followArtist', async ({ req, res, userId }) => {
    const artistId = requireString(req.body, 'artistId');
    const sourcePushToken = optionalString(req.body, 'sourcePushToken');

    await artistUseCases.followArtist(userId, artistId, sourcePushToken);
    res.status(200).send('Artist and releases saved successfully.');
});

export const unfollowArtistHandler = authenticatedHandler('/unfollowArtist', async ({ req, res, userId }) => {
    const artistId = requireString(req.body, 'artistId');
    const sourcePushToken = optionalString(req.body, 'sourcePushToken');

    await artistUseCases.unfollowArtists(userId, [artistId], sourcePushToken);
    res.status(200).send(`Artist ${artistId} and their releases deleted successfully.`);
});

export const unfollowArtistsHandler = authenticatedHandler('/unfollowArtists', async ({ req, res, userId }) => {
    const artistIds = requireStringArray(req.body, 'artistIds');
    const sourcePushToken = optionalString(req.body, 'sourcePushToken');

    await artistUseCases.unfollowArtists(userId, artistIds, sourcePushToken);
    res.status(200).send(`Successfully unfollowed ${artistIds.length} artists.`);
});
