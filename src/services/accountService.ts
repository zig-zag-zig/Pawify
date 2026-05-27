import admin, { db } from "../infrastructure/firebase/firebaseInit.js";
import * as crypto from 'crypto';
import { sendOtpEmail } from "./emailService.js";
import { auth } from "firebase-admin";
import { createLogger } from '../common/logging/logger.js';

const OTP_EXPIRY_MINUTES = 15;
const MAX_OTP_ATTEMPTS = 3;
const logger = createLogger('services.account');
const OTP_DELIVERY_FAILED_MESSAGE = 'Could not send OTP. Please check the email address and try again.';
const RESET_REQUEST_NOT_FOUND_MESSAGE = 'Password reset request was not found or has expired.';
const OTP_ATTEMPTS_EXCEEDED_MESSAGE = 'Too many incorrect OTP attempts. Please request a new OTP.';

const hashOtp = (otp: string): string => {
    return crypto.createHash('sha256').update(otp).digest('hex');
};

const constantTimeEquals = (left: string, right: string): boolean => {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);

    return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const isOtpMatch = (resetData: admin.firestore.DocumentData, otp: string): boolean => {
    const hashedOtp = hashOtp(otp);

    if (typeof resetData.otpHash === 'string') {
        return constantTimeEquals(resetData.otpHash, hashedOtp);
    }

    return typeof resetData.otp === 'string' && constantTimeEquals(hashOtp(resetData.otp), hashedOtp);
};

const getErrorMessage = (error: unknown): string => {
    return error instanceof Error ? error.message : 'Unknown account service error';
};

export const sendOtp = async (email: string) => {
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
            verified: false
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
}

export const verifyOtp = async (email: string, otp: string) => {
    try {
        const user = await getUidWithEmail(email);
        if (!user) {
            throw new Error('User not found');
        }

        const doc = await db.collection('passwordResets').doc(user.uid).get();

        if (!doc.exists) {
            throw new Error(RESET_REQUEST_NOT_FOUND_MESSAGE);
        }

        const resetData = doc.data();
        if (!resetData) {
            throw new Error(RESET_REQUEST_NOT_FOUND_MESSAGE);
        }

        const resetRef = db.collection('passwordResets').doc(user.uid);

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

            await db.collection('passwordResets').doc(user.uid).update({
                attempts: admin.firestore.FieldValue.increment(1)
            });
            throw new Error('Invalid OTP');
        }

        const tempToken = await admin.auth().createCustomToken(user.uid, { signInMethod: 'customToken' });

        await resetRef.delete();

        return tempToken;
    } catch (error) {
        logger.warn('verify otp failed', { error });
        throw new Error(getErrorMessage(error));
    }
};

export const revokeToken = async (userId: string): Promise<void> => {
    try {
        await auth().revokeRefreshTokens(userId);
    } catch (error) {
        logger.warn('revoke token failed', { error });
        throw new Error('Could not update the sign-in session. Please try again.');
    }
};

export const changeEmail = async (userId: string, email: string) => {
    try {
        await admin.auth().updateUser(userId, { email });
    } catch (error) {
        logger.warn('change email failed', { error });
        throw new Error('Could not change email. Please try again.');
    }
}

const getUidWithEmail = async (email: string) => {
    try {
        return await admin.auth().getUserByEmail(email);
    } catch (error) {
        return null;
    }
}
