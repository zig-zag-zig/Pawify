import type {
    ExpoPushMessage,
    NotificationMode,
    PushNotificationOptions,
} from './pushNotificationTypes.js';

export const isExpoPushToken = (token: string): boolean => (
    /^(ExpoPushToken|ExponentPushToken)\[[A-Za-z0-9_-]+\]$/.test(token)
);

export const validateNotificationOptions = (options: PushNotificationOptions): NotificationMode => {
    const hasTitleOrBody = !!options.title?.trim() || !!options.body?.trim();
    const hasEventName = !!options.eventName?.trim();
    const hasPayload = options.payload !== undefined;

    if (hasTitleOrBody) {
        if (hasEventName || hasPayload) {
            throw new Error(
                'Visible notifications cannot contain data fields. Remove eventName/payload.',
            );
        }
        return 'visible';
    }

    if (!hasEventName) {
        throw new Error(
            'Data notifications require eventName (non-empty string).',
        );
    }

    if (options.payload && typeof options.payload !== 'object') {
        throw new Error('payload must be an object when provided');
    }

    return 'data';
};

export const buildExpoPushMessages = (
    validPushTokens: string[],
    options: PushNotificationOptions,
    mode: NotificationMode,
): ExpoPushMessage[] => {
    const isDataOnly = mode === 'data';

    return validPushTokens.map((token: string) => ({
        to: token,
        title: options.title,
        body: options.body,
        data: isDataOnly ? { eventName: options.eventName, payload: options.payload } : undefined,
        sound: isDataOnly ? undefined : 'default',
        priority: isDataOnly ? 'high' as const : undefined,
        _contentAvailable: isDataOnly ? true : undefined,
    }));
};
