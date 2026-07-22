import * as crypto from 'crypto';
import { auth, db } from '../../infrastructure/firebase/firebaseInit.js';
import { FieldValue } from 'firebase-admin/firestore';
import { createLogger } from '../../common/logging/logger.js';
import { sendOtpEmail } from '../emailService.js';
import { hashOtp, isOtpMatch } from './otpHashing.js';

// Re-export for backward-compatible imports and unit testing.
export { hashOtp, isOtpMatch };

const OTP_EXPIRY_MINUTES = 15;
const MAX_OTP_ATTEMPTS = 3;
const logger = createLogger('services.account.passwordResetOtp');
const OTP_DELIVERY_FAILED_MESSAGE = 'Could not send OTP. Please check the email address and try again.';
const RESET_REQUEST_NOT_FOUND_MESSAGE = 'Password reset request was not found or has expired.';
const OTP_ATTEMPTS_EXCEEDED_MESSAGE = 'Too many incorrect OTP attempts. Please request a new OTP.';

const getErrorMessage = (error: unknown): string => {
    return error instanceof Error ? error.message : 'Unknown account service error';
};

const getUidWithEmail = async (email: string) => {
    try {
        return await auth.getUserByEmail(email);
    } catch (error) {
        return null;
    }
};

export const sendOtp = async (email: string): Promise<void> => {
    try {
        const user = await getUidWithEmail(email);
        if (!user) {
            throw new Error('User not found');
        }

        const otp = crypto.randomInt(100000, 999999).toString();
        const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60_000);
        const resetRef = db.collection('passwordResets').doc(user.uid);

        await resetRef.set({
            otpHash: hashOtp(otp),
            expiresAt,
            attempts: 0,
            verified: false,
        });

        try {
            await sendOtpEmail(email, otp, OTP_EXPIRY_MINUTES);
        } catch (error) {
            await resetRef.delete().catch(() => { });
            throw error;
        }
    } catch (error) {
        logger.warn('send otp failed', { error });
        throw new Error(OTP_DELIVERY_FAILED_MESSAGE);
    }
};

export const verifyOtp = async (email: string, otp: string): Promise<string> => {
    try {
        const user = await getUidWithEmail(email);
        if (!user) {
            throw new Error('User not found');
        }

        const resetRef = db.collection('passwordResets').doc(user.uid);
        const doc = await resetRef.get();

        if (!doc.exists) {
            throw new Error(RESET_REQUEST_NOT_FOUND_MESSAGE);
        }

        const resetData = doc.data();
        if (!resetData) {
            throw new Error(RESET_REQUEST_NOT_FOUND_MESSAGE);
        }

        if (resetData.attempts >= MAX_OTP_ATTEMPTS) {
            await resetRef.delete();
            throw new Error(OTP_ATTEMPTS_EXCEEDED_MESSAGE);
        }

        if (resetData.expiresAt.toDate() < new Date()) {
            await resetRef.delete();
            throw new Error('OTP expired');
        }

        if (!isOtpMatch(resetData, otp)) {
            const attempts = (resetData.attempts ?? 0) + 1;

            if (attempts >= MAX_OTP_ATTEMPTS) {
                await resetRef.delete();
                throw new Error(OTP_ATTEMPTS_EXCEEDED_MESSAGE);
            }

            await resetRef.update({
                attempts: FieldValue.increment(1),
            });
            throw new Error('Invalid OTP');
        }

        const tempToken = await auth.createCustomToken(user.uid, { signInMethod: 'customToken' });

        await resetRef.delete();

        return tempToken;
    } catch (error) {
        logger.warn('verify otp failed', { error });
        throw new Error(getErrorMessage(error));
    }
};
