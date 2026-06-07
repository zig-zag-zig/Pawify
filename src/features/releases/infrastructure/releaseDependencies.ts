import { requestDeduper } from '../../../common/request/requestDeduper.js';
import { musicBrainzReleaseCatalog } from './musicBrainzReleaseCatalog.js';
import {
    artistReleaseContextGateway,
    missingReleaseCleanupRepository,
    newReleasesRepository,
    releaseNotifier,
} from './releaseInfrastructureAdapters.js';
import { releaseTaskQueue } from './releaseTaskQueue.js';
import type { ReleaseUseCaseDependencies } from '../ports.js';

export const releaseDependencies: ReleaseUseCaseDependencies = {
    artistReleaseContextGateway,
    missingReleaseCleanupRepository,
    newReleasesRepository,
    releaseCatalogGateway: musicBrainzReleaseCatalog,
    releaseNotifier,
    releaseTaskQueue,
    requestDeduper,
};
