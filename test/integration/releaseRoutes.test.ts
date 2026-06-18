import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
    createIntegrationTestApp,
    installAllFakes,
    setFakeCheckAuth,
    stopTestServer,
} from '../helpers/httpTestApp.js';

installAllFakes();

let baseUrl: string;

beforeEach(async () => {
    const { releaseRoutes } = await import('../../src/features/releases/releaseRoutes.js');
    baseUrl = await createIntegrationTestApp(releaseRoutes);
});

afterEach(async () => {
    await stopTestServer();
    setFakeCheckAuth(async (req) => {
        const header = req.headers.authorization;
        if (!header?.startsWith('Bearer ')) {
            throw new Error('Unauthorized');
        }
        return 'test-user-id';
    });
});

describe('release route integration', () => {
    const authHeader = { Authorization: 'Bearer valid-token' };

    describe('GET /v1/getNewReleases', () => {
        it('returns 401 without authorization', async () => {
            const response = await fetch(`${baseUrl}/v1/getNewReleases`);
            assert.equal(response.status, 401);
        });
    });

    describe('POST /v1/removeNewReleases', () => {
        it('returns 400 when releaseIds is missing', async () => {
            const response = await fetch(`${baseUrl}/v1/removeNewReleases`, {
                method: 'POST',
                headers: { ...authHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });
            assert.equal(response.status, 400);
        });

        it('returns 401 without authorization', async () => {
            const response = await fetch(`${baseUrl}/v1/removeNewReleases`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ releaseIds: ['r1'] }),
            });
            assert.equal(response.status, 401);
        });
    });

    describe('POST /v1/getArtistReleases', () => {
        it('returns 400 when artistId is missing', async () => {
            const response = await fetch(`${baseUrl}/v1/getArtistReleases`, {
                method: 'POST',
                headers: { ...authHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });
            assert.equal(response.status, 400);
        });

        it('returns 401 without authorization', async () => {
            const response = await fetch(`${baseUrl}/v1/getArtistReleases`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ artistId: 'artist-1' }),
            });
            assert.equal(response.status, 401);
        });
    });

    describe('POST /v1/getReleaseGroupReleases', () => {
        it('returns 400 when releaseGroupId is missing', async () => {
            const response = await fetch(`${baseUrl}/v1/getReleaseGroupReleases`, {
                method: 'POST',
                headers: { ...authHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });
            assert.equal(response.status, 400);
        });

        it('returns 401 without authorization', async () => {
            const response = await fetch(`${baseUrl}/v1/getReleaseGroupReleases`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ releaseGroupId: 'rg-1' }),
            });
            assert.equal(response.status, 401);
        });
    });

    describe('POST /v1/getRelease', () => {
        it('returns 400 when releaseId is missing', async () => {
            const response = await fetch(`${baseUrl}/v1/getRelease`, {
                method: 'POST',
                headers: { ...authHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });
            assert.equal(response.status, 400);
        });

        it('returns 401 without authorization', async () => {
            const response = await fetch(`${baseUrl}/v1/getRelease`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ releaseId: 'test' }),
            });
            assert.equal(response.status, 401);
        });
    });

    describe('POST /v1/verifyReleaseExistence', () => {
        it('returns 400 when releaseId is missing', async () => {
            const response = await fetch(`${baseUrl}/v1/verifyReleaseExistence`, {
                method: 'POST',
                headers: { ...authHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });
            assert.equal(response.status, 400);
        });

        it('returns 401 without authorization', async () => {
            const response = await fetch(`${baseUrl}/v1/verifyReleaseExistence`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ releaseId: 'test-release' }),
            });
            assert.equal(response.status, 401);
        });
    });
});
