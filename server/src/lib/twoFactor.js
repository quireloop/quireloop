// otplib v13 uses a functional API — generateSecret()/generate()/verify()/
// generateURI(), not the old class-based authenticator.* singleton.
import { generateSecret, generate, verify, generateURI } from 'otplib';
import QRCode from 'qrcode';

const ISSUER = 'Quireloop';

export function createSecret() {
  return generateSecret();
}

export async function checkCode(secret, code) {
  if (!secret || !code) return false;
  const result = await verify({ secret, token: String(code) });
  return result.valid;
}

export async function enrollmentDetails(email, secret) {
  const uri = generateURI({ issuer: ISSUER, label: email, secret });
  const qrDataUrl = await QRCode.toDataURL(uri);
  return { uri, qrDataUrl };
}
