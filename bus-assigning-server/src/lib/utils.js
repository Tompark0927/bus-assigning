import crypto from 'crypto';
export async function makeToken() {
  return crypto.randomBytes(16).toString('hex');
}
export async function tieBreakScore({ isOff, consecutive }) {
  return (isOff ? 10 : 0) - (consecutive ?? 0);
}
