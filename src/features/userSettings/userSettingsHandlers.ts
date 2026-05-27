import {
  optionalString,
  requireBoolean,
} from '../../common/http/validation.js';
import { BadRequestError } from '../../common/http/errors.js';
import { authenticatedHandler } from '../../infrastructure/http/authenticatedHandler.js';
import { ReleaseNotificationSettings } from '../../modules/models/models.js';
import {
  coerceReleaseNotificationLookbackMonths,
  formatReleaseNotificationLookbackMonthOptions,
} from '../../utils/types/releaseNotificationSettings.js';
import { userSettingsUseCases } from './userSettingsUseCases.js';

const getBodyRecord = (body: unknown): Record<string, unknown> => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestError('Request body must be an object');
  }

  return body as Record<string, unknown>;
};

const parseOldestReleaseDateMonths = (body: unknown): number | null => {
  const value = getBodyRecord(body).oldestReleaseDateMonths;
  const parsed = coerceReleaseNotificationLookbackMonths(value);

  if (parsed === undefined) {
    throw new BadRequestError(
      `The oldestReleaseDateMonths property in the body must be one of ${formatReleaseNotificationLookbackMonthOptions()}, null, or 0 for unlimited`,
    );
  }

  return parsed;
};

const parseReleaseNotificationSettings = (body: unknown): ReleaseNotificationSettings => {
  getBodyRecord(body);

  return {
    oldestReleaseDateMonths: parseOldestReleaseDateMonths(body),
    includeReleasesWithoutDate: requireBoolean(body, 'includeReleasesWithoutDate'),
  };
};

export const getReleaseNotificationSettingsHandler = authenticatedHandler(
  '/getReleaseNotificationSettings',
  async ({ res, userId }) => {
    res.status(200).send(await userSettingsUseCases.getReleaseNotificationSettings(userId));
  },
);

export const updateReleaseNotificationSettingsHandler = authenticatedHandler(
  '/updateReleaseNotificationSettings',
  async ({ req, res, userId }) => {
    const settings = parseReleaseNotificationSettings(req.body);
    const sourcePushToken = optionalString(req.body, 'sourcePushToken');

    res.status(200).send(await userSettingsUseCases.updateReleaseNotificationSettings(
      userId,
      settings,
      sourcePushToken,
    ));
  },
);
