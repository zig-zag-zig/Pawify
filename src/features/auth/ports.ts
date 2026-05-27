interface AccountGateway {
    sendOtp(email: string): Promise<void>;
    verifyOtp(email: string, otp: string): Promise<string>;
    revokeToken(userId: string): Promise<void>;
    changeEmail(userId: string, email: string): Promise<void>;
    deleteUserAccount(userId: string): Promise<void>;
}

interface UserAccountCache {
    deleteFollowingCache(userId: string): Promise<void>;
}

export type AuthUseCaseDependencies = {
    accountGateway: AccountGateway;
    userAccountCache: UserAccountCache;
};
