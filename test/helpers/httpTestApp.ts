import { createRequire } from 'node:module';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';

const requireForTest = createRequire(__filename);

const installModuleFake = (
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

type FakeCheckAuth = (req: { headers: { authorization?: string } }) => Promise<string>;

let fakeCheckAuth: FakeCheckAuth = async (req) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
        throw new Error('Unauthorized');
    }
    return 'test-user-id';
};

export const setFakeCheckAuth = (fn: FakeCheckAuth): void => {
    fakeCheckAuth = fn;
};

export const installAllFakes = (): void => {
    // Fake Firebase admin initialization
    const mockAdmin = {
        apps: [{ name: '[DEFAULT]' }],
        app: () => mockAdmin.apps[0],
        initializeApp: () => mockAdmin.apps[0],
        credential: {
            cert: () => ({}),
        },
        auth: () => ({
            verifyIdToken: async (token: string) => {
                if (token === 'valid-token') {
                    return { uid: 'test-user-id' };
                }
                throw new Error('Invalid token');
            },
            getUser: async (uid: string) => ({
                uid,
                email: 'test@example.com',
                emailVerified: true,
                displayName: 'Test User',
            }),
            setCustomUserClaims: async () => { },
            updateUser: async (_uid: string, _props: unknown) => ({}),
            deleteUser: async () => { },
        }),
        firestore: () => ({
            collection: () => ({
                doc: () => ({
                    get: async () => ({ exists: false, data: () => null }),
                    set: async () => { },
                    update: async () => { },
                    delete: async () => { },
                }),
            }),
        }),
        database: () => ({
            ref: () => ({
                once: async () => ({ val: () => null }),
                set: async () => { },
                remove: async () => { },
            }),
        }),
    };
    installModuleFake('../../src/infrastructure/firebase/firebaseInit.js', {
        default: mockAdmin,
        db: mockAdmin.firestore(),
        rtdb: mockAdmin.database(),
    });

    // Fake userStore (checkAuth, deleteUserAccount, etc.)
    installModuleFake('../../src/services/firebase/userStore.js', {
        checkAuth: async (req: { headers: { authorization?: string } }) => fakeCheckAuth(req),
        deleteUserAccount: async () => { },
        getDocumentRefAndSnapshot: async () => ({
            snapShot: {},
            ref: { get: async () => ({ exists: false, data: () => null }), set: async () => { } },
        }),
    });

    // Fake account services
    installModuleFake('../../src/services/account/accountIdentityService.js', {
        changeEmail: async () => { },
        revokeToken: async () => { },
    });
    installModuleFake('../../src/services/account/passwordResetOtpService.js', {
        sendOtp: async () => { },
        verifyOtp: async () => ({ email: 'test@example.com' }),
    });

    // Fake Firebase stores
    installModuleFake('../../src/services/firebase/followingStore.js', {
        getFollowingFromDb: async () => [],
    });
    installModuleFake('../../src/services/firebase/knownReleasesStore.js', {
        getKnownArtistReleaseIdsFromDb: async () => [],
        getKnownReleasesFromDb: async () => ({}),
    });
    installModuleFake('../../src/services/firebase/newReleasesStore.js', {
        getNewReleasesSnapshotFromDb: async () => ({ newReleasesMap: {}, coverPageEntries: [] }),
        removeNewReleasesFromDb: async () => { },
    });
    installModuleFake('../../src/services/firebase/pushTokenStore.js', {
        deleteUserPushTokensFromDb: async () => { },
        savePushTokenToDb: async () => { },
        deletePushTokenFromDb: async () => { },
    });
    installModuleFake('../../src/services/firebase/notificationRunLockStore.js', {
        acquireNotifyNewReleasesLock: async () => true,
        releaseNotifyNewReleasesLock: async () => { },
    });

    // Fake Firebase refs
    installModuleFake('../../src/services/firebase/refs.js', {
        getUserRef: () => ({
            get: async () => ({ exists: false, data: () => null }),
            set: async () => { },
            update: async () => { },
        }),
    });

    // Fake Firebase types
    installModuleFake('../../src/services/firebase/types.js', {
        RequestWithAuthHeader: {},
        UNAUTH_MESSAGE: 'Unauthorized',
    });

    // Fake userStoreAdapter
    installModuleFake('../../src/services/notifications/pushTokenStoreAdapter.js', {
        savePushToken: async () => { },
        deletePushToken: async () => { },
    });

    // Fake Dapr modules
    installModuleFake('../../src/infrastructure/dapr/daprStateStore.js', {
        getStateValue: async () => null,
        saveStateValues: async () => { },
        deleteStateValues: async () => { },
    });
    installModuleFake('../../src/infrastructure/dapr/daprClient.js', {
        daprClient: {},
    });
    installModuleFake('../../src/infrastructure/dapr/daprSecrets.js', {
        getSecret: async () => '',
    });
    installModuleFake('../../src/infrastructure/dapr/daprBindings.js', {
        sendBinding: async () => { },
    });
    installModuleFake('../../src/infrastructure/dapr/daprLockStore.js', {
        acquireLock: async () => true,
        releaseLock: async () => { },
    });
    installModuleFake('../../src/infrastructure/dapr/daprHttp.js', {
        daprHttpFetch: async () => new Response(''),
    });

    // Fake Sentry
    installModuleFake('../../src/infrastructure/monitoring/sentry.js', {
        setupExpressErrorMonitoring: () => { },
        captureException: () => { },
    });
};

let testServer: Server | undefined;

export const startTestServer = async (app?: express.Express): Promise<string> => {
    const testApp = app ?? express();
    const listener = await new Promise<Server>((resolve, reject) => {
        const instance = testApp.listen(0, '127.0.0.1', (error?: Error) => {
            if (error) {
                reject(error);
                return;
            }
            resolve(instance);
        });
    });
    testServer = listener;

    const address = listener.address() as AddressInfo;
    return `http://127.0.0.1:${address.port}`;
};

export const stopTestServer = async (): Promise<void> => {
    if (!testServer) {
        return;
    }

    await new Promise<void>((resolve, reject) => {
        testServer?.close((error) => {
            if (error) {
                reject(error);
                return;
            }
            resolve();
        });
    });
    testServer = undefined;
};
