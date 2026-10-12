const crypto = require('node:crypto');
const { transaction } = require('./database.cjs');
function createMailTransport(env) {
  if (!/^smtps?:\/\//i.test(env.HOMESTEAD_CUSTOMER_SMTP_URL || '')) throw new Error('Configure an SMTP or SMTPS URL');
  const options=require('nodemailer/lib/shared').parseConnectionUrl(env.HOMESTEAD_CUSTOMER_SMTP_URL);
  const production=env.NODE_ENV==='production';
  return require('nodemailer').createTransport({...options,connectionTimeout:10000,greetingTimeout:10000,socketTimeout:20000,
    logger:false,debug:false,transactionLog:false,pool:false,
    ...(production?{requireTLS:true,ignoreTLS:false,opportunisticTLS:false}:{}),
    tls:{...options.tls,rejectUnauthorized:true,minVersion:'TLSv1.2'}});
}
function createMailer({ pool, env, send }) {
  if (!/^[a-f0-9]{64}$/i.test(env.HOMESTEAD_CUSTOMER_MAIL_KEY || '')) throw new Error('A 32-byte customer mail encryption key is required');
  const key = Buffer.from(env.HOMESTEAD_CUSTOMER_MAIL_KEY, 'hex');
  const transport = !send && env.HOMESTEAD_CUSTOMER_SMTP_URL ? createMailTransport(env) : null;
  const deliver = send || (transport && (message => transport.sendMail({ ...message, from: env.HOMESTEAD_CUSTOMER_MAIL_FROM })));
  function encrypt(message) {
    const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(message)), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
  }
  function decrypt(payload) {
    const data = Buffer.from(payload, 'base64'); const cipher = crypto.createDecipheriv('aes-256-gcm', key, data.subarray(0,12));
    cipher.setAuthTag(data.subarray(12,28)); return JSON.parse(Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString());
  }
  async function enqueue(db, message, notificationKey=null) {
    await db.query('INSERT INTO customer_mail_outbox(id,payload,notification_key) VALUES($1,$2,$3) ON CONFLICT(notification_key) DO NOTHING', [crypto.randomUUID(), encrypt(message), notificationKey]);
  }
  async function flush() {
    if (!deliver) return;
    await transaction(pool, async db => {
      const jobs = (await db.query('SELECT * FROM customer_mail_outbox WHERE sent_at IS NULL AND next_attempt_at<=now() AND attempts<8 ORDER BY created_at LIMIT 10 FOR UPDATE SKIP LOCKED')).rows;
      for (const job of jobs) {
        try {
          await deliver(decrypt(job.payload));
          await db.query("UPDATE customer_mail_outbox SET sent_at=now(),payload='',attempts=attempts+1 WHERE id=$1", [job.id]);
        } catch {
          await db.query("UPDATE customer_mail_outbox SET attempts=attempts+1,next_attempt_at=now()+interval '5 minutes' WHERE id=$1", [job.id]);
        }
      }
    });
  }
  return { enqueue, flush, available: Boolean(deliver), close:()=>transport?.close() };
}
module.exports = { createMailer, createMailTransport };
