import mongoose from 'mongoose';

/**
 * Checks whether an error represents an uncertain commit outcome:
 * - UnknownTransactionCommitResult
 *
 * When this error occurs, the commit was sent to the server and may have
 * already committed. The client MUST NOT restart or re-execute the business
 * operation, as doing so would cause duplicate mutations.
 *
 * @param {Error} err
 * @returns {boolean}
 */
export function isUnknownCommitResult(err) {
  if (!err) return false;

  if (typeof err.hasErrorLabel === 'function' && err.hasErrorLabel('UnknownTransactionCommitResult')) {
    return true;
  }
  if (Array.isArray(err.errorLabels) && err.errorLabels.includes('UnknownTransactionCommitResult')) {
    return true;
  }
  if (err.errorLabelSet && typeof err.errorLabelSet.has === 'function' && err.errorLabelSet.has('UnknownTransactionCommitResult')) {
    return true;
  }
  const msg = (err.message || '').toLowerCase();
  return msg.includes('unknowntransactioncommitresult');
}

/**
 * Checks whether an error represents a genuine retryable MongoDB transaction failure:
 * - TransientTransactionError
 * - Transient write conflicts (code 112 WriteConflict)
 * - Lock acquisition timeouts (code 24 LockTimeout)
 * - NoSuchTransaction (code 251)
 *
 * IMPORTANT: UnknownTransactionCommitResult is specifically EXCLUDED from this check.
 * An uncertain commit result must NEVER trigger a full business operation retry.
 *
 * @param {Error} err
 * @returns {boolean}
 */
export function isTransientTransactionError(err) {
  if (!err) return false;

  // UnknownTransactionCommitResult is an UNCERTAIN COMMIT status, NOT a transient
  // execution error. Blindly re-running workFn on UnknownTransactionCommitResult
  // would cause duplicate orders, double inventory deductions, or duplicate audits.
  if (isUnknownCommitResult(err)) {
    return false;
  }

  // 1. Check MongoDB driver error labels
  if (typeof err.hasErrorLabel === 'function') {
    if (err.hasErrorLabel('TransientTransactionError')) {
      return true;
    }
  }

  if (Array.isArray(err.errorLabels)) {
    if (err.errorLabels.includes('TransientTransactionError')) {
      return true;
    }
  }

  if (err.errorLabelSet && typeof err.errorLabelSet.has === 'function') {
    if (err.errorLabelSet.has('TransientTransactionError')) {
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
 * Manually overrides transaction support status (useful for deterministic tests of fail-closed behavior).
 *
 * @param {boolean|null} value
 */
export function setTransactionSupportOverride(value) {
  cachedSupportsTransactions = value;
}

/**
 * Executes an operation inside a MongoDB transaction with bounded, safe retry logic.
 *
 * Uses session.withTransaction() as the primary engine:
 * - MongoDB driver handles commit uncertainty (UnknownTransactionCommitResult) by
 *   retrying commitTransaction() without re-running workFn.
 * - Genuine TransientTransactionError conditions trigger a clean, bounded retry.
 * - UnknownTransactionCommitResult that bubbles out is NEVER blindly retried at
 *   the business operation level.
 * - Standalone fallback is fail-closed by default (allowStandaloneFallback: false).
 *
 * @param {Function} workFn - async (session, attempt) => result
 * @param {Object} [options]
 * @param {number} [options.maxRetries=5] - Maximum retry attempts (bounded retry)
 * @param {number} [options.initialDelayMs=20] - Initial delay before retry (ms)
 * @param {number} [options.maxDelayMs=300] - Maximum delay before retry (ms)
 * @param {mongoose.ClientSession} [options.session] - Optional pre-existing session
 * @param {boolean} [options.allowStandaloneFallback=false] - Fall back to non-transactional execution if standalone
 * @returns {Promise<any>} Result returned by workFn
 */
export async function withTransactionRetry(workFn, options = {}) {
  const {
    maxRetries = 5,
    initialDelayMs = 20,
    maxDelayMs = 300,
    session: existingSession = null,
    allowStandaloneFallback = false
  } = options;

  const canUseTx = await supportsTransactions();

  // Production requirement: Multi-document transactions are strictly required.
  // Standalone fallback is never permitted in production mode under any circumstances.
  const isProduction = process.env.NODE_ENV === 'production';
  const effectiveStandaloneFallback = isProduction ? false : allowStandaloneFallback;

  if (!canUseTx) {
    if (effectiveStandaloneFallback) {
      // Standalone MongoDB fallback only when explicitly permitted in dev/test
      return await workFn(null, 1);
    }
    const err = new Error(
      'TRANSACTION_UNAVAILABLE: Multi-document transactions are unavailable on this MongoDB deployment.'
    );
    err.code = 'TRANSACTION_UNAVAILABLE';
    throw err;
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
        // Use session.withTransaction() as the primary engine for transaction lifecycle.
        // The MongoDB driver internally retries commitTransaction() when UnknownTransactionCommitResult
        // occurs, ensuring workFn is not executed again.
        await session.withTransaction(async (txSession) => {
          result = await workFn(txSession, attempt);
        });
        return result;
      } catch (err) {
        lastError = err;

        // If the commit outcome was uncertain, the transaction may have already succeeded on the server.
        // NEVER re-execute workFn! Propagate the uncertainty immediately so callers know not to duplicate mutations.
        if (isUnknownCommitResult(err)) {
          console.error(
            `[TransactionRetry] UnknownTransactionCommitResult on attempt ${attempt}. ` +
            `Refusing to re-execute business callback to prevent duplicate mutations.`
          );
          throw err;
        }

        // Only retry genuine TransientTransactionError conditions (e.g. WriteConflict, LockTimeout)
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

        // Non-retryable error (validation, business logic, permanent CAS conflict, or retries exhausted)
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
