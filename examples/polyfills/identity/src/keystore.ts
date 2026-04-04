/**
 * Encrypted key storage — Argon2id (via @noble/hashes) + AES-256-GCM + IndexedDB
 */

import { argon2id } from '@noble/hashes/argon2.js';
import { randomBytes } from '@noble/hashes/utils.js';

const DB_NAME = 'living-web-identity';
const STORE_NAME = 'credentials';
const DB_VERSION = 1;

export interface StoredCredential {
  did: string;
  algorithm: string;
  displayName: string;
  createdAt: string;
  publicKey: string; // hex
  encryptedPrivateKey: string; // hex(salt + iv + ciphertext)
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'did' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function hexEncode(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexDecode(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  // Argon2id: m=4096 (4MB — reduced for polyfill perf), t=3, p=1
  const keyBytes = argon2id(passphrase, salt, { t: 3, m: 4096, p: 1, dkLen: 32 });
  return (crypto.subtle.importKey as any)('raw', keyBytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function encryptPrivateKey(privateKey: Uint8Array, passphrase: string): Promise<Uint8Array> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const aesKey = await deriveKey(passphrase, salt);
  const ciphertext = new Uint8Array(await (crypto.subtle.encrypt as any)({ name: 'AES-GCM', iv }, aesKey, privateKey));
  // Pack: salt(16) + iv(12) + ciphertext
  const packed = new Uint8Array(16 + 12 + ciphertext.length);
  packed.set(salt, 0);
  packed.set(iv, 16);
  packed.set(ciphertext, 28);
  return packed;
}

async function decryptPrivateKey(packed: Uint8Array, passphrase: string): Promise<Uint8Array> {
  const salt = packed.slice(0, 16);
  const iv = packed.slice(16, 28);
  const ciphertext = packed.slice(28);
  const aesKey = await deriveKey(passphrase, salt);
  try {
    return new Uint8Array(await (crypto.subtle.decrypt as any)({ name: 'AES-GCM', iv }, aesKey, ciphertext));
  } catch {
    throw new DOMException('Incorrect passphrase', 'InvalidAccessError');
  }
}

export async function storeCredential(
  did: string,
  algorithm: string,
  displayName: string,
  createdAt: string,
  publicKey: Uint8Array,
  privateKey: Uint8Array,
  passphrase: string,
): Promise<void> {
  const encrypted = await encryptPrivateKey(privateKey, passphrase);
  const record: StoredCredential = {
    did,
    algorithm,
    displayName,
    createdAt,
    publicKey: hexEncode(publicKey),
    encryptedPrivateKey: hexEncode(encrypted),
  };
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  await idbRequest(tx.objectStore(STORE_NAME).put(record));
  db.close();
}

export async function loadCredential(did: string): Promise<StoredCredential | undefined> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const record = await idbRequest(tx.objectStore(STORE_NAME).get(did));
  db.close();
  return record || undefined;
}

export async function loadAllCredentials(): Promise<StoredCredential[]> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const records = await idbRequest(tx.objectStore(STORE_NAME).getAll());
  db.close();
  return records || [];
}

export async function deleteCredential(did: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  await idbRequest(tx.objectStore(STORE_NAME).delete(did));
  db.close();
}

export async function unlockPrivateKey(stored: StoredCredential, passphrase: string): Promise<Uint8Array> {
  const encrypted = hexDecode(stored.encryptedPrivateKey);
  return decryptPrivateKey(encrypted, passphrase);
}

export async function exportEncrypted(
  privateKey: Uint8Array,
  exportPassphrase: string,
): Promise<Uint8Array> {
  return encryptPrivateKey(privateKey, exportPassphrase);
}

export async function importEncrypted(
  encrypted: Uint8Array,
  exportPassphrase: string,
): Promise<Uint8Array> {
  return decryptPrivateKey(encrypted, exportPassphrase);
}

export { hexEncode, hexDecode };
