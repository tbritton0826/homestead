// Deployment CLI only. No administrator write route is exposed to customer browsers.
const fs=require('node:fs/promises');
const {createPool,migrate}=require('../src/server/customer/database.cjs');
const {seedDrafts,publishPlan}=require('../src/server/customer/catalog.cjs');
const {createStripeProvider}=require('../src/server/customer/providers/stripe.cjs');
async function main() {
  const pool=createPool();
  try {
    await migrate(pool);await seedDrafts(pool);
    if(process.argv[2]==='publish-plan') {
      if(!process.argv[3])throw new Error('Supply a reviewed plan JSON file');
      const input=JSON.parse(await fs.readFile(process.argv[3],'utf8'));
      await publishPlan(pool,input,input.amount>0?createStripeProvider(process.env):null);
      console.log('Approved test plan published.');
    } else if(process.argv[2]==='disable-plan') {
      await pool.query('UPDATE customer_plans SET active=false WHERE id=$1',[process.argv[3]]);console.log('Plan disabled for new checkout.');
    } else if(process.argv[2]==='status') {
      console.log(JSON.stringify((await pool.query('SELECT name,applied_at FROM customer_schema_migrations ORDER BY name')).rows));
    } else if(process.argv[2] && process.argv[2]!=='migrate')throw new Error('Unknown command');
    else console.log('Customer database migrations and draft catalog ready.');
  }finally{await pool.end();}
}
main().catch(()=>{console.error('Customer administration failed. Check database access, command arguments, and reviewed configuration.');process.exitCode=1;});
