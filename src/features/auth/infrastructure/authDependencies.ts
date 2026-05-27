import {
    changeEmail,
    revokeToken,
    sendOtp,
    verifyOtp,
} from '../../../services/accountService.js';
import { deleteUserAccount as deleteFirebaseUserAccount } from '../../../services/firebaseService.js';
import { invalidateFollowingArtistIdsCache } from '../../../utils/helpers/followingHelper.js';
import type { AuthUseCaseDependencies } from '../ports.js';

export const authDependencies: AuthUseCaseDependencies = {
    accountGateway: {
        changeEmail,
        deleteUserAccount: deleteFirebaseUserAccount,
        revokeToken,
        sendOtp,
        verifyOtp,
    },
    userAccountCache: {
        deleteFollowingCache: async (userId) => {
            invalidateFollowingArtistIdsCache(userId);
        },
    },
};
