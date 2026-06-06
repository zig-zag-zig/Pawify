import { createRequire } from 'node:module';

const requireForTest = createRequire(__filename);

const unexpectedFirebaseCall = (name: string) => async (): Promise<never> => {
    throw new Error(`Unexpected firebaseService.${name} call in unit test`);
};

export const installFirebaseServiceFake = (): void => {
    const modulePath = requireForTest.resolve('../../src/services/firebaseService.js');

    requireForTest.cache[modulePath] = {
        id: modulePath,
        filename: modulePath,
        loaded: true,
        exports: {
            getKnownArtistReleaseIdsFromDb: unexpectedFirebaseCall('getKnownArtistReleaseIdsFromDb'),
            getKnownReleasesFromDb: unexpectedFirebaseCall('getKnownReleasesFromDb'),
            getNewReleasesSnapshotFromDb: unexpectedFirebaseCall('getNewReleasesSnapshotFromDb'),
            removeNewReleasesFromDb: unexpectedFirebaseCall('removeNewReleasesFromDb'),
        },
    } as NodeModule;
};
