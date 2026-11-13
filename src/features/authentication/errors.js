export class AuthenticationError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'AuthenticationError'
    this.code = code
    Object.assign(this, details)
  }
}
