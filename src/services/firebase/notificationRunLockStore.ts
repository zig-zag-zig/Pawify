import { randomUUID } from 'crypto';
import { db } from '../../infrastructure/firebase/firebaseInit.js';
import { notificationConfig } from '../../config/runtimeConfig.js';
import { isPlainObject } from './utils.js';

const LOCKS_COLLECTION = 'runtimeLocks';
const NOTIFY_NEW_RELEASES_LOCK_ID = 'notifyNewReleases';

type NotificationRunLock = {
  ownerId: string;
  expiresAt: number;
};

type StoredNotificationRunLock = NotificationRunLock & {
  acquiredAt: number;
};

const normalizeStoredLock = (value: unknown): StoredNotificationRunLock | null => {
  if (!isPlainObject(value)) {
    return null;
  }

  if (
    typeof value.ownerId !== 'string'
    || typeof value.acquiredAt !== 'number'
    || typeof value.expiresAt !== 'number'
  ) {
    return null;
  }

  return {
    ownerId: value.ownerId,
    acquiredAt: value.acquiredAt,
    expiresAt: value.expiresAt,
  };
};

const getNotifyNewReleasesLockRef = () => (
  db.collection(LOCKS_COLLECTION).doc(NOTIFY_NEW_RELEASES_LOCK_ID)
);

export const acquireNotifyNewReleasesLock = async (): Promise<NotificationRunLock | null> => {
  const lockRef = getNotifyNewReleasesLockRef();
  const ownerId = randomUUID();
  const now = Date.now();
  const lock: StoredNotificationRunLock = {
    ownerId,
    acquiredAt: now,
    expiresAt: now + notificationConfig.notifyNewReleasesLockTtlMs,
  };

  const acquired = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(lockRef);
    const currentLock = normalizeStoredLock(snapshot.data());

    if (currentLock && currentLock.expiresAt > now) {
      return false;
    }

    transaction.set(lockRef, lock);
    return true;
  });

  return acquired
    ? { ownerId: lock.ownerId, expiresAt: lock.expiresAt }
    : null;
};

export const releaseNotifyNewReleasesLock = async (
  lock: NotificationRunLock,
): Promise<void> => {
  const lockRef = getNotifyNewReleasesLockRef();

  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(lockRef);
    const currentLock = normalizeStoredLock(snapshot.data());

    if (currentLock?.ownerId === lock.ownerId) {
      transaction.delete(lockRef);
    }
  });
};
