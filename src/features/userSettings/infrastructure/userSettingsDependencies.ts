import {
  getFollowingFromDb,
  getReleaseNotificationSettingsFromDb,
  saveReleaseNotificationSettingsToDb,
} from '../../../services/firebaseService.js';
import { replaceKnownArtistReleaseIdsInDb } from '../../../services/firebase/knownReleasesStore.js';
import {
  readNewReleasesState,
  writeNewReleasesState,
} from '../../../services/firebase/newReleasesStore.js';
import { fetchAllReleasesForArtist } from '../../../services/musicbrainz/releaseQueries.js';
import { sendDataOnlyNotification } from '../../../services/notificationService.js';
import { releaseDateMatchesNotificationSettings } from '../../../utils/helpers/releaseNotificationFilter.js';
import type { UserSettingsUseCaseDependencies } from '../ports.js';

export const userSettingsDependencies: UserSettingsUseCaseDependencies = {
  followedArtistsRepository: {
    getFollowedArtistIds: async (userId) => await getFollowingFromDb(userId),
  },
  knownReleaseRepository: {
    replaceArtistReleaseIds: async (userId, artistId, releaseIds) => {
      await replaceKnownArtistReleaseIdsInDb(userId, artistId, releaseIds);
    },
  },
  newReleaseRepository: {
    removeReleasesOutsideSettings: async (userId, settings) => {
      const currentState = await readNewReleasesState(userId);
      const updatedState = Object.fromEntries(
        Object.entries(currentState).filter(([, release]) => (
          releaseDateMatchesNotificationSettings(release.date, settings)
        )),
      );

      if (Object.keys(updatedState).length !== Object.keys(currentState).length) {
        await writeNewReleasesState(userId, updatedState);
      }
    },
  },
  releaseCatalogGateway: {
    getArtistReleases: async (artistId) => await fetchAllReleasesForArtist(artistId, false),
  },
  releaseNotificationSettingsRepository: {
    getSettings: async (userId) => await getReleaseNotificationSettingsFromDb(userId),
    saveSettings: async (userId, settings) => await saveReleaseNotificationSettingsToDb(userId, settings),
  },
  userSettingsNotifier: {
    notifySettingsChanged: async (userId, settings, sourcePushToken) => {
      await sendDataOnlyNotification(userId, 'releaseNotificationSettings', {
        settings,
        sourcePushToken,
      }, {
        excludePushToken: sourcePushToken,
      });
    },
    notifyReleasesChanged: async (userId, sourcePushToken) => {
      await sendDataOnlyNotification(userId, 'releases', {
        sourcePushToken,
      }, {
        excludePushToken: sourcePushToken,
      });
    },
  },
};
