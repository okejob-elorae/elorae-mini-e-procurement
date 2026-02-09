import CryptoJS from 'crypto-js';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '';

// Validate key length at runtime, not build time
function validateKey(): void {
  if (ENCRYPTION_KEY && ENCRYPTION_KEY.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be exactly 32 characters');
  }
}

export function encryptBankAccount(accountNumber: string, userPin: string): string {
  validateKey();
  // Combine user PIN with server secret for key derivation
  const key = CryptoJS.PBKDF2(userPin, ENCRYPTION_KEY, {
    keySize: 256 / 32,
    iterations: 1000,
  });
  return CryptoJS.AES.encrypt(accountNumber, key.toString()).toString();
}

export function decryptBankAccount(encrypted: string, userPin: string): string {
  validateKey();
  const key = CryptoJS.PBKDF2(userPin, ENCRYPTION_KEY, {
    keySize: 256 / 32,
    iterations: 1000,
  });
  const decrypted = CryptoJS.AES.decrypt(encrypted, key.toString());
  return decrypted.toString(CryptoJS.enc.Utf8);
}

// Mask bank account for display (show only last 4 digits)
export function maskBankAccount(accountNumber: string): string {
  if (accountNumber.length <= 4) {
    return '****';
  }
  return '*'.repeat(accountNumber.length - 4) + accountNumber.slice(-4);
}
