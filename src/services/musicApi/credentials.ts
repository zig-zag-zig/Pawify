import { createLogger } from '../../common/logging/logger.js';
import { musicApiConfig } from '../../config/runtimeConfig.js';

const loggedMissingOptionalCredentials = new Set<string>();
const logger = createLogger('services.musicApi');

export const getMusicBrainzUserAgent = () => musicApiConfig.musicBrainzUserAgent;
export const getGeniusAccessToken = () => musicApiConfig.geniusAccessToken;
export const getDiscogsToken = () => musicApiConfig.discogsToken;

export const logMissingOptionalCredentialOnce = (name: string): void => {
    if (loggedMissingOptionalCredentials.has(name)) {
        return;
    }

    loggedMissingOptionalCredentials.add(name);
    logger.warn('optional provider credential missing', { credential: name });
};
