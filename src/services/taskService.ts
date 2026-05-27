import { randomUUID } from 'crypto';

import { createLogger } from '../common/logging/logger.js';
import { backgroundTaskConfig } from '../config/runtimeConfig.js';
import { BackgroundTaskQueue } from './tasks/taskQueue.js';
import { toTaskRequestContext } from './tasks/taskContext.js';
import { createTaskJobProcessor } from './tasks/taskJobProcessor.js';
import {
    BackgroundTaskRegistry,
    type TaskLookupResult,
} from './tasks/backgroundTaskRegistry.js';
import {
    completeTaskSessionWithoutPages,
    expireOrphanedPendingTask,
    maybeCompleteTaskSession,
} from './tasks/taskSessionLifecycle.js';
import {
    getRequestContext,
    runWithRequestContext,
} from '../common/logging/requestContext.js';
import type {
    BackgroundTaskResultPayload,
    BackgroundTaskType,
    CompositeTaskSessionController,
    TaskSessionController,
} from '../utils/types/taskTypes.js';

const logger = createLogger('services.tasks');

const TASK_RESULT_RETENTION_MS = backgroundTaskConfig.resultRetentionMs;
const TASK_CLEANUP_INTERVAL_MS = backgroundTaskConfig.cleanupIntervalMs;
const MAX_CONCURRENT_BACKGROUND_TASKS = backgroundTaskConfig.maxConcurrency;
const TASK_PENDING_ORPHAN_TTL_MS = backgroundTaskConfig.pendingOrphanTtlMs;
const BACKGROUND_TASK_WORKER_TIMEOUT_MS = backgroundTaskConfig.workerTimeoutMs;

const taskRegistry = new BackgroundTaskRegistry(TASK_RESULT_RETENTION_MS, logger);

const hasPendingSubtasks = (taskId: string): boolean => {
    const task = taskRegistry.getTask(taskId);
    return (task?.subtaskIds ?? []).some((subtaskId) => taskRegistry.getTask(subtaskId)?.status === 'pending');
};

const getTaskRetentionCompletedAt = (
    taskId: string,
    completedAt: number,
    now: number,
): number => {
    const task = taskRegistry.getTask(taskId);
    if (!task?.parentTaskId) {
        return completedAt;
    }

    const parentTask = taskRegistry.getTask(task.parentTaskId);
    if (parentTask?.status === 'pending') {
        return now;
    }

    return parentTask?.completedAt ?? completedAt;
};

const cleanupExpiredTasks = (): void => {
    const now = Date.now();

    taskRegistry.deleteExpiredRecentDedupeTasks(now);

    for (const [taskId, task] of taskRegistry.taskEntries()) {
        if (task.status === 'pending') {
            const session = taskRegistry.getSession(taskId);
            if (session?.activeWorkers && session.activeWorkers > 0) {
                continue;
            }

            if (session?.isCompositeParent && hasPendingSubtasks(taskId)) {
                continue;
            }

            const lastActivityAt = session?.lastActivityAt ?? task.createdAt;
            const inactiveForMs = now - lastActivityAt;
            if (inactiveForMs > TASK_PENDING_ORPHAN_TTL_MS) {
                expireOrphanedPendingTask({
                    inactiveForMs,
                    logger,
                    orphanTtlMs: TASK_PENDING_ORPHAN_TTL_MS,
                    queue: taskQueue,
                    registry: taskRegistry,
                    session,
                    task,
                    taskId,
                });
            }

            continue;
        }

        const completedAt = getTaskRetentionCompletedAt(taskId, task.completedAt ?? task.createdAt, now);
        if ((now - completedAt) > TASK_RESULT_RETENTION_MS) {
            taskRegistry.deleteTask(taskId);
        }
    }
};

setInterval(cleanupExpiredTasks, TASK_CLEANUP_INTERVAL_MS).unref?.();

const maybeCompleteSession = (taskId: string): void => {
    maybeCompleteTaskSession({
        logger,
        registry: taskRegistry,
        taskId,
    });
};

const processPendingJob = createTaskJobProcessor({
    logger,
    registry: taskRegistry,
    workerTimeoutMs: BACKGROUND_TASK_WORKER_TIMEOUT_MS,
    onSessionMaybeComplete: maybeCompleteSession,
});

const taskQueue = new BackgroundTaskQueue(MAX_CONCURRENT_BACKGROUND_TASKS, processPendingJob);

type CreateTaskSessionOptions<T extends BackgroundTaskResultPayload> = {
    dedupeKey?: string;
    initialResult?: T;
    isCompositeParent?: boolean;
    notifyOnCompletion?: boolean;
    parentTaskId?: string;
};

const createTaskSessionRecord = <T extends BackgroundTaskResultPayload>(
    userId: string,
    type: BackgroundTaskType,
    options?: CreateTaskSessionOptions<T>,
): { taskId: string; reused: boolean } => {
    cleanupExpiredTasks();
    const requestContext = getRequestContext();

    const dedupeKey = options?.dedupeKey?.trim();
    if (dedupeKey) {
        const existingTaskId = taskRegistry.resolveDedupeTask(userId, dedupeKey);
        if (existingTaskId) {
            const existingTask = taskRegistry.getTask(existingTaskId);
            const existingSession = taskRegistry.getSession(existingTaskId);
            const existingContext = toTaskRequestContext(
                existingSession?.requestContext,
                existingTaskId,
                existingTask?.type ?? type,
                userId,
            );

            runWithRequestContext(existingContext, () => {
                logger.debug('background task dedupe reused', {
                    dedupeKey,
                    status: existingTask?.status ?? 'unknown',
                    ageMs: existingTask ? Date.now() - existingTask.createdAt : undefined,
                });
            });

            return {
                taskId: existingTaskId,
                reused: true,
            };
        }
    }

    const taskId = randomUUID();
    const createdAt = Date.now();
    const taskRequestContext = toTaskRequestContext(requestContext, taskId, type, userId);

    taskRegistry.setTask(taskId, {
        id: taskId,
        userIds: [userId],
        type,
        status: 'pending',
        createdAt,
        result: options?.initialResult,
        parentTaskId: options?.parentTaskId,
        subtaskIds: options?.isCompositeParent ? [] : undefined,
        completedSubtaskIds: options?.isCompositeParent ? [] : undefined,
        subtaskCount: options?.isCompositeParent ? 0 : undefined,
        completedSubtaskCount: options?.isCompositeParent ? 0 : undefined,
        notifyOnCompletion: options?.notifyOnCompletion,
    });

    taskRegistry.setSession(taskId, {
        totalPages: 0,
        pagesReceived: 0,
        tasksHandled: 0,
        activeWorkers: 0,
        lastActivityAt: createdAt,
        failed: false,
        dedupeKey,
        requestContext: taskRequestContext,
        isCompositeParent: options?.isCompositeParent,
    });

    if (dedupeKey) {
        taskRegistry.setActiveDedupeTask(dedupeKey, taskId);
    }

    runWithRequestContext(taskRequestContext, () => {
        logger.debug('background task created', {
            dedupeKey,
            parentTaskId: options?.parentTaskId,
            isCompositeParent: options?.isCompositeParent ?? false,
            notifyOnCompletion: options?.notifyOnCompletion ?? true,
            initialPendingQueueSize: taskQueue.pendingQueueSize,
            initialResultProvided: options?.initialResult !== undefined,
        });
    });

    return {
        taskId,
        reused: false,
    };
};

const finalizeTaskSession = (taskId: string): void => {
    const session = taskRegistry.getSession(taskId);
    const task = taskRegistry.getTask(taskId);

    if (!session || !task) {
        return;
    }

    session.totalPages = session.pagesReceived;
    session.lastActivityAt = Date.now();

    if (session.isCompositeParent) {
        task.subtaskCount = session.totalPages;
        task.completedSubtaskCount = session.tasksHandled;
    }

    if (session.totalPages === 0) {
        completeTaskSessionWithoutPages({
            logger,
            registry: taskRegistry,
            session,
            task,
            taskId,
        });
        return;
    }

    runWithRequestContext(session.requestContext, () => {
        logger.debug('background task finalized and waiting for pages', {
            pageCount: session.totalPages,
            pagesHandled: session.tasksHandled,
            isCompositeParent: session.isCompositeParent ?? false,
        });
    });

    maybeCompleteSession(taskId);
};

export const createBackgroundTaskSession = <T extends BackgroundTaskResultPayload>(
    userId: string,
    type: BackgroundTaskType,
    options?: CreateTaskSessionOptions<T>,
): TaskSessionController<T> & { reused: boolean } => {
    const createdSession = createTaskSessionRecord(userId, type, options);

    if (createdSession.reused) {
        return {
            taskId: createdSession.taskId,
            reused: true,
            submitPage: () => { },
            finalize: () => { },
        };
    }

    const taskId = createdSession.taskId;

    return {
        taskId,
        reused: false,
        submitPage: (worker) => {
            const session = taskRegistry.getSession(taskId);
            if (!session) {
                return;
            }

            const queuedAt = Date.now();
            session.pagesReceived += 1;
            const pageNumber = session.pagesReceived;
            session.lastActivityAt = queuedAt;

            taskQueue.enqueue({
                taskId,
                pageNumber,
                queuedAt,
                worker: async (signal) => await worker(signal) as Partial<BackgroundTaskResultPayload> | void,
            });

            runWithRequestContext(session.requestContext, () => {
                logger.debug('background task page queued', {
                    pageNumber,
                    pagesReceived: session.pagesReceived,
                    pendingQueueSize: taskQueue.pendingQueueSize,
                    activeTaskCount: taskQueue.activeTaskCount,
                });
            });
        },
        finalize: () => finalizeTaskSession(taskId),
    };
};

export const createCompositeBackgroundTaskSession = <T extends BackgroundTaskResultPayload>(
    userId: string,
    type: BackgroundTaskType,
    options?: {
        dedupeKey?: string;
        initialResult?: T;
    },
): CompositeTaskSessionController<T> & { reused: boolean } => {
    const createdSession = createTaskSessionRecord(userId, type, {
        ...options,
        isCompositeParent: true,
    });

    if (createdSession.reused) {
        return {
            taskId: createdSession.taskId,
            reused: true,
            submitSubtask: () => null,
            finalize: () => { },
        };
    }

    const taskId = createdSession.taskId;

    return {
        taskId,
        reused: false,
        submitSubtask: (submitPages) => {
            const parentSession = taskRegistry.getSession(taskId);
            const parentTask = taskRegistry.getTask(taskId);
            if (!parentSession || !parentTask) {
                return null;
            }

            const childSession = createBackgroundTaskSession<T>(userId, type, {
                initialResult: options?.initialResult,
                notifyOnCompletion: false,
                parentTaskId: taskId,
            });
            const queuedAt = Date.now();
            parentSession.pagesReceived += 1;
            parentSession.lastActivityAt = queuedAt;
            parentTask.subtaskIds = [...(parentTask.subtaskIds ?? []), childSession.taskId];
            parentTask.subtaskCount = parentSession.pagesReceived;
            parentTask.completedSubtaskCount = parentSession.tasksHandled;

            runWithRequestContext(parentSession.requestContext, () => {
                logger.debug('background subtask queued', {
                    subtaskId: childSession.taskId,
                    subtaskCount: parentTask.subtaskCount,
                });
            });

            try {
                submitPages(childSession);
            } finally {
                childSession.finalize();
            }

            return childSession.taskId;
        },
        finalize: () => finalizeTaskSession(taskId),
    };
};

export const getTaskResultForUser = (
    userId: string,
    taskId: string,
): TaskLookupResult => {
    cleanupExpiredTasks();

    const lookup = taskRegistry.getTaskResultForUser(userId, taskId);
    if (lookup.status === 'missing') {
        logger.debug('task result lookup missing', {
            taskId,
            userId,
            pendingQueueSize: taskQueue.pendingQueueSize,
            activeTaskCount: taskQueue.activeTaskCount,
        });
        return { status: 'missing' };
    }

    if (lookup.status === 'forbidden') {
        const task = taskRegistry.getTask(taskId);
        logger.warn('task result lookup forbidden', {
            taskId,
            userId,
            taskType: task?.type,
            taskStatus: task?.status,
        });
        return { status: 'forbidden' };
    }

    if (lookup.status === 'pending') {
        const task = lookup.task;
        logger.debug('task result lookup pending', {
            taskId,
            taskType: task.type,
            ageMs: Date.now() - task.createdAt,
        });
        return {
            status: 'pending',
            task,
        };
    }

    const task = lookup.task;
    logger.debug('task result lookup finished', {
        taskId,
        taskType: task.type,
        taskStatus: task.status,
        ageMs: (task.completedAt ?? Date.now()) - task.createdAt,
    });

    return {
        status: 'finished',
        task,
    };
};

export const addTaskUser = (taskId: string, userId: string): void => {
    const result = taskRegistry.addTaskUser(taskId, userId);
    if (!result?.added) {
        return;
    }

    logger.debug('background task user linked', {
        taskId,
        taskType: result.task.type,
        userCount: result.task.userIds.length,
        linkedUserId: userId,
    });
};
