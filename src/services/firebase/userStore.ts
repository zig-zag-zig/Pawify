import { UserRecord } from 'firebase-admin/auth';
import admin from '../../infrastructure/firebase/firebaseInit.js';
import {
  RequestWithAuthHeader,
  UNAUTH_MESSAGE,
} from './types.js';
import { getUserRef } from './refs.js';
import { deleteUserPushTokensFromDb } from './pushTokenStore.js';

export const getDocumentRefAndSnapshot = async (
  userId: string,
): Promise<{ snapShot: admin.firestore.DocumentData, ref: admin.firestore.DocumentReference }> => {
  if (!userId) {
    throw new Error('Invalid input: userId is required.');
  }

  const ref = getUserRef(userId);
  const documentSnapshot = await ref.get();

  if (!documentSnapshot.exists) {
    const defaultData = {};

    await ref.set(defaultData);
    return { snapShot: defaultData, ref };
  }

  const snapShot = documentSnapshot.data();

  if (!snapShot) {
    throw new Error(`Failed to retrieve data for user ${userId}`);
  }

  return { snapShot, ref };
};

export const checkAuth = async (req: RequestWithAuthHeader): Promise<string> => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error(UNAUTH_MESSAGE);
  }

  const token = authHeader.split('Bearer ')[1];

  try {
    const decodedToken = await admin.auth().verifyIdToken(token, true);
    return decodedToken.uid;
  } catch {
    throw new Error(UNAUTH_MESSAGE);
  }
};

export const getAllUsers = async (): Promise<UserRecord[]> => {
  let users: UserRecord[] = [];
  let nextPageToken: string | undefined;

  do {
    const result = await admin.auth().listUsers(1000, nextPageToken);
    users = users.concat(result.users);
    nextPageToken = result.pageToken;
  } while (nextPageToken);

  return users;
};

export const deleteUserAccount = async (userId: string): Promise<void> => {
  if (!userId) {
    throw new Error('Invalid input: userId is required.');
  }
  await admin.auth().deleteUser(userId);
  await Promise.all([
    getUserRef(userId).delete(),
    deleteUserPushTokensFromDb(userId),
  ]);
};
