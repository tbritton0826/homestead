const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {failure}=require('./security.cjs');

function signingFile(env) {
  return env.HOMESTEAD_CUSTOMER_LICENSE_PRIVATE_KEY_FILE || path.join(env.HOMESTEAD_DATA_DIR || '/app/data','customer-license-key.pem');
}
function licenseSigningKey(env=process.env) {
  let value=env.HOMESTEAD_CUSTOMER_LICENSE_PRIVATE_KEY?.replace(/\\n/g,'\n');
  if(!value)try{value=fs.readFileSync(signingFile(env),'utf8');}catch{throw failure(503,'Server activation is not configured yet.');}
  try {
    const key=crypto.createPrivateKey(value);
    if(key.asymmetricKeyType!=='ed25519')throw new Error('Wrong signing algorithm');
    return key;
  } catch {throw failure(503,'Server activation signing is not configured correctly.');}
}
function initializeSigningKey(env=process.env) {
  if(env.HOMESTEAD_CUSTOMER_LICENSE_PRIVATE_KEY)throw new Error('An activation signing key is already configured.');
  const file=signingFile(env);
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  const {privateKey}=crypto.generateKeyPairSync('ed25519');
  // Exclusive creation prevents rotation, data loss, and silent trust changes.
  fs.writeFileSync(file,privateKey.export({type:'pkcs8',format:'pem'}),{flag:'wx',mode:0o600});
  return file;
}
module.exports={licenseSigningKey,initializeSigningKey};
