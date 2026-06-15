/**
 * Firebase emulator integration tests.
 *
 * These tests require the Firebase emulators to be running:
 *   npm run test:emulator
 *
 * The emulators provide real Firebase behavior without touching production data.
 * When emulators are not running, all tests are skipped automatically.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import * as admin from 'firebase-admin';

const AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';

const emulatorAvailable = async (): Promise<boolean> => {
    try {
        const response = await fetch(`http://${AUTH_EMULATOR_HOST}/`);
        return response.ok || response.status === 404;
    } catch {
        return false;
    }
};

let app: admin.app.App;

const getAuth = () => app.auth();
const getFirestore = () => app.firestore();

beforeEach(async () => {
    if (!(await emulatorAvailable())) {
        return;
    }
    if (!admin.apps.length) {
        app = admin.initializeApp({
            projectId: 'pawify-test',
        });
    } else {
        app = admin.app();
    }
});

afterEach(async () => {
    if (!app) return;
    // Clean up test users
    try {
        const listResult = await getAuth().listUsers();
        for (const user of listResult.users) {
            await getAuth().deleteUser(user.uid);
        }
    } catch {
        // Emulator may already be torn down
    }
});

describe('Firebase Auth emulator', { skip: !process.env.FIREBASE_AUTH_EMULATOR_HOST }, () => {
    it('creates a user and retrieves by uid', async () => {
        const user = await getAuth().createUser({
            email: 'test@example.com',
            password: 'password123',
        });

        assert.ok(user.uid);
        assert.equal(user.email, 'test@example.com');

        const fetched = await getAuth().getUser(user.uid);
        assert.equal(fetched.uid, user.uid);
        assert.equal(fetched.email, 'test@example.com');
    });

    it('creates a custom token for a user', async () => {
        const user = await getAuth().createUser({
            email: 'token-test@example.com',
        });

        const customToken = await getAuth().createCustomToken(user.uid);
        assert.ok(typeof customToken === 'string');
        assert.ok(customToken.length > 0);
    });

    it('deletes a user', async () => {
        const user = await getAuth().createUser({
            email: 'delete-test@example.com',
        });

        await getAuth().deleteUser(user.uid);

        await assert.rejects(
            () => getAuth().getUser(user.uid),
            (error) => error instanceof Error && (error as any).code === 'auth/user-not-found',
        );
    });

    it('sets custom claims on a user', async () => {
        const user = await getAuth().createUser({
            email: 'claims-test@example.com',
        });

        await getAuth().setCustomUserClaims(user.uid, { admin: true });

        const fetched = await getAuth().getUser(user.uid);
        assert.deepEqual(fetched.customClaims, { admin: true });
    });
});

describe('Firestore emulator', { skip: !process.env.FIREBASE_AUTH_EMULATOR_HOST }, () => {
    const collectionName = 'test-collection';

    afterEach(async () => {
        // Clean up test documents
        try {
            const snapshot = await getFirestore().collection(collectionName).get();
            const batch = getFirestore().batch();
            for (const doc of snapshot.docs) {
                batch.delete(doc.ref);
            }
            await batch.commit();
        } catch {
            // Emulator may already be torn down
        }
    });

    it('writes and reads a document', async () => {
        const ref = getFirestore().collection(collectionName).doc('test-doc');
        await ref.set({ name: 'Test', value: 42 });

        const snapshot = await ref.get();
        assert.ok(snapshot.exists);
        assert.deepEqual(snapshot.data(), { name: 'Test', value: 42 });
    });

    it('updates a document', async () => {
        const ref = getFirestore().collection(collectionName).doc('update-doc');
        await ref.set({ name: 'Original', count: 1 });
        await ref.update({ count: 2 });

        const snapshot = await ref.get();
        const data = snapshot.data();
        assert.equal(data?.name, 'Original');
        assert.equal(data?.count, 2);
    });

    it('deletes a document', async () => {
        const ref = getFirestore().collection(collectionName).doc('delete-doc');
        await ref.set({ name: 'ToDelete' });
        await ref.delete();

        const snapshot = await ref.get();
        assert.ok(!snapshot.exists);
    });

    it('queries documents with where filter', async () => {
        const col = getFirestore().collection(collectionName);
        await col.doc('a').set({ type: 'fruit', name: 'apple' });
        await col.doc('b').set({ type: 'fruit', name: 'banana' });
        await col.doc('c').set({ type: 'vegetable', name: 'carrot' });

        const snapshot = await col.where('type', '==', 'fruit').get();
        assert.equal(snapshot.size, 2);

        const names = snapshot.docs.map((doc) => doc.data()?.name).sort();
        assert.deepEqual(names, ['apple', 'banana']);
    });

    it('handles nested document data', async () => {
        const ref = getFirestore().collection(collectionName).doc('nested-doc');
        const data = {
            user: {
                name: 'Test User',
                settings: {
                    notifications: true,
                    theme: 'dark',
                },
            },
            tags: ['music', 'artist'],
        };
        await ref.set(data);

        const snapshot = await ref.get();
        assert.deepEqual(snapshot.data(), data);
    });
});
