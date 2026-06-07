import type { NewRelease, NewReleasesResult } from '../../../modules/models/models.js';
import { sortNewReleasesNewestFirst } from '../domain/newReleaseSorting.js';
import type { NewReleasesById, ReleaseUseCaseDependencies } from '../ports.js';

const flattenNewReleasesMap = (newReleasesMap: NewReleasesById): NewRelease[] => {
    return Object.values(newReleasesMap);
};

export const createGetNewReleasesUseCase = ({
    newReleasesRepository,
    releaseTaskQueue,
}: Pick<ReleaseUseCaseDependencies, 'newReleasesRepository' | 'releaseTaskQueue'>) => async (
    userId: string,
): Promise<NewReleasesResult> => {
    const snapshot = await newReleasesRepository.getNewReleasesSnapshot(userId);
    const releases = sortNewReleasesNewestFirst(flattenNewReleasesMap(snapshot.newReleasesMap));

    return {
        releases,
        releaseCoverTaskId: releaseTaskQueue.queueNewReleaseCovers(
            userId,
            snapshot.coverPageEntries,
            undefined,
        ),
    };
};
