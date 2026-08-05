import type { CachedArtistReleases } from '../../../utils/types/cacheTypes.js';
import type { ReleaseReadUseCaseDependencies } from '../ports.js';
import type { ReleaseGroupPageEntry } from '../../../utils/types/taskTypes.js';

type GetArtistReleasesResult = {
    releaseGroups: CachedArtistReleases;
    releaseGroupCoverTaskId: string | null;
    releaseGroupCovers: Record<string, string | null>;
};

export const createGetArtistReleasesUseCase = ({
    artistReleaseContextGateway,
    releaseCatalogGateway,
    releaseTaskQueue,
    assetPlanner,
    requestDeduper,
}: Pick<
    ReleaseReadUseCaseDependencies,
    | 'artistReleaseContextGateway'
    | 'releaseCatalogGateway'
    | 'releaseTaskQueue'
    | 'assetPlanner'
    | 'requestDeduper'
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
        return {
            releaseGroups,
            ttl,
        };
    });

    const pageEntries: ReleaseGroupPageEntry[] = payload.releaseGroups.map(group => ({
        releaseGroupId: group.id,
        releaseIds: group.releaseIds,
    }));

    const plan = await assetPlanner.planArtistReleaseGroupCovers({
        userId,
        artistId,
        pageEntries,
        ttl: payload.ttl,
    });

    if (plan.taskId !== null) {
        releaseTaskQueue.addTaskUser(plan.taskId, userId);
    }

    return {
        releaseGroups: payload.releaseGroups,
        releaseGroupCovers: plan.resolved,
        releaseGroupCoverTaskId: plan.taskId,
    };
};
