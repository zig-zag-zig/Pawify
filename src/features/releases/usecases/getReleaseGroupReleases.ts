import type { ReleaseGroupReleaseListItem } from '../../../modules/models/models.js';
import type { ReleaseReadUseCaseDependencies } from '../ports.js';

type GetReleaseGroupReleasesResult = {
    releases: ReleaseGroupReleaseListItem[];
    releaseCoverTaskId: string;
};

export const createGetReleaseGroupReleasesUseCase = ({
    releaseCatalogGateway,
    releaseTaskQueue,
    requestDeduper,
}: Pick<
    ReleaseReadUseCaseDependencies,
    'releaseCatalogGateway' | 'releaseTaskQueue' | 'requestDeduper'
>) => async (
    userId: string,
    releaseGroupId: string,
): Promise<GetReleaseGroupReleasesResult> => {
    const payload = await requestDeduper.run(
        `getReleaseGroupReleases:${userId}:${releaseGroupId}`,
        async () => {
            const ttl: number | undefined = undefined;
            const coverPageEntries: { releaseGroupId: string; releaseIds: string[] }[] = [];

            const releases = await releaseCatalogGateway.getReleaseGroupReleases(releaseGroupId, ttl, async (groupId, releaseIds) => {
                coverPageEntries.push({
                    releaseGroupId: groupId,
                    releaseIds,
                });
            });

            const releaseCoverTaskId = releaseTaskQueue.queueReleaseGroupReleaseCovers(
                userId,
                releaseGroupId,
                coverPageEntries,
                ttl,
            );

            return {
                releases,
                releaseCoverTaskId,
            };
        },
    );

    releaseTaskQueue.addTaskUser(payload.releaseCoverTaskId, userId);
    return payload;
};
