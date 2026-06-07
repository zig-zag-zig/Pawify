import { NotFoundError } from '../../../common/http/errors.js';
import { authenticatedHandler } from '../../../infrastructure/http/authenticatedHandler.js';
import {
    optionalString,
    requireString,
    requireStringArray,
} from '../../../common/http/validation.js';
import { releaseUseCases } from '../releaseUseCases.js';

export const getNewReleasesHandler = authenticatedHandler('/getNewReleases', async ({ res, userId }) => {
    res.status(200).send(await releaseUseCases.getNewReleases(userId));
});

export const removeNewReleasesHandler = authenticatedHandler('/removeNewReleases', async ({ req, res, userId }) => {
    const releaseIds = requireStringArray(req.body, 'releaseIds');
    const sourcePushToken = optionalString(req.body, 'sourcePushToken');

    await releaseUseCases.removeNewReleases(userId, releaseIds, sourcePushToken);
    res.status(200).send(`Successfully removed ${releaseIds.length} new releases.`);
});

export const getArtistReleasesHandler = authenticatedHandler('/getArtistReleases', async ({ req, res, userId }) => {
    const artistId = requireString(req.body, 'artistId');

    res.status(200).send(await releaseUseCases.getArtistReleases(userId, artistId));
});

export const getReleaseGroupReleasesHandler = authenticatedHandler('/getReleaseGroupReleases', async ({ req, res, userId }) => {
    const releaseGroupId = requireString(req.body, 'releaseGroupId');

    res.status(200).send(await releaseUseCases.getReleaseGroupReleases(userId, releaseGroupId));
});

export const getReleaseHandler = authenticatedHandler('/getRelease', async ({ req, res, userId }) => {
    const releaseId = requireString(req.body, 'releaseId');
    const payload = await releaseUseCases.getRelease(userId, releaseId);

    if (!payload) {
        throw new NotFoundError('Release was not found in MusicBrainz');
    }

    res.status(200).send(payload);
});

export const verifyReleaseExistenceHandler = authenticatedHandler('/verifyReleaseExistence', async ({ req, res, userId }) => {
    const releaseId = requireString(req.body, 'releaseId');

    res.status(200).send(await releaseUseCases.verifyReleaseExistence(userId, releaseId));
});
