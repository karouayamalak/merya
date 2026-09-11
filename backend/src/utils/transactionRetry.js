import mongoose from 'mongoose';

/**
 * Checks whether an error represents a retryable MongoDB transaction failure:
 * - TransientTransactionError
 * - UnknownTransactionCommitResult
 * - Transient write conflicts (code 112 WriteConflict)
 * - Lock acquisition timeouts (code 24 LockTimeout)
 * - NoSuchTransaction (code 251)
 *
 * @param {Error} err
 * @returns {boolean}
 */
export function isTransientTransactionError(err) {
  if (!err) return false;

  // 1. Check MongoDB driver error labels
  if (typeof err.hasErrorLabel === 'function') {
    if (err.hasErrorLabel('TransientTransactionError') || err.hasErrorLabel('UnknownTransactionCommitResult')) {
      return true;
    }
  }

  if (Array.isArray(err.errorLabels)) {
    if (err.errorLabels.includes('TransientTransactionError') || err.errorLabels.includes('UnknownTransactionCommitResult')) {
      return true;
    }
  }

  if (err.errorLabelSet && typeof err.errorLabelSet.has === 'function') {
    if (err.errorLabelSet.has('TransientTransactionError') || err.errorLabelSet.has('UnknownTransactionCommitResult')) {
      return true;
    }
  }

  // 2. Check specific transient error codes
  // 112: WriteConflict, 24: LockTimeout, 251: NoSuchTransaction
  if (err.code === 112 || err.code === 24 || err.code === 251) {
    return true;
  }

  if (err.codeName === 'WriteConflict' || err.codeName === 'LockTimeout' || err.codeName === 'NoSuchTransaction') {
    return true;
  }

  // 3. String matching on error message for nested or wrapped driver errors
  const msg = (err.message || '').toLowerCase();
  if (
    msg.includes('writeconflict') ||
    msg.includes('locktimeout') ||
    msg.includes('transienttransactionerror') ||
    msg.includes('unknowntransactioncommitresult') ||
    msg.includes('unable to acquire ix lock') ||
    msg.includes('due to catalog changes')
  ) {
    return true;
  }

  return false;
}

/**
 * Checks if the current MongoDB connection supports multi-document transactions (replica set or mongos).
 *
 * @returns {boolean}
 */
let cachedSupportsTransactions = null;
export async function supportsTransactions() {
  if (cachedSupportsTransactions !== null) {
    return cachedSupportsTransactions;
  }

  try {
    if (!mongoose.connection || mongoose.connection.readyState !== 1) {
      return false;
    }
    const adminDb = mongoose.connection.db.admin();
    const hello = await adminDb.command({ hello: 1 }).catch(() => adminDb.command({ isMaster: 1 }));
    cachedSupportsTransactions = !!(hello.setName || hello.hosts || hello.msg === 'isdbgrid');
  } catch {
    cachedSupportsTransactions = false;
  }
  return cachedSupportsTransactions;
}

/**
 * Clears the cached transaction support status (useful for tests reconnecting to different DBs).
 */
export function resetTransactionSupportCache() {
  cachedSupportsTransactions = null;
}

/**
 * Executes an operation inside a MongoDB transaction with bounded, safe retry logic.
 *
 * @param {Function} workFn - async (session, attempt) => result
 * @param {Object} [options]
 * @param {number} [options.maxRetries=5] - Maximum retry attempts (bounded retry)
 * @param {number} [options.initialDelayMs=20] - Initial delay before retry (ms)
 * @param {number} [options.maxDelayMs=300] - Maximum delay before retry (ms)
 * @param {mongoose.ClientSession} [options.session] - Optional pre-existing session
 * @param {boolean} [options.allowStandaloneFallback=true] - Fall back to non-transactional execution if standalone
 * @returns {Promise<any>} Result returned by workFn
 */
export async function withTransactionRetry(workFn, options = {}) {
  const {
    maxRetries = 5,
    initialDelayMs = 20,
    maxDelayMs = 300,
    session: existingSession = null,
    allowStandaloneFallback = true
  } = options;

  const canUseTx = await supportsTransactions();

  if (!canUseTx && allowStandaloneFallback) {
    // Standalone MongoDB does not support multi-document transactions
    return await workFn(null, 1);
  }

  const isOuterSession = !!existingSession;
  const session = existingSession || (await mongoose.startSession());

  let attempt = 0;
  let lastError = null;

  try {
    while (attempt < maxRetries) {
      attempt++;
      try {
        let result;
        // Use session.withTransaction() as the primary engine for transaction lifecycle
        await session.withTransaction(async (txSession) => {
          // Inside withTransaction, txSession is the active session
          result = await workFn(txSession, attempt);
        });
        return result;
      } catch (err) {
        lastError = err;

        // Check if error is transient and retryable
        if (isTransientTransactionError(err)) {
          if (attempt < maxRetries) {
            const delay = Math.min(
              initialDelayMs * Math.pow(2, attempt - 1) + Math.random() * 15,
              maxDelayMs
            );
            console.warn(
              `[TransactionRetry] Transient failure on attempt ${attempt}/${maxRetries} (${err.codeName || err.message}). Retrying in ${Math.round(delay)}ms...`
            );
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          }
        }

        // Non-retryable error or retries exhausted
        throw err;
      }
    }

    throw lastError || new Error(`Transaction failed after ${maxRetries} attempts`);
  } finally {
    if (!isOuterSession) {
      await session.endSession();
    }
  }
}
