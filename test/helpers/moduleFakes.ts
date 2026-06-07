import { createRequire } from 'node:module';

const requireForTest = createRequire(__filename);

export const installModuleFake = (
    modulePathFromHelper: string,
    exports: Record<string, unknown>,
): void => {
    const modulePath = requireForTest.resolve(modulePathFromHelper);

    requireForTest.cache[modulePath] = {
        id: modulePath,
        filename: modulePath,
        loaded: true,
        exports,
    } as NodeModule;
};

const unexpectedFirebaseCall = (name: string) => async (): Promise<never> => {
    throw new Error(`Unexpected Firebase store ${name} call in unit test`);
};

export const installFirebaseServiceFake = (): void => {
    installModuleFake('../../src/services/firebase/followingStore.js', {
        getFollowingFromDb: unexpectedFirebaseCall('getFollowingFromDb'),
    });
    installModuleFake('../../src/services/firebase/knownReleasesStore.js', {
        getKnownArtistReleaseIdsFromDb: unexpectedFirebaseCall('getKnownArtistReleaseIdsFromDb'),
        getKnownReleasesFromDb: unexpectedFirebaseCall('getKnownReleasesFromDb'),
    });
    installModuleFake('../../src/services/firebase/newReleasesStore.js', {
        getNewReleasesSnapshotFromDb: unexpectedFirebaseCall('getNewReleasesSnapshotFromDb'),
        removeNewReleasesFromDb: unexpectedFirebaseCall('removeNewReleasesFromDb'),
    });
};
