// Operator-only batch publication. Reads credentials only from the deployment environment.
const fs=require('node:fs/promises');
const {createPool}=require('../src/server/customer/database.cjs');
const {createStripeProvider}=require('../src/server/customer/providers/stripe.cjs');
const {reviewedPlans,publishCatalogRelease}=require('../src/server/customer/catalog-release.cjs');

async function main() {
  const [file,action='--check',...extra]=process.argv.slice(2);
  if(!file || !['--check','--publish'].includes(action) || extra.length)throw new Error('Usage: node scripts/publish-stripe-catalog.cjs reviewed-plans.json [--check|--publish]');
  const input=JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,''));reviewedPlans(input);
  if(process.env.HOMESTEAD_PAYMENT_MODE!=='test')throw new Error('Set HOMESTEAD_PAYMENT_MODE=test on the dedicated customer service.');
  if(!process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_'))throw new Error('Configure STRIPE_SECRET_KEY with the secret key for the same Stripe sandbox as these six Prices. Do not paste it into chat.');
  const provider=createStripeProvider(process.env),pool=createPool();
  try {
    const result=await publishCatalogRelease({pool,provider,input,publish:action==='--publish'});
    console.log(JSON.stringify(result,null,2));
  }finally{await pool.end();}
}
if(require.main===module)main().catch(error=>{
  // Stripe and database exceptions can contain request/account details: print only our safe messages.
  const safe=error.status || /^(Usage:|Set HOMESTEAD_|Configure STRIPE_SECRET_KEY)/.test(error.message || '');
  console.error(safe?error.message:'Catalog publication failed. Check sandbox credentials, the six Price objects, and database access. No partial release was committed.');process.exitCode=1;
});
module.exports={main};
