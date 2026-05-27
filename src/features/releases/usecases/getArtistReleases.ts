import type { CachedArtistReleases } from '../../../utils/types/cacheTypes.js';
import type { ReleaseReadUseCaseDependencies } from '../ports.js';

type GetArtistReleasesResult = {
    releaseGroups: CachedArtistReleases;
    releaseGroupCoverTaskId: string;
};

export const createGetArtistReleasesUseCase = ({
    artistReleaseContextGateway,
    releaseCatalogGateway,
    releaseTaskQueue,
    requestDeduper,
}: Pick<
    ReleaseReadUseCaseDependencies,
    'artistReleaseContextGateway' | 'releaseCatalogGateway' | 'releaseTaskQueue' | 'requestDeduper'
>) => async (
    userId: string,
    artistId: string,
): Promise<GetArtistReleasesResult> => {
    const payload = await requestDeduper.run(`getArtistReleases:${userId}:${artistId}`, async () => {
        const ttl = await artistReleaseContextGateway.getArtistTtl(userId, artistId);
        const releaseGroups = await releaseCatalogGateway.getArtistReleases(
            artistId,
            ttl,
            async () => { },
        );
        const releaseGroupCoverTaskId = releaseTaskQueue.queueArtistReleaseGroupCovers(
            userId,
            artistId,
            releaseGroups.map(group => ({
                releaseGroupId: group.id,
                releaseIds: group.releaseIds,
            })),
            ttl,
        );

        return {
            releaseGroups,
            releaseGroupCoverTaskId,
        };
    });

    releaseTaskQueue.addTaskUser(payload.releaseGroupCoverTaskId, userId);
    return payload;
};
