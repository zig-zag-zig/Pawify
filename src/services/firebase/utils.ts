import type { DocumentReference } from 'firebase-admin/firestore';
import type { FollowedArtistSummary } from '../../utils/types/followedArtistTypes.js';

export const makeDeepCopy = <T>(data: T): T => JSON.parse(JSON.stringify(data));

export const isPlainObject = (value: unknown): value is Record<string, unknown> => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);

export const stripDiscogsUrls = (artistSummary: FollowedArtistSummary): FollowedArtistSummary => {
  const { discogsUrls: _discogsUrls, ...summary } = artistSummary as FollowedArtistSummary & {
    discogsUrls?: unknown;
  };

  return summary;
};

export const getParentUserIdFromSubcollectionDocument = (
  documentReference: DocumentReference,
): string | null => {
  return documentReference.parent.parent?.id ?? null;
};
