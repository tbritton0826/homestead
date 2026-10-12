CREATE TABLE customers (
  id uuid PRIMARY KEY, email text NOT NULL UNIQUE CHECK (email = lower(email)),
  display_name text NOT NULL, email_verified_at timestamptz,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','closed')),
  preferences jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE customer_identities (
  customer_id uuid NOT NULL REFERENCES customers(id), provider text NOT NULL, subject text NOT NULL,
  password_hash text, PRIMARY KEY(provider,subject), UNIQUE(customer_id,provider)
);
CREATE TABLE customer_sessions (
  token_hash text PRIMARY KEY, customer_id uuid NOT NULL REFERENCES customers(id),
  csrf_hash text NOT NULL, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customer_sessions_customer_idx ON customer_sessions(customer_id);
CREATE INDEX customer_sessions_expiry_idx ON customer_sessions(expires_at);
CREATE TABLE customer_tokens (
  token_hash text PRIMARY KEY, customer_id uuid NOT NULL REFERENCES customers(id),
  purpose text NOT NULL CHECK(purpose IN ('verify','reset')), expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customer_tokens_customer_idx ON customer_tokens(customer_id,purpose);
CREATE TABLE customer_rate_limits (key_hash text PRIMARY KEY, count integer NOT NULL, expires_at timestamptz NOT NULL);
CREATE TABLE customer_mail_outbox (
  id uuid PRIMARY KEY, payload text NOT NULL, attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE customer_plans (
  id text PRIMARY KEY, tier text NOT NULL CHECK(tier IN ('free','family','plus','pro')),
  version integer NOT NULL CHECK(version > 0), name text NOT NULL, description text NOT NULL DEFAULT '',
  amount bigint CHECK(amount >= 0), currency text NOT NULL CHECK(currency ~ '^[a-z]{3}$'),
  billing_interval text NOT NULL CHECK(billing_interval IN ('month','year','none')),
  product_kind text NOT NULL DEFAULT 'subscription' CHECK(product_kind IN ('subscription','one_time')),
  active boolean NOT NULL DEFAULT false, draft boolean NOT NULL DEFAULT true,
  features jsonb NOT NULL, limits jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tier,billing_interval,version), CHECK(draft OR amount IS NOT NULL)
);
CREATE TABLE customer_provider_prices (
  provider text NOT NULL, external_price_id text NOT NULL, plan_id text NOT NULL REFERENCES customer_plans(id),
  mode text NOT NULL CHECK(mode='test'), PRIMARY KEY(provider,external_price_id), UNIQUE(provider,plan_id,mode)
);
CREATE TABLE customer_provider_accounts (
  customer_id uuid NOT NULL REFERENCES customers(id), provider text NOT NULL, external_customer_id text NOT NULL,
  PRIMARY KEY(customer_id,provider), UNIQUE(provider,external_customer_id)
);
CREATE TABLE customer_checkouts (
  id uuid PRIMARY KEY, customer_id uuid NOT NULL REFERENCES customers(id), plan_id text NOT NULL REFERENCES customer_plans(id),
  provider text NOT NULL, external_session_id text UNIQUE, checkout_url text, plan_snapshot jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','complete','expired')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customer_checkouts_customer_idx ON customer_checkouts(customer_id);
CREATE TABLE customer_subscriptions (
  id uuid PRIMARY KEY, customer_id uuid NOT NULL REFERENCES customers(id), plan_id text NOT NULL REFERENCES customer_plans(id),
  provider text NOT NULL, external_subscription_id text NOT NULL, status text NOT NULL,
  period_start timestamptz, period_end timestamptz, trial_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false, cancel_at timestamptz, canceled_at timestamptz,
  plan_snapshot jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider,external_subscription_id)
);
CREATE INDEX customer_subscriptions_customer_idx ON customer_subscriptions(customer_id);
CREATE TABLE customer_transactions (
  id uuid PRIMARY KEY, customer_id uuid NOT NULL REFERENCES customers(id), subscription_id uuid REFERENCES customer_subscriptions(id),
  plan_id text NOT NULL REFERENCES customer_plans(id), provider text NOT NULL, external_payment_id text NOT NULL,
  amount bigint NOT NULL CHECK(amount >= 0), currency text NOT NULL, status text NOT NULL,
  refunded_amount bigint NOT NULL DEFAULT 0 CHECK(refunded_amount >= 0 AND refunded_amount <= amount),
  paid_at timestamptz, receipt_url text, plan_snapshot jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider,external_payment_id)
);
CREATE INDEX customer_transactions_customer_idx ON customer_transactions(customer_id);
CREATE TABLE customer_licenses (
  id uuid PRIMARY KEY, customer_id uuid NOT NULL REFERENCES customers(id),
  plan_id text NOT NULL REFERENCES customer_plans(id),
  subscription_id uuid UNIQUE REFERENCES customer_subscriptions(id), purchase_id uuid REFERENCES customer_transactions(id),
  product_id text NOT NULL DEFAULT 'homestead', features jsonb NOT NULL, activated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz, revoked_at timestamptz, status text NOT NULL CHECK(status IN ('active','revoked','expired'))
);
CREATE INDEX customer_licenses_customer_idx ON customer_licenses(customer_id);
CREATE TABLE customer_payment_events (
  provider text NOT NULL, external_event_id text NOT NULL, event_type text NOT NULL,
  status text NOT NULL CHECK(status IN ('received','processed','failed','ignored')),
  attempts integer NOT NULL DEFAULT 0, received_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz,
  last_error text, PRIMARY KEY(provider,external_event_id)
);
