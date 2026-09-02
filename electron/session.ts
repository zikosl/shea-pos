import { safeStorage } from "electron";
import type { PosDatabase } from "./database";

export type Session = {
  endpoint: string;
  accessToken: string;
  refreshToken: string;
  accessTokenExpires?: string;
  user: { id: number; email?: string; role: string };
  offlineUntil?: string;
  lastTrustedAt?: string;
};

const SESSION_KEY = "secureSession";

export function readSession(database: PosDatabase): Session | null {
  const encrypted = database.getSetting(SESSION_KEY);
  if (!encrypted || !safeStorage.isEncryptionAvailable()) return null;
  try {
    return JSON.parse(
      safeStorage.decryptString(Buffer.from(encrypted, "base64")),
    ) as Session;
  } catch {
    return null;
  }
}

export function writeSession(database: PosDatabase, session: Session) {
  if (!safeStorage.isEncryptionAvailable())
    throw new Error("Secure credential storage is unavailable on this device");
  database.setSetting(
    SESSION_KEY,
    safeStorage.encryptString(JSON.stringify(session)).toString("base64"),
  );
}

export function clearSession(database: PosDatabase) {
  database.deleteSetting(SESSION_KEY);
}
