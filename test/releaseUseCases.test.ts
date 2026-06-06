import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createGetNewReleasesUseCase } from '../src/features/releases/usecases/getNewReleases.js';
import { createGetNewReleasesDependencies } from './helpers/releaseUseCaseFakes.js';
import { createNewRelease } from './helpers/releaseFixtures.js';

describe('release use cases', () => {
    it('sorts new releases by date before queueing cover tasks', async () => {
        const state = createGetNewReleasesDependencies({
            newReleasesMap: {
                exact: createNewRelease({
                    id: 'exact',
                    date: '2026-02-10',
                    date_for_display: '10.02.2026',
                }),
                older: createNewRelease({
                    id: 'older',
                    date: '2025-01-01',
                    date_for_display: '01.01.2025',
                }),
                unknown: createNewRelease({
                    id: 'unknown',
                    date: null,
                    date_for_display: 'Unknown date',
                }),
            },
            coverPageEntries: [
                { releaseGroupId: 'group-1', releaseIds: ['exact', 'older'] },
            ],
        });
        const useCase = createGetNewReleasesUseCase(state.dependencies);

        const result = await useCase('user-1');

        assert.deepEqual(result.releases.map(release => release.id), [
            'exact',
            'older',
            'unknown',
        ]);
        assert.equal(result.releaseCoverTaskId, 'cover-task-1');
        assert.deepEqual(state.queueCalls, [
            { userId: 'user-1', releaseIds: ['exact', 'older'] },
        ]);
    });
});
