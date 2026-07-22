import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { installModuleFake } from '../../helpers/moduleFakes.js';

/**
 * Service-layer tests for the REAL passwordResetOtpService, with faked
 * firebaseInit (auth + a stateful passwordResets Firestore doc) and a capturing
 * emailService. This exercises the actual sendOtp/verifyOtp control flow +
 * HMAC storage without the firebase-tools emulators:exec getUserByEmail harness
 * limitation. Regression coverage: HMAC storage (64-char hex, no plaintext),
 * preserved origin/main messages, attempts increment, one-time consumption.
 */

const KNOWN_UID = 'known-uid-123';
const KNOWN_EMAIL = 'known@example.com';

// Stateful in-memory passwordResets store: uid -> doc data.
const resetDocs = new Map<string, Record<string, unknown>>();

// Firestore converts JS Date values to Timestamps with a toDate() method on read.
// Mimic that so the production code's `resetData.expiresAt.toDate()` works.
const toFirestoreLike = (data: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
        out[key] = value instanceof Date
            ? { toDate: () => value, seconds: Math.floor(value.getTime() / 1000), nanoseconds: 0 }
            : value;
    }
    return out;
};

// Captured OTP from the fake email service.
let capturedOtp = '';

before(() => {
    capturedOtp = '';
    resetDocs.clear();

    installModuleFake('../../src/services/emailService.js', {
        sendOtpEmail: async (_email: string, otp: string) => {
            capturedOtp = otp;
        },
    });

    installModuleFake('../../src/infrastructure/firebase/firebaseInit.js', {
        auth: {
            getUserByEmail: async (email: string) => {
                if (email === KNOWN_EMAIL) {
                    return { uid: KNOWN_UID, email };
                }
                const err = Object.assign(new Error('user not found'), { code: 'auth/user-not-found' });
                throw err;
            },
            createCustomToken: async (uid: string) => `custom-token-for-${uid}`,
        },
        db: {
            collection: (name: string) => {
                if (name !== 'passwordResets') {
                    throw new Error(`unexpected collection ${name}`);
                }
                return {
                    doc: (uid: string) => ({
                        get: async () => {
                            const data = resetDocs.get(uid);
                            return {
                                exists: data !== undefined,
                                data: () => data ? toFirestoreLike(data) : undefined,
                            };
                        },
                        set: async (value: Record<string, unknown>) => {
                            resetDocs.set(uid, { ...value });
                        },
                        update: async (patch: Record<string, unknown>) => {
                            const existing = resetDocs.get(uid) ?? {};
                            const merged: Record<string, unknown> = { ...existing };
                            for (const [key, value] of Object.entries(patch)) {
                                // Resolve Firestore FieldValue.increment(n) sentinels (the
                                // modular firestore increment() returns an object with an
                                // `operand` number; detect it generically by shape).
                                if (value && typeof value === 'object' && 'operand' in value
                                    && typeof (value as { operand?: unknown }).operand === 'number') {
                                    const prev = typeof merged[key] === 'number' ? merged[key] as number : 0;
                                    merged[key] = prev + (value as { operand: number }).operand;
                                } else {
                                    merged[key] = value;
                                }
                            }
                            resetDocs.set(uid, merged);
                        },
                        delete: async () => {
                            resetDocs.delete(uid);
                        },
                    }),
                };
            },
        },
        rtdb: {},
    });
});

describe('passwordResetOtpService (real service, faked firebase/email)', () => {
    it('sendOtp stores a 64-char HMAC otpHash with no plaintext otp, attempts 0', async () => {
        const { sendOtp } = await import('../../../src/services/account/passwordResetOtpService.js');
        resetDocs.clear();
        capturedOtp = '';

        await sendOtp(KNOWN_EMAIL);

        assert.ok(capturedOtp.length === 6, 'sendOtpEmail received a 6-digit OTP');

        const stored = resetDocs.get(KNOWN_UID);
        assert.ok(stored, 'passwordResets doc created');
        assert.match(stored.otpHash as string, /^[a-f0-9]{64}$/, 'otpHash is a 64-char HMAC hex');
        assert.equal(stored.otp, undefined, 'no plaintext otp stored');
        assert.equal(stored.attempts, 0, 'attempts initialized to 0');
    });

    it('verifyOtp with a wrong code throws "Invalid OTP" and increments attempts to 1', async () => {
        const { sendOtp, verifyOtp } = await import('../../../src/services/account/passwordResetOtpService.js');
        resetDocs.clear();
        capturedOtp = '';

        await sendOtp(KNOWN_EMAIL);
        const storedBefore = resetDocs.get(KNOWN_UID)!;

        await assert.rejects(
            () => verifyOtp(KNOWN_EMAIL, '000000'),
            (e: unknown) => (e instanceof Error ? e.message : String(e)) === 'Invalid OTP',
        );

        const storedAfter = resetDocs.get(KNOWN_UID)!;
        assert.equal(storedAfter.attempts, 1, 'attempts incremented to 1');
        // otpHash unchanged by the failed attempt.
        assert.equal(storedAfter.otpHash, storedBefore.otpHash, 'otpHash unchanged on failed attempt');
    });

    it('verifyOtp with the correct code returns a custom token and deletes the reset doc', async () => {
        const { sendOtp, verifyOtp } = await import('../../../src/services/account/passwordResetOtpService.js');
        resetDocs.clear();
        capturedOtp = '';

        await sendOtp(KNOWN_EMAIL);
        assert.ok(capturedOtp, 'OTP captured');

        const token = await verifyOtp(KNOWN_EMAIL, capturedOtp);
        assert.equal(token, `custom-token-for-${KNOWN_UID}`);

        // One-time consumption: reset doc deleted.
        assert.ok(!resetDocs.has(KNOWN_UID), 'reset doc deleted after successful verification');
    });

    it('sendOtp for an unknown email throws the preserved delivery-failed message', async () => {
        const { sendOtp } = await import('../../../src/services/account/passwordResetOtpService.js');
        await assert.rejects(
            () => sendOtp(`no-such-user-${Date.now()}@example.com`),
            (e: unknown) => (e instanceof Error ? e.message : String(e))
                === 'Could not send OTP. Please check the email address and try again.',
        );
    });

    it('verifyOtp with no reset doc throws the preserved not-found message', async () => {
        const { verifyOtp } = await import('../../../src/services/account/passwordResetOtpService.js');
        resetDocs.clear();
        await assert.rejects(
            () => verifyOtp(KNOWN_EMAIL, '123456'),
            (e: unknown) => (e instanceof Error ? e.message : String(e))
                === 'Password reset request was not found or has expired.',
        );
    });
});
