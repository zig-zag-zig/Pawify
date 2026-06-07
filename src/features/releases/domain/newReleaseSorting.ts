import type { NewRelease } from '../../../modules/models/models.js';

const unknownReleaseTime = Number.MIN_SAFE_INTEGER;

const dateToTimestamp = (date: string | null): number => {
    if (!date) {
        return unknownReleaseTime;
    }

    const dateParts = date.split('-');
    const year = Number.parseInt(dateParts[0] ?? '', 10);
    const month = Number.parseInt(dateParts[1] ?? '1', 10);
    const day = Number.parseInt(dateParts[2] ?? '1', 10);

    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
        return unknownReleaseTime;
    }

    return new Date(year, month - 1, day).getTime();
};

const dateForDisplayToTimestamp = (dateForDisplay: string): number => {
    if (!dateForDisplay || dateForDisplay === 'Unknown date') {
        return unknownReleaseTime;
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

    return unknownReleaseTime;
};

const getReleaseSortTime = (release: NewRelease): number => {
    return dateToTimestamp(release.date) || dateForDisplayToTimestamp(release.date_for_display);
};

export const sortNewReleasesNewestFirst = (releases: NewRelease[]): NewRelease[] => {
    return [...releases].sort((left, right) => getReleaseSortTime(right) - getReleaseSortTime(left));
};
