import { DatabaseAccessError } from './errors.js'

export function runTransaction(database, storeNames, mode, schedule) {
  let transaction
  try {
    transaction = database.transaction(storeNames, mode)
  } catch (error) {
    return Promise.reject(new DatabaseAccessError('transação', error))
  }

  return new Promise((resolve, reject) => {
    let result
    let operationError

    transaction.oncomplete = () => resolve(result)
    transaction.onabort = () => reject(
      operationError ?? new DatabaseAccessError('transação', transaction.error),
    )

    const controls = {
      setResult(value) {
        result = value
      },
      abort(error) {
        operationError = error
        try {
          transaction.abort()
        } catch {
          reject(error)
        }
      },
    }

    try {
      schedule(transaction, controls)
    } catch (error) {
      controls.abort(error)
    }
  })
}
