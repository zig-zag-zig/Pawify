import type { NewRelease, NewReleasesResult } from '../../../modules/models/models.js';
import type { NewReleasesById, ReleaseUseCaseDependencies } from '../ports.js';

const flattenNewReleasesMap = (newReleasesMap: NewReleasesById): NewRelease[] => {
    return Object.values(newReleasesMap);
};

const dateToTimestamp = (date: string | null): number => {
    if (!date) {
        return Number.MIN_SAFE_INTEGER;
    }

    const dateParts = date.split('-');
    const year = Number.parseInt(dateParts[0] ?? '', 10);
    const month = Number.parseInt(dateParts[1] ?? '1', 10);
    const day = Number.parseInt(dateParts[2] ?? '1', 10);

    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
        return Number.MIN_SAFE_INTEGER;
    }

    return new Date(year, month - 1, day).getTime();
};

const dateForDisplayToTimestamp = (dateForDisplay: string): number => {
    if (!dateForDisplay || dateForDisplay === 'Unknown date') {
        return Number.MIN_SAFE_INTEGER;
    }

    const parts = dateForDisplay.split('.');
    if (parts.length === 3) {
        const day = Number.parseInt(parts[0] ?? '', 10);
        const month = Number.parseInt(parts[1] ?? '', 10);
        const year = Number.parseInt(parts[2] ?? '', 10);
        if (Number.isFinite(day) && Number.isFinite(month) && Number.isFinite(year)) {
            return new Date(year, month - 1, day).getTime();
        }
    }

    if (parts.length === 2) {
        const month = Number.parseInt(parts[0] ?? '', 10);
        const year = Number.parseInt(parts[1] ?? '', 10);
        if (Number.isFinite(month) && Number.isFinite(year)) {
            return new Date(year, month - 1, 1).getTime();
        }
    }

    if (parts.length === 1) {
        const year = Number.parseInt(parts[0] ?? '', 10);
        if (Number.isFinite(year)) {
            return new Date(year, 0, 1).getTime();
        }
    }

    return Number.MIN_SAFE_INTEGER;
};

export const createGetNewReleasesUseCase = ({
    newReleasesRepository,
    releaseTaskQueue,
}: Pick<ReleaseUseCaseDependencies, 'newReleasesRepository' | 'releaseTaskQueue'>) => async (
    userId: string,
): Promise<NewReleasesResult> => {
    const snapshot = await newReleasesRepository.getNewReleasesSnapshot(userId);
    const releases = flattenNewReleasesMap(snapshot.newReleasesMap);
    releases.sort((left, right) => {
        const rightTime = dateToTimestamp(right.date) || dateForDisplayToTimestamp(right.date_for_display);
        const leftTime = dateToTimestamp(left.date) || dateForDisplayToTimestamp(left.date_for_display);
        return rightTime - leftTime;
    });

    return {
        releases,
        releaseCoverTaskId: releaseTaskQueue.queueNewReleaseCovers(
            userId,
            snapshot.coverPageEntries,
            undefined,
        ),
    };
};
