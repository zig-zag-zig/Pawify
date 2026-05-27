import { notifyNewReleases } from '../../../services/notificationService.js';
import type { NotificationUseCaseDependencies } from '../ports.js';

export const notificationDependencies: NotificationUseCaseDependencies = {
    newReleaseNotificationGateway: {
        notifyNewReleases,
    },
};
