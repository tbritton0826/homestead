-- Account binding is independent of local media and local owner passwords.
CREATE TABLE customer_servers (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers(id),
  installation_id uuid NOT NULL,
  public_key text NOT NULL,
  fingerprint text NOT NULL UNIQUE,
  name text NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX customer_servers_customer_idx ON customer_servers(customer_id);
CREATE TABLE customer_server_pairings (
  id uuid PRIMARY KEY,
  code_hash text NOT NULL UNIQUE,
  device_hash text NOT NULL,
  installation_id uuid NOT NULL,
  public_key text NOT NULL,
  fingerprint text NOT NULL,
  name text NOT NULL,
  customer_id uuid REFERENCES customers(id),
  server_id uuid REFERENCES customer_servers(id),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customer_pairing_expiration_idx ON customer_server_pairings(expires_at);
CREATE TABLE customer_server_nonces (
  fingerprint text NOT NULL,
  nonce text NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY(fingerprint, nonce)
);
