import type { Release } from '../../../modules/models/models.js';
import type { ReleaseReadUseCaseDependencies } from '../ports.js';

type GetReleaseResult = {
    release: Release;
    lyricsTaskId: string;
    profileImageTaskId: string;
} | null;

export const createGetReleaseUseCase = ({
    releaseCatalogGateway,
    releaseTaskQueue,
    requestDeduper,
}: Pick<
    ReleaseReadUseCaseDependencies,
    'releaseCatalogGateway' | 'releaseTaskQueue' | 'requestDeduper'
>) => async (
    userId: string,
    releaseId: string,
): Promise<GetReleaseResult> => {
    const release = await requestDeduper.run(
        `getRelease:${releaseId}`,
        async () => await releaseCatalogGateway.getRelease(releaseId),
    );

    if (!release) {
        return null;
    }

    return {
        release,
        lyricsTaskId: releaseTaskQueue.queueReleaseTrackLyrics(userId, release, undefined),
        profileImageTaskId: releaseTaskQueue.queueReleaseArtistProfileImages(userId, release, undefined),
    };
};
