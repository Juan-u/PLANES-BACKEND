function defaultReleaseErrorReporter(error, context) {
  const outcome = context.commitSucceeded
    ? 'after a successful commit; the transaction remains committed'
    : 'while the transaction outcome was not confirmed as committed';
  const diagnostic = new Error(`mysql2 connection release failed ${outcome}.`, { cause: error });
  diagnostic.code = 'MYSQL_TRANSACTION_RELEASE_FAILED';
  process.emitWarning(diagnostic);
}

/**
 * Creates a transaction runner for a mysql2/promise pool.
 * Repositories receive a narrow query capability bound to the dedicated connection;
 * the pool and connection lifecycle methods are not exposed through `tx`.
 *
 * A release failure after commit is reported through onReleaseError (or a process
 * warning by default), but does not reject the already-committed operation. When
 * another error is already propagating, that original error remains authoritative.
 */
export function createMysqlTransactionManager(pool, options = {}) {
  if (!pool || typeof pool.getConnection !== 'function') {
    throw new TypeError('A mysql2/promise pool with getConnection() is required.');
  }

  const onReleaseError = typeof options?.onReleaseError === 'function'
    ? options.onReleaseError
    : defaultReleaseErrorReporter;

  return Object.freeze({
    async run(work) {
      if (typeof work !== 'function') {
        throw new TypeError('Transaction work must be a function.');
      }

      let connection;
      let transactionStarted = false;
      let commitSucceeded = false;
      let originalError;

      try {
        connection = await pool.getConnection();
        await connection.beginTransaction();
        transactionStarted = true;

        const tx = Object.freeze({
          query: (...args) => connection.query(...args),
          execute: (...args) => connection.execute(...args)
        });

        // Any normal return is a successful transaction result, including { ok: false }.
        const result = await work(tx);
        await connection.commit();
        transactionStarted = false;
        commitSucceeded = true;
        return result;
      } catch (error) {
        originalError = error;
        if (connection && transactionStarted) {
          try {
            await connection.rollback();
          } catch {
            // Preserve the original work/commit error.
          }
          transactionStarted = false;
        }
        throw error;
      } finally {
        if (connection) {
          try {
            await connection.release();
          } catch (releaseError) {
            try {
              await onReleaseError(releaseError, {
                commitSucceeded,
                originalError
              });
            } catch (reportingError) {
              // A failing diagnostic hook must not change the transaction outcome.
              process.emitWarning(new Error(
                'mysql2 release failure diagnostic callback failed.',
                { cause: reportingError }
              ));
            }
          }
        }
      }
    }
  });
}