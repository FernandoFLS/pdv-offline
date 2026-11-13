import { describe, expect, it } from 'vitest'
import {
  createPinCredential,
  PIN_KDF_ITERATIONS,
  verifyPinCredential,
} from './pin-credentials.js'

describe('credenciais PIN', () => {
  it('armazena somente derivação, salt aleatório e parâmetros do PBKDF2', async () => {
    const first = await createPinCredential('001234')
    const second = await createPinCredential('001234')

    expect(first).toMatchObject({
      version: 1,
      algorithm: 'PBKDF2',
      hash: 'SHA-256',
      iterations: PIN_KDF_ITERATIONS,
    })
    expect(first.salt).not.toBe(second.salt)
    expect(first.derivedKey).not.toBe('001234')
    expect(first).not.toHaveProperty('pin')
    await expect(verifyPinCredential('001234', first)).resolves.toBe(true)
    await expect(verifyPinCredential('001235', first)).resolves.toBe(false)
  })

  it('recusa PIN curto ou não numérico', async () => {
    await expect(createPinCredential('12345')).rejects.toMatchObject({ code: 'INVALID_PIN' })
    await expect(createPinCredential('12a456')).rejects.toMatchObject({ code: 'INVALID_PIN' })
  })

  it('informa quando Web Crypto não está disponível', async () => {
    await expect(createPinCredential('123456', null)).rejects.toMatchObject({
      code: 'CRYPTO_UNAVAILABLE',
    })
  })
})
