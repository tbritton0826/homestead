const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

async function transaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

async function migrate(pool) {
  return transaction(pool, async client => {
    // One lock for all migration runners, including simultaneous container starts.
    await client.query('SELECT pg_advisory_xact_lock(73126401)');
    await client.query('CREATE TABLE IF NOT EXISTS customer_schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    const directory = path.join(__dirname, 'migrations');
    for (const name of (await fs.readdir(directory)).filter(name => /^\d+.*\.sql$/.test(name)).sort()) {
      const sql = await fs.readFile(path.join(directory, name), 'utf8');
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');
      const existing = (await client.query('SELECT checksum FROM customer_schema_migrations WHERE name=$1', [name])).rows[0];
      if (existing && existing.checksum !== checksum) throw new Error('Applied customer migration has changed');
      if (existing) continue;
      await client.query(sql);
      await client.query('INSERT INTO customer_schema_migrations(name,checksum) VALUES($1,$2)', [name, checksum]);
    }
  });
}

function createPool(env = process.env) {
  if (!env.HOMESTEAD_CUSTOMER_DATABASE_URL) throw new Error('Customer database URL is required');
  const url=new URL(env.HOMESTEAD_CUSTOMER_DATABASE_URL);
  if (env.HOMESTEAD_CUSTOMER_DB_TLS==='true' && [...url.searchParams.keys()].some(key=>key.startsWith('ssl')))
    throw new Error('Configure database TLS through the customer TLS flag, without overriding SSL URL parameters');
  const { Pool } = require('pg');
  const pool=new Pool({ connectionString: env.HOMESTEAD_CUSTOMER_DATABASE_URL, max: 10,
    connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000, statement_timeout: 30000,
    ssl: env.HOMESTEAD_CUSTOMER_DB_TLS === 'true' ? { rejectUnauthorized: true } : undefined });
  // Idle connections can disappear during a database restart. Keep the service
  // alive; a subsequent query obtains a fresh connection and health reports failures.
  pool.on('error',()=>console.error('Customer database connection interrupted.'));
  return pool;
}
module.exports = { transaction, migrate, createPool };
