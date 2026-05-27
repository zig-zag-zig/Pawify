import type { RequestDeduperPort } from '../../common/request/requestDeduper.js';
import type {
    NewRelease,
    Release,
    ReleaseGroupReleaseListItem,
} from '../../modules/models/models.js';
import type { CachedArtistReleases } from '../../utils/types/cacheTypes.js';
import type {
    ReleaseGroupPageEntry,
    ReleaseGroupReleasesPageEntry,
} from '../../utils/types/taskTypes.js';

export type NewReleasesById = {
    [releaseId: string]: NewRelease;
};

type NewReleasesSnapshot = {
    newReleasesMap: NewReleasesById;
    coverPageEntries: ReleaseGroupReleasesPageEntry[];
};

interface ArtistReleaseContextGateway {
    getArtistTtl(userId: string, artistId: string): Promise<number | undefined>;
}

interface ReleaseCatalogGateway {
    getArtistReleases(
        artistId: string,
        ttl: number | undefined,
        onReleaseGroupPage: (pageEntries: ReleaseGroupPageEntry[], isLastPage: boolean) => Promise<void> | void,
    ): Promise<CachedArtistReleases>;
    getReleaseGroupReleases(
        releaseGroupId: string,
        ttl: number | undefined,
        onReleaseIdsPage: (releaseGroupId: string, releaseIds: string[], isLastPage: boolean) => Promise<void> | void,
    ): Promise<ReleaseGroupReleaseListItem[]>;
    getRelease(releaseId: string): Promise<Release | null>;
    releaseExists(releaseId: string): Promise<boolean>;
}

interface ReleaseTaskQueue {
    addTaskUser(taskId: string, userId: string): void;
    queueArtistReleaseGroupCovers(
        userId: string,
        artistId: string,
        pageEntries: ReleaseGroupPageEntry[],
        ttl: number | undefined,
    ): string;
    queueReleaseGroupReleaseCovers(
        userId: string,
        releaseGroupId: string,
        pageEntries: ReleaseGroupReleasesPageEntry[],
        ttl: number | undefined,
    ): string;
    queueNewReleaseCovers(userId: string, pageEntries: ReleaseGroupReleasesPageEntry[], ttl: number | undefined): string;
    queueReleaseTrackLyrics(userId: string, release: Release, ttl: number | undefined): string;
    queueReleaseArtistProfileImages(userId: string, release: Release, ttl: number | undefined): string;
}

interface NewReleasesRepository {
    getNewReleasesSnapshot(userId: string): Promise<NewReleasesSnapshot>;
    deleteNewReleases(userId: string, releaseIds: string[]): Promise<void>;
}

interface MissingReleaseCleanupRepository {
    removeMissingRelease(releaseId: string): Promise<{
        affectedUserIds: string[];
        removedFromNewReleasesUserIds: string[];
    }>;
}

interface ReleaseNotifier {
    notifyReleasesChanged(userId: string, sourcePushToken?: string): Promise<void>;
}

type ReleaseSharedUseCaseDependencies = {
    artistReleaseContextGateway: ArtistReleaseContextGateway;
    missingReleaseCleanupRepository: MissingReleaseCleanupRepository;
    newReleasesRepository: NewReleasesRepository;
    releaseCatalogGateway: ReleaseCatalogGateway;
    releaseNotifier: ReleaseNotifier;
    releaseTaskQueue: ReleaseTaskQueue;
};

export type ReleaseReadUseCaseDependencies = ReleaseSharedUseCaseDependencies & {
    requestDeduper: RequestDeduperPort;
};

export type ReleaseWriteUseCaseDependencies = ReleaseSharedUseCaseDependencies;

export type ReleaseUseCaseDependencies = ReleaseReadUseCaseDependencies;
