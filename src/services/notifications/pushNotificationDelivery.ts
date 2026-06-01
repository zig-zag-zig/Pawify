import { chunkArray } from '../../common/utils/array.js';
import { createLogger } from '../../common/logging/logger.js';
import { invokeHttpEndpoint } from '../../infrastructure/dapr/daprHttp.js';

const logger = createLogger('services.notifications.pushDelivery');
const pushReceiptCheckDelayMs = 15_000;
const pushSendChunkSize = 100;
const pushReceiptChunkSize = 300;

export type PushNotificationOptions = {
    title?: string;
    body?: string;
    eventName?: string;
    payload?: Record<string, unknown>;
};

export type PushDeliveryOptions = {
    excludePushToken?: string;
};

type NotificationMode = 'visible' | 'data';

type ExpoPushErrorDetails = {
    error?: string;
    expoPushToken?: string;
};

type ExpoPushMessage = {
    to: string;
    title?: string;
    body?: string;
    data?: Record<string, unknown>;
    sound?: 'default';
    priority?: 'default' | 'normal' | 'high';
    _contentAvailable?: boolean;
};

type ExpoPushTicket =
    | { status: 'ok'; id: string }
    | { status: 'error'; message: string; details?: ExpoPushErrorDetails };

type ExpoPushReceipt =
    | { status: 'ok' }
    | { status: 'error'; message?: string; details?: ExpoPushErrorDetails };

type ExpoPushReceiptId = string;

const wait = async (ms: number): Promise<void> => {
    await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, ms);
        timeout.unref?.();
    });
};

const getPushTokensFromStore = async (userId: string): Promise<string[]> => {
    const { getPushTokensFromDb } = await import('../firebaseService.js');
    return await getPushTokensFromDb(userId);
};

const deletePushTokensFromStore = async (userId: string, pushTokens: string[]): Promise<void> => {
    const { deletePushTokensFromDb } = await import('../firebaseService.js');
    await deletePushTokensFromDb(userId, pushTokens);
};

const isExpoPushToken = (token: string): boolean => (
    /^(ExpoPushToken|ExponentPushToken)\[[A-Za-z0-9_-]+\]$/.test(token)
);

const readExpoData = async <T>(response: Response, context: string): Promise<T> => {
    const bodyText = await response.text();
    if (!response.ok) {
        throw new Error(`${context}: HTTP ${response.status} ${bodyText}`);
    }

    const body = bodyText ? JSON.parse(bodyText) as unknown : undefined;
    if (
        body
        && typeof body === 'object'
        && 'data' in body
    ) {
        return (body as { data: T }).data;
    }

    return body as T;
};

const sendExpoPushNotifications = async (
    messages: ExpoPushMessage[],
): Promise<ExpoPushTicket[]> => {
    const response = await invokeHttpEndpoint('expo', '/--/api/v2/push/send', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(messages),
    });

    return await readExpoData<ExpoPushTicket[]>(response, 'send Expo push notifications');
};

const getExpoPushReceipts = async (
    ids: ExpoPushReceiptId[],
): Promise<Record<ExpoPushReceiptId, ExpoPushReceipt>> => {
    const response = await invokeHttpEndpoint('expo', '/--/api/v2/push/getReceipts', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ids }),
    });

    return await readExpoData<Record<ExpoPushReceiptId, ExpoPushReceipt>>(response, 'get Expo push receipts');
};

const validateNotificationOptions = (options: PushNotificationOptions): NotificationMode => {
    const hasTitleOrBody = !!options.title?.trim() || !!options.body?.trim();
    const hasEventName = !!options.eventName?.trim();
    const hasPayload = options.payload !== undefined;

    if (hasTitleOrBody) {
        if (hasEventName || hasPayload) {
            throw new Error(
                `Visible notifications cannot contain data fields. Remove eventName/payload.`,
            );
        }
        return 'visible';
    }

    if (!hasEventName) {
        throw new Error(
            `Data notifications require eventName (non-empty string).`,
        );
    }

    if (options.payload && typeof options.payload !== 'object') {
        throw new Error('payload must be an object when provided');
    }

    return 'data';
};

export const getValidPushTokens = async (
    userId: string,
    deliveryOptions: PushDeliveryOptions = {},
): Promise<string[]> => {
    const startedAt = Date.now();
    const storedPushTokens = await getPushTokensFromStore(userId);
    const pushTokens = Array.from(new Set(storedPushTokens));
    const totalTokenCount = pushTokens.length;
    const excludedPushToken = deliveryOptions.excludePushToken?.trim();

    if (pushTokens.length === 0) {
        logger.debug('no push tokens found', { userId });
        logger.debug('push token validation completed', {
            userId,
            pushRecipientsTotal: totalTokenCount,
            pushRecipientsValid: 0,
            pushRecipientsInvalid: 0,
            durationMs: Date.now() - startedAt,
        });
        return [];
    }

    const validPushTokens = pushTokens.filter((token) => isExpoPushToken(token));
    const invalidPushTokens = storedPushTokens.filter((token) => !isExpoPushToken(token));
    const recipientPushTokens = excludedPushToken
        ? validPushTokens.filter((token) => token !== excludedPushToken)
        : validPushTokens;
    const excludedPushRecipientCount = validPushTokens.length - recipientPushTokens.length;

    if (invalidPushTokens.length > 0) {
        logger.warn('removing invalid expo push tokens', { userId, invalidPushRecipientCount: invalidPushTokens.length });
        await deletePushTokensFromStore(userId, invalidPushTokens);
    }

    if (recipientPushTokens.length === 0) {
        const allValidRecipientsExcluded = validPushTokens.length > 0
            && excludedPushRecipientCount === validPushTokens.length;
        if (allValidRecipientsExcluded) {
            logger.debug('push notification recipients excluded', {
                userId,
                excludedPushRecipientCount,
            });
        } else {
            logger.debug('no valid push tokens found', {
                userId,
                excludedPushRecipientCount,
            });
        }
        logger.debug('push token validation completed', {
            userId,
            pushRecipientsTotal: totalTokenCount,
            pushRecipientsValid: 0,
            pushRecipientsInvalid: invalidPushTokens.length,
            pushRecipientsExcluded: excludedPushRecipientCount,
            durationMs: Date.now() - startedAt,
        });
        return [];
    }

    logger.debug('push token validation completed', {
        userId,
        pushRecipientsTotal: totalTokenCount,
        pushRecipientsValid: recipientPushTokens.length,
        pushRecipientsInvalid: invalidPushTokens.length,
        pushRecipientsExcluded: excludedPushRecipientCount,
        durationMs: Date.now() - startedAt,
    });

    return recipientPushTokens;
};

export const sendPushNotificationToTokens = async (
    userId: string,
    validPushTokens: string[],
    options: PushNotificationOptions,
    mode?: NotificationMode,
): Promise<boolean> => {
    const startedAt = Date.now();
    const notificationMode = mode ?? validateNotificationOptions(options);
    const isDataOnly = notificationMode === 'data';

    if (validPushTokens.length === 0) {
        logger.debug('push notification skipped (no valid tokens)', {
            userId,
            mode: notificationMode,
            durationMs: Date.now() - startedAt,
        });
        return false;
    }

    const messagePayloads: ExpoPushMessage[] = validPushTokens.map((token: string) => ({
        to: token,
        title: options.title,
        body: options.body,
        data: isDataOnly ? { eventName: options.eventName, payload: options.payload } : undefined,
        sound: isDataOnly ? undefined : 'default',
        priority: isDataOnly ? 'high' as const : undefined,
        _contentAvailable: isDataOnly ? true : undefined,
    }));

    const chunks = chunkArray(messagePayloads, pushSendChunkSize);
    logger.debug('push notification send started', {
        userId,
        mode: notificationMode,
        pushRecipientCount: validPushTokens.length,
        chunkCount: chunks.length,
    });
    const chunkTicketGroups = await Promise.all(chunks.map(async (chunk, chunkIndex) => {
        const chunkStartedAt = Date.now();
        const tickets = await sendExpoPushNotifications(chunk);

        logger.debug('push notification chunk completed', {
            userId,
            mode: notificationMode,
            chunkIndex: chunkIndex + 1,
            chunkCount: chunks.length,
            chunkSize: chunk.length,
            durationMs: Date.now() - chunkStartedAt,
        });

        return tickets;
    }));
    const tickets = chunkTicketGroups.flat();
    const invalidTokens: string[] = [];
    const receiptTokens = new Map<ExpoPushReceiptId, string>();

    tickets.forEach((ticket: ExpoPushTicket, index) => {
        if (ticket.status === 'error') {
            const errorDetails = ticket.details;
            logger.warn('expo push ticket rejected', {
                userId,
                mode: notificationMode,
                index,
                message: ticket.message,
                details: errorDetails,
            });
            if (errorDetails && 'expoPushToken' in errorDetails) {
                const invalidToken = typeof errorDetails.expoPushToken === 'string'
                    ? errorDetails.expoPushToken
                    : validPushTokens[index];
                invalidTokens.push(invalidToken);
            }
            return;
        }

        receiptTokens.set(ticket.id, validPushTokens[index]);
    });

    if (receiptTokens.size > 0) {
        void checkPushReceipts(userId, notificationMode, options.eventName, receiptTokens);
    }

    if (invalidTokens.length > 0) {
        logger.warn('removing rejected expo push tokens', { userId, rejectedPushRecipientCount: invalidTokens.length });
        await deletePushTokensFromStore(userId, invalidTokens);
    }

    logger.debug('push notification send completed', {
        userId,
        mode: notificationMode,
        pushRecipientCount: validPushTokens.length,
        chunkCount: chunks.length,
        ticketCount: tickets.length,
        rejectedPushRecipientCount: invalidTokens.length,
        receiptCount: receiptTokens.size,
        durationMs: Date.now() - startedAt,
    });

    return true;
};

const getReceiptInvalidToken = (
    receipt: ExpoPushReceipt,
    fallbackPushToken: string | undefined,
): string | null => {
    if (receipt.status !== 'error' || receipt.details?.error !== 'DeviceNotRegistered') {
        return null;
    }

    return typeof receipt.details.expoPushToken === 'string'
        ? receipt.details.expoPushToken
        : fallbackPushToken ?? null;
};

const isDeviceNotRegisteredReceipt = (receipt: ExpoPushReceipt): boolean => (
    receipt.status === 'error' && receipt.details?.error === 'DeviceNotRegistered'
);

const checkPushReceipts = async (
    userId: string,
    mode: NotificationMode,
    eventName: string | undefined,
    receiptTokens: Map<ExpoPushReceiptId, string>,
): Promise<void> => {
    try {
        await wait(pushReceiptCheckDelayMs);

        const receiptIds = Array.from(receiptTokens.keys());
        const chunks = chunkArray(receiptIds, pushReceiptChunkSize);
        const invalidTokens: string[] = [];

        await Promise.all(chunks.map(async (chunk) => {
            const receipts = await getExpoPushReceipts(chunk);

            Object.entries(receipts).forEach(([receiptId, receipt]) => {
                if (receipt.status !== 'error') {
                    return;
                }

                const receiptMetadata = {
                    userId,
                    mode,
                    eventName,
                    receiptId,
                    message: receipt.message,
                    details: receipt.details,
                };
                if (isDeviceNotRegisteredReceipt(receipt)) {
                    logger.info('expo push receipt rejected for unregistered device', receiptMetadata);
                } else {
                    logger.warn('expo push receipt rejected', receiptMetadata);
                }

                const invalidToken = getReceiptInvalidToken(receipt, receiptTokens.get(receiptId));
                if (invalidToken) {
                    invalidTokens.push(invalidToken);
                }
            });
        }));

        if (invalidTokens.length > 0) {
            logger.info('removing receipt-rejected expo push tokens', {
                userId,
                rejectedPushRecipientCount: invalidTokens.length,
            });
            await deletePushTokensFromStore(userId, invalidTokens);
        }

    } catch (error) {
        logger.error('push receipt check failed', {
            userId,
            mode,
            eventName,
            receiptCount: receiptTokens.size,
            error,
        });
    }
};

export const sendPushNotification = async (
    userId: string,
    options: PushNotificationOptions,
    deliveryOptions: PushDeliveryOptions = {},
): Promise<void> => {
    try {
        const startedAt = Date.now();
        const mode = validateNotificationOptions(options);

        logger.debug('push notification request started', {
            userId,
            mode,
        });

        const validPushTokens = await getValidPushTokens(userId, deliveryOptions);
        await sendPushNotificationToTokens(userId, validPushTokens, options, mode);

        logger.debug('push notification request completed', {
            userId,
            mode,
            durationMs: Date.now() - startedAt,
        });
    } catch (error) {
        logger.error('send push notification failed', { userId, error });
        throw error;
    }
};
