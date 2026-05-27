import * as admin from 'firebase-admin';
import * as fs from "fs";
import { createLogger } from '../../common/logging/logger.js';
import { firebaseAdminConfig } from '../../config/runtimeConfig.js';

const logger = createLogger('infrastructure.firebase');

const loadServiceAccount = (): admin.ServiceAccount => {
  if (firebaseAdminConfig.serviceAccountJson) {
    return JSON.parse(firebaseAdminConfig.serviceAccountJson) as admin.ServiceAccount;
  }

  const filePath = firebaseAdminConfig.credentialsFilePath;
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error('Firebase credentials are not configured. Set FIREBASE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS.');
  }

  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as admin.ServiceAccount;
};

try {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(loadServiceAccount()),
      ...(firebaseAdminConfig.databaseURL ? { databaseURL: firebaseAdminConfig.databaseURL } : {}),
    });
  }

  logger.info('firebase admin initialized');
} catch (error) {
  logger.error('firebase admin initialization failed', { error });
  throw error;
}

export const db = admin.firestore();
export const rtdb = admin.database();

export default admin;
