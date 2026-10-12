const {PGlite}=require('@electric-sql/pglite');
const crypto=require('node:crypto');
async function testPool(directory) {
  if(process.env.HOMESTEAD_CUSTOMER_TEST_DATABASE_URL) {
    const {Pool}=require('pg');
    const schema=`customer_test_${crypto.randomBytes(8).toString('hex')}`;
    const admin=new Pool({connectionString:process.env.HOMESTEAD_CUSTOMER_TEST_DATABASE_URL});
    await admin.query(`CREATE SCHEMA ${schema}`);
    const pool=new Pool({connectionString:process.env.HOMESTEAD_CUSTOMER_TEST_DATABASE_URL,options:`-c search_path=${schema}`});
    const end=pool.end.bind(pool);
    pool.end=async()=>{await end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();};
    return pool;
  }
  // PGlite executes the same PostgreSQL SQL locally; serialize its single connection.
  const database=new PGlite(directory);await database.waitReady;
  let tail=Promise.resolve();
  async function acquire() {let release;const before=tail;tail=new Promise(resolve=>{release=resolve;});await before;return release;}
  async function query(sql,values) {
    if(sql==='SELECT pg_advisory_xact_lock(73126401)')return {rows:[]}; // Serialized local connection; real PG CI exercises the lock.
    if(!values && sql.includes(';')) {await database.exec(sql);return {rows:[]};}
    const result=await database.query(sql,values);return {rows:result.rows,rowCount:result.affectedRows};
  }
  return {
    async connect(){const release=await acquire();return {query,release};},
    async query(sql,values){const release=await acquire();try{return await query(sql,values);}finally{release();}},
    end:()=>database.close(),engine:'PGlite',
  };
}
module.exports={testPool};
