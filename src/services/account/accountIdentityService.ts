import { auth } from 'firebase-admin';
import admin from '../../infrastructure/firebase/firebaseInit.js';
import { createLogger } from '../../common/logging/logger.js';

const logger = createLogger('services.account.identity');

export const revokeToken = async (userId: string): Promise<void> => {
    try {
        await auth().revokeRefreshTokens(userId);
    } catch (error) {
        logger.warn('revoke token failed', { error });
        throw new Error('Could not update the sign-in session. Please try again.');
    }
};

export const changeEmail = async (userId: string, email: string): Promise<void> => {
    try {
        await admin.auth().updateUser(userId, { email });
    } catch (error) {
        logger.warn('change email failed', { error });
        throw new Error('Could not change email. Please try again.');
    }
};
