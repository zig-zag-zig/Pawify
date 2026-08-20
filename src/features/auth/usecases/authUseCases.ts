import { BadRequestError } from '../../../common/http/errors.js';
import type { AuthUseCaseDependencies } from '../ports.js';

const mapAccountError = (error: unknown): never => {
    const message = error instanceof Error ? error.message : 'Account operation failed';

    if (message === 'User not found') {
        throw new BadRequestError('Invalid or expired password reset request.');
    }

    throw new BadRequestError(message);
};

export const createSendOtpUseCase =
    ({ accountGateway }: Pick<AuthUseCaseDependencies, 'accountGateway'>) =>
    async (email: string): Promise<void> => {
        try {
            await accountGateway.sendOtp(email);
        } catch (error) {
            mapAccountError(error);
        }
    };

export const createVerifyOtpUseCase =
    ({ accountGateway }: Pick<AuthUseCaseDependencies, 'accountGateway'>) =>
    async (email: string, otp: string): Promise<string> => {
        try {
            return await accountGateway.verifyOtp(email, otp);
        } catch (error) {
            return mapAccountError(error);
        }
    };

export const createRevokeTokenUseCase =
    ({ accountGateway }: Pick<AuthUseCaseDependencies, 'accountGateway'>) =>
    async (userId: string): Promise<void> => {
        try {
            await accountGateway.revokeToken(userId);
        } catch (error) {
            const message =
                error instanceof Error
                    ? error.message
                    : 'Could not update the sign-in session. Please try again.';
            throw new BadRequestError(message);
        }
    };

export const createChangeEmailUseCase =
    ({ accountGateway }: Pick<AuthUseCaseDependencies, 'accountGateway'>) =>
    async (userId: string, email: string): Promise<void> => {
        try {
            await accountGateway.changeEmail(userId, email);
        } catch (error) {
            const message =
                error instanceof Error
                    ? error.message
                    : 'Could not change email. Please try again.';
            throw new BadRequestError(message);
        }
    };

export const createDeleteUserAccountUseCase =
    ({ accountGateway, userAccountCache }: AuthUseCaseDependencies) =>
    async (userId: string): Promise<void> => {
        await accountGateway.deleteUserAccount(userId);
        await userAccountCache.deleteFollowingCache(userId);
    };
