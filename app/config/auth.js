import 'dotenv/config';

const MIN_JWT_SECRET_BYTES = 32;

export function validateJwtSecret(secret) {
  if (typeof secret !== 'string') {
    throw new Error('JWT_SECRET debe ser una clave Base64URL de al menos 32 bytes.');
  }

  const decoded = Buffer.from(secret, 'base64url');
  const isCanonical = decoded.toString('base64url') === secret;
  const hasSufficientVariation = new Set(decoded).size >= 16;

  if (
    !isCanonical ||
    decoded.length < MIN_JWT_SECRET_BYTES ||
    !hasSufficientVariation
  ) {
    throw new Error('JWT_SECRET debe ser una clave Base64URL de al menos 32 bytes.');
  }

  return secret;
}

export const JWT_SECRET = validateJwtSecret(process.env.JWT_SECRET);
