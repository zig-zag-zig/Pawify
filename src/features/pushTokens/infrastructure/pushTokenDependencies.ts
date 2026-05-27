import {
    deleteDevicePushTokenFromDb,
    savePushTokenToDb,
} from '../../../services/firebaseService.js';
import type { PushTokenUseCaseDependencies } from '../ports.js';

export const pushTokenDependencies: PushTokenUseCaseDependencies = {
    pushTokenGateway: {
        savePushToken: async (userId, deviceId, pushToken) => {
            await savePushTokenToDb(userId, deviceId, pushToken);
        },
        deletePushToken: async (userId, deviceId) => {
            await deleteDevicePushTokenFromDb(userId, deviceId);
        },
    },
};
