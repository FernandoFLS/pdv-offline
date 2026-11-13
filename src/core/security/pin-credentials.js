const CREDENTIAL_VERSION = 1
const ITERATIONS = 600_000
const MIN_STORED_ITERATIONS = 100_000
const MAX_STORED_ITERATIONS = 1_000_000
const SALT_BYTES = 16
const DERIVED_KEY_BITS = 256

export const PIN_KDF_ITERATIONS = ITERATIONS

function requireCrypto(cryptoProvider) {
  if (!cryptoProvider?.subtle || !cryptoProvider?.getRandomValues) {
    const error = new Error('Web Crypto não está disponível em um contexto seguro.')
    error.code = 'CRYPTO_UNAVAILABLE'
    throw error
  }
  return cryptoProvider
}

function encodeHex(bytes) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function decodeHex(value) {
  if (typeof value !== 'string' || !/^(?:[\da-f]{2})+$/i.test(value)) return null
  return Uint8Array.from(value.match(/.{2}/g), (byte) => Number.parseInt(byte, 16))
}

function isPin(pin) {
  return typeof pin === 'string' && /^\d{6,}$/.test(pin)
}

async function derive(pin, salt, iterations, cryptoProvider) {
  const key = await cryptoProvider.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  return cryptoProvider.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    DERIVED_KEY_BITS,
  )
}

export async function createPinCredential(pin, cryptoProvider = globalThis.crypto) {
  if (!isPin(pin)) {
    const error = new TypeError('O PIN deve conter pelo menos 6 dígitos numéricos.')
    error.code = 'INVALID_PIN'
    throw error
  }

  const crypto = requireCrypto(cryptoProvider)
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const derivedKey = await derive(pin, salt, ITERATIONS, crypto)

  return {
    version: CREDENTIAL_VERSION,
    algorithm: 'PBKDF2',
    hash: 'SHA-256',
    iterations: ITERATIONS,
    salt: encodeHex(salt),
    derivedKey: encodeHex(derivedKey),
  }
}

export async function verifyPinCredential(pin, credential, cryptoProvider = globalThis.crypto) {
  if (!isPin(pin) || !credential || credential.version !== CREDENTIAL_VERSION ||
      credential.algorithm !== 'PBKDF2' || credential.hash !== 'SHA-256' ||
      !Number.isInteger(credential.iterations) ||
      credential.iterations < MIN_STORED_ITERATIONS ||
      credential.iterations > MAX_STORED_ITERATIONS) {
    return false
  }

  const salt = decodeHex(credential.salt)
  const expected = decodeHex(credential.derivedKey)
  if (!salt || salt.length !== SALT_BYTES || !expected || expected.length !== DERIVED_KEY_BITS / 8) {
    return false
  }

  const crypto = requireCrypto(cryptoProvider)
  const actual = new Uint8Array(await derive(pin, salt, credential.iterations, crypto))
  let difference = actual.length ^ expected.length
  for (let index = 0; index < actual.length; index += 1) {
    difference |= actual[index] ^ expected[index]
  }
  return difference === 0
}
