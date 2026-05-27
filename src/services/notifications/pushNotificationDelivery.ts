import {
    Expo,
    type ExpoPushMessage,
    type ExpoPushReceipt,
    type ExpoPushReceiptId,
    type ExpoPushTicket,
} from 'expo-server-sdk';
import { createLogger } from '../../common/logging/logger.js';
import {
    deletePushTokensFromDb,
    getPushTokensFromDb,
} from '../firebaseService.js';

const expo = new Expo();
const logger = createLogger('services.notifications.pushDelivery');
const pushReceiptCheckDelayMs = 15_000;

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

const wait = async (ms: number): Promise<void> => {
    await new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
    });
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
    const storedPushTokens = await getPushTokensFromDb(userId);
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

    const validPushTokens = pushTokens.filter((token) => Expo.isExpoPushToken(token));
    const invalidPushTokens = storedPushTokens.filter((token) => !Expo.isExpoPushToken(token));
    const recipientPushTokens = excludedPushToken
        ? validPushTokens.filter((token) => token !== excludedPushToken)
        : validPushTokens;
    const excludedPushRecipientCount = validPushTokens.length - recipientPushTokens.length;

    if (invalidPushTokens.length > 0) {
        logger.warn('removing invalid expo push tokens', { userId, invalidPushRecipientCount: invalidPushTokens.length });
        await deletePushTokensFromDb(userId, invalidPushTokens);
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

    const chunks = expo.chunkPushNotifications(messagePayloads);
    logger.debug('push notification send started', {
        userId,
        mode: notificationMode,
        pushRecipientCount: validPushTokens.length,
        chunkCount: chunks.length,
    });
    const chunkTicketGroups = await Promise.all(chunks.map(async (chunk, chunkIndex) => {
        const chunkStartedAt = Date.now();
        const tickets = await expo.sendPushNotificationsAsync(chunk);

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
        await deletePushTokensFromDb(userId, invalidTokens);
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
        const chunks = expo.chunkPushNotificationReceiptIds(receiptIds);
        const invalidTokens: string[] = [];

        await Promise.all(chunks.map(async (chunk) => {
            const receipts = await expo.getPushNotificationReceiptsAsync(chunk);

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
            await deletePushTokensFromDb(userId, invalidTokens);
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
