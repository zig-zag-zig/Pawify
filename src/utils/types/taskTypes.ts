import type {
    ArtistProfileImageTaskResult,
    NewReleaseCoverTaskResult,
    ReleaseGroupCoverTaskResult,
    ReleaseGroupReleaseCoverTaskResult,
    TrackLyricsTaskResult,
} from '../../modules/models/models.js';

export type {
    ArtistProfileImageTaskResult,
    NewReleaseCoverTaskResult,
    ReleaseGroupCoverTaskResult,
    ReleaseGroupReleaseCoverTaskResult,
    TrackLyricsTaskResult,
} from '../../modules/models/models.js';

export type BackgroundTaskType =
    | 'release_group_covers'
    | 'release_group_release_covers'
    | 'new_release_covers'
    | 'release_tracks_lyrics'
    | 'artist_profile_images';

export type BackgroundTaskStatus = 'pending' | 'completed' | 'failed';

export type TrackLyricsRequest = {
    releaseId: string;
    trackId: string;
    artistName: string;
    trackName: string;
};

export type ArtistProfileImageLookup = {
    artistId: string;
    artistName?: string;
    discogsUrls?: string[];
};

export type ReleaseGroupPageEntry = {
    releaseGroupId: string;
    releaseIds: string[];
};

export type ReleaseGroupReleasesPageEntry = {
    releaseGroupId: string;
    releaseIds: string[];
};

export type BackgroundTaskResultPayload =
    | ReleaseGroupCoverTaskResult
    | ReleaseGroupReleaseCoverTaskResult
    | NewReleaseCoverTaskResult
    | TrackLyricsTaskResult
    | ArtistProfileImageTaskResult;

export interface BackgroundTaskRecord<T = unknown> {
    id: string;
    userIds: string[];
    type: BackgroundTaskType;
    status: BackgroundTaskStatus;
    createdAt: number;
    completedAt?: number;
    result?: T;
    error?: string;
    parentTaskId?: string;
    subtaskIds?: string[];
    completedSubtaskIds?: string[];
    subtaskCount?: number;
    completedSubtaskCount?: number;
    notifyOnCompletion?: boolean;
}

export type TaskResultResponse<T = unknown> = {
    taskId: string;
    type: BackgroundTaskType;
    status: BackgroundTaskStatus;
    createdAt: number;
    completedAt?: number;
    result?: T;
    error?: string;
    parentTaskId?: string;
    subtaskIds?: string[];
    completedSubtaskIds?: string[];
    subtaskCount?: number;
    completedSubtaskCount?: number;
};

export type TaskSessionController<T = BackgroundTaskResultPayload> = {
    taskId: string;
    submitPage: (worker: (signal: AbortSignal) => Promise<Partial<T> | void>) => void;
    finalize: () => void;
};

export type CompositeTaskSessionController<T = BackgroundTaskResultPayload> = {
    taskId: string;
    submitSubtask: (submitPages: (session: TaskSessionController<T>) => void) => string | null;
    finalize: () => void;
};
