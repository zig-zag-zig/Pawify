import type { ReleaseUseCaseDependencies } from '../../src/features/releases/ports.js';
import type { ReleaseGroupReleasesPageEntry } from '../../src/utils/types/taskTypes.js';

type GetNewReleasesDependencies = Pick<
    ReleaseUseCaseDependencies,
    'newReleasesRepository' | 'releaseTaskQueue'
>;

type NewReleasesSnapshot = Awaited<
    ReturnType<GetNewReleasesDependencies['newReleasesRepository']['getNewReleasesSnapshot']>
>;

export const createGetNewReleasesDependencies = (snapshot: NewReleasesSnapshot) => {
    const queueCalls: Array<{ userId: string; releaseIds: string[] }> = [];

    const dependencies: GetNewReleasesDependencies = {
        newReleasesRepository: {
            async getNewReleasesSnapshot() {
                return snapshot;
            },
            async deleteNewReleases() {},
        },
        releaseTaskQueue: {
            addTaskUser() {},
            queueArtistReleaseGroupCovers() {
                return 'unused';
            },
            queueReleaseGroupReleaseCovers() {
                return 'unused';
            },
            queueNewReleaseCovers(userId, pageEntries: ReleaseGroupReleasesPageEntry[]) {
                queueCalls.push({
                    userId,
                    releaseIds: pageEntries.flatMap(entry => entry.releaseIds),
                });
                return 'cover-task-1';
            },
            queueReleaseTrackLyrics() {
                return 'unused';
            },
            queueReleaseArtistProfileImages() {
                return 'unused';
            },
        },
    };

    return {
        dependencies,
        queueCalls,
    };
};
