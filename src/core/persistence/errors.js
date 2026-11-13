export class PersistenceError extends Error {
  constructor(message, { code, cause } = {}) {
    super(message, { cause })
    this.name = new.target.name
    this.code = code
  }
}

export class DatabaseUnavailableError extends PersistenceError {
  constructor(cause) {
    super('IndexedDB não está disponível neste ambiente.', { code: 'DATABASE_UNAVAILABLE', cause })
  }
}

export class DatabaseOpenError extends PersistenceError {
  constructor(cause) {
    super('Não foi possível abrir o banco local.', { code: 'DATABASE_OPEN_FAILED', cause })
  }
}

export class DatabaseBlockedError extends PersistenceError {
  constructor() {
    super('A atualização do banco foi bloqueada por outra aba aberta.', { code: 'DATABASE_BLOCKED' })
  }
}

export class DatabaseMigrationError extends PersistenceError {
  constructor(version, cause) {
    super(`A migração do banco para a versão ${version} falhou.`, {
      code: 'DATABASE_MIGRATION_FAILED',
      cause,
    })
    this.version = version
  }
}

export class DatabaseAccessError extends PersistenceError {
  constructor(operation, cause) {
    super(`Falha ao acessar os dados locais (${operation}).`, {
      code: 'DATABASE_ACCESS_FAILED',
      cause,
    })
    this.operation = operation
  }
}
