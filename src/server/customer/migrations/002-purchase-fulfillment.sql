-- Append-only extension of Commercial V1. Never rewrite 001's deployed checksum.
ALTER TABLE customer_checkouts ADD COLUMN payment_status text NOT NULL DEFAULT 'pending';
ALTER TABLE customer_checkouts ADD COLUMN external_payment_id text;
ALTER TABLE customer_checkouts ADD COLUMN external_subscription_id text;
ALTER TABLE customer_checkouts ADD COLUMN confirmed_at timestamptz;
CREATE UNIQUE INDEX customer_checkouts_payment_idx ON customer_checkouts(provider,external_payment_id);
ALTER TABLE customer_transactions ADD COLUMN checkout_id uuid UNIQUE REFERENCES customer_checkouts(id);
ALTER TABLE customer_transactions ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE customer_licenses ADD COLUMN manual_revoked_at timestamptz;
CREATE UNIQUE INDEX customer_licenses_purchase_idx ON customer_licenses(purchase_id);
CREATE UNIQUE INDEX customer_licenses_free_idx ON customer_licenses(customer_id)
  WHERE subscription_id IS NULL AND purchase_id IS NULL AND status='active';
ALTER TABLE customer_mail_outbox ADD COLUMN notification_key text UNIQUE;
CREATE INDEX customer_mail_pending_idx ON customer_mail_outbox(next_attempt_at) WHERE sent_at IS NULL;
