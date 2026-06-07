import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import type { Server } from 'node:http';

import express from 'express';
import { healthRoutes } from '../src/features/health/healthRoutes.js';

let server: Server | undefined;

const startTestServer = async (): Promise<string> => {
    const app = express();
    app.use('/v1', healthRoutes);

    const listener = await new Promise<Server>((resolve, reject) => {
        const instance = app.listen(0, '127.0.0.1', (error?: Error) => {
            if (error) {
                reject(error);
                return;
            }
            resolve(instance);
        });
    });
    server = listener;

    const address = listener.address();
    assert.ok(address && typeof address === 'object');
    return `http://127.0.0.1:${address.port}`;
};

afterEach(async () => {
    if (!server) {
        return;
    }

    await new Promise<void>((resolve, reject) => {
        server?.close((error) => {
            if (error) {
                reject(error);
                return;
            }
            resolve();
        });
    });
    server = undefined;
});

describe('health routes', () => {
    it('returns the health response from /v1/health', async () => {
        const baseUrl = await startTestServer();

        const response = await fetch(`${baseUrl}/v1/health`);

        assert.equal(response.status, 200);
        assert.equal(await response.text(), 'Server is healthy.');
    });
});
