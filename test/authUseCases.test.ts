import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BadRequestError } from '../src/common/http/errors.js';
import {
    createSendOtpUseCase,
    createVerifyOtpUseCase,
    createRevokeTokenUseCase,
    createChangeEmailUseCase,
    createDeleteUserAccountUseCase,
} from '../src/features/auth/usecases/authUseCases.js';
import type { AuthUseCaseDependencies } from '../src/features/auth/ports.js';

const createFakeDependencies = (
    overrides: Partial<AuthUseCaseDependencies> = {},
): AuthUseCaseDependencies => ({
    accountGateway: {
        async sendOtp() { },
        async verifyOtp() { return 'token-123'; },
        async revokeToken() { },
        async changeEmail() { },
        async deleteUserAccount() { },
        ...overrides.accountGateway,
    },
    userAccountCache: {
        async deleteFollowingCache() { },
        ...overrides.userAccountCache,
    },
});

describe('auth use cases', () => {
    describe('sendOtp', () => {
        it('calls accountGateway.sendOtp with the email', async () => {
            let calledWith: string | undefined;
            const deps = createFakeDependencies({
                accountGateway: {
                    ...createFakeDependencies().accountGateway,
                    async sendOtp(email) { calledWith = email; },
                },
            });
            const useCase = createSendOtpUseCase(deps);

            await useCase('user@example.com');
            assert.equal(calledWith, 'user@example.com');
        });

        it('throws BadRequestError for "User not found" gateway error', async () => {
            const deps = createFakeDependencies({
                accountGateway: {
                    ...createFakeDependencies().accountGateway,
                    async sendOtp() { throw new Error('User not found'); },
                },
            });
            const useCase = createSendOtpUseCase(deps);

            await assert.rejects(
                () => useCase('bad@example.com'),
                (error) => error instanceof BadRequestError
                    && error.message === 'Invalid or expired password reset request.',
            );
        });

        it('throws BadRequestError with original message for other errors', async () => {
            const deps = createFakeDependencies({
                accountGateway: {
                    ...createFakeDependencies().accountGateway,
                    async sendOtp() { throw new Error('Service unavailable'); },
                },
            });
            const useCase = createSendOtpUseCase(deps);

            await assert.rejects(
                () => useCase('user@example.com'),
                (error) => error instanceof BadRequestError
                    && error.message === 'Service unavailable',
            );
        });
    });

    describe('verifyOtp', () => {
        it('returns the token on success', async () => {
            const deps = createFakeDependencies({
                accountGateway: {
                    ...createFakeDependencies().accountGateway,
                    async verifyOtp() { return 'reset-token-abc'; },
                },
            });
            const useCase = createVerifyOtpUseCase(deps);

            const result = await useCase('user@example.com', '123456');
            assert.equal(result, 'reset-token-abc');
        });

        it('throws BadRequestError on gateway error', async () => {
            const deps = createFakeDependencies({
                accountGateway: {
                    ...createFakeDependencies().accountGateway,
                    async verifyOtp() { throw new Error('Invalid OTP'); },
                },
            });
            const useCase = createVerifyOtpUseCase(deps);

            await assert.rejects(
                () => useCase('user@example.com', '000000'),
                (error) => error instanceof BadRequestError && error.message === 'Invalid OTP',
            );
        });
    });

    describe('revokeToken', () => {
        it('calls accountGateway.revokeToken with the userId', async () => {
            let calledWith: string | undefined;
            const deps = createFakeDependencies({
                accountGateway: {
                    ...createFakeDependencies().accountGateway,
                    async revokeToken(userId) { calledWith = userId; },
                },
            });
            const useCase = createRevokeTokenUseCase(deps);

            await useCase('user-1');
            assert.equal(calledWith, 'user-1');
        });

        it('throws BadRequestError on gateway error', async () => {
            const deps = createFakeDependencies({
                accountGateway: {
                    ...createFakeDependencies().accountGateway,
                    async revokeToken() { throw new Error('Session not found'); },
                },
            });
            const useCase = createRevokeTokenUseCase(deps);

            await assert.rejects(
                () => useCase('user-1'),
                (error) => error instanceof BadRequestError
                    && error.message === 'Session not found',
            );
        });
    });

    describe('changeEmail', () => {
        it('calls accountGateway.changeEmail with userId and email', async () => {
            const calls: Array<{ userId: string; email: string }> = [];
            const deps = createFakeDependencies({
                accountGateway: {
                    ...createFakeDependencies().accountGateway,
                    async changeEmail(userId, email) { calls.push({ userId, email }); },
                },
            });
            const useCase = createChangeEmailUseCase(deps);

            await useCase('user-1', 'new@example.com');
            assert.deepEqual(calls, [{ userId: 'user-1', email: 'new@example.com' }]);
        });

        it('throws BadRequestError on gateway error', async () => {
            const deps = createFakeDependencies({
                accountGateway: {
                    ...createFakeDependencies().accountGateway,
                    async changeEmail() { throw new Error('Email already in use'); },
                },
            });
            const useCase = createChangeEmailUseCase(deps);

            await assert.rejects(
                () => useCase('user-1', 'dup@example.com'),
                (error) => error instanceof BadRequestError
                    && error.message === 'Email already in use',
            );
        });
    });

    describe('deleteUserAccount', () => {
        it('deletes account and clears following cache', async () => {
            const calls: string[] = [];
            const deps = createFakeDependencies({
                accountGateway: {
                    ...createFakeDependencies().accountGateway,
                    async deleteUserAccount(userId) { calls.push(`delete:${userId}`); },
                },
                userAccountCache: {
                    async deleteFollowingCache(userId) { calls.push(`clearCache:${userId}`); },
                },
            });
            const useCase = createDeleteUserAccountUseCase(deps);

            await useCase('user-1');
            assert.deepEqual(calls, ['delete:user-1', 'clearCache:user-1']);
        });

        it('propagates gateway errors without wrapping', async () => {
            const deps = createFakeDependencies({
                accountGateway: {
                    ...createFakeDependencies().accountGateway,
                    async deleteUserAccount() { throw new Error('Cannot delete admin'); },
                },
            });
            const useCase = createDeleteUserAccountUseCase(deps);

            await assert.rejects(
                () => useCase('admin-1'),
                (error) => error instanceof Error && error.message === 'Cannot delete admin',
            );
        });
    });
});
