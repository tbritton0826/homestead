# Customer HTTPS behind Cloudflare Tunnel

The main Express app is created in `server.cjs`. Immediately after `express()`,
`configureProxyTrust` applies the proxy policy, before customer routes, raw Stripe
webhooks, and other middleware are mounted. Customer routes continue to require
`req.secure` when their configured origin uses HTTPS.

## Policy

For a customer-enabled or customer-only process, set
`HOMESTEAD_CUSTOMER_TRUSTED_PROXIES` to comma-separated **exact socket-peer IPs** of
the trusted reverse proxies. An empty/unset value disables forwarded-header trust.
Malformed values fail startup. CIDRs, Docker network/container names, predefined
subnet aliases, booleans, and hop counts are deliberately rejected. IPv4, IPv6, and
IPv4-mapped IPv6 are supported. Only the immediate peer is trusted; a claimed
address in `X-Forwarded-For` cannot authorize an otherwise untrusted socket.

Customer deployments no longer use `HOMESTEAD_TRUST_PROXY`, including its old
implicit loopback default. Media-only deployments retain that existing setting.
There is no automatic trust of Docker private ranges or Cloudflare public ranges:
the socket peer here is the local cloudflared container, not Cloudflare's edge.

Express uses the trusted peer's `X-Forwarded-Proto` for `req.secure`. The tunnel
must overwrite forwarded protocol/host/client headers rather than accept a
client-selected protocol. Keep the public tunnel HTTPS-only and verify an HTTP
request cannot reach customer APIs as HTTPS. `CF-Visitor`, `CF-Connecting-IP`,
`Forwarded`, and an HTTPS-looking Host do not grant proxy trust.

Reference: [Express behind proxies](https://expressjs.com/en/guide/behind-proxies/).

## Existing Homestead deployment (review instructions; not deployed by this PR)

Keep `homestead-accounts-public`, existing Compose networks/overrides, database
volumes, private environment values, license keys, and Stripe test mode unchanged.
Keep the tunnel upstream at
`http://homestead-commercial-staging-customer-web-1:7312` and the configured origin
at `https://accounts.gethomesteadapp.com`. Do not add a public backend port or put
PostgreSQL on the ingress bridge.

1. Identify the **cloudflared connector container**, then inspect just its address
   on the already shared network (no full Docker inspect or secret output):

   ```sh
   docker inspect --format '{{with index .NetworkSettings.Networks "homestead-accounts-public"}}{{.IPAddress}}{{end}}' <cloudflared-container>
   ```

2. In the existing private deployment `.env`, set
   `HOMESTEAD_CUSTOMER_TRUSTED_PROXIES=<that-exact-IP>`. For multiple approved
   connectors list their exact IPs separated by commas. Do not substitute the
   customer-web address or the bridge gateway. No real address is baked into code.

3. The base `docker-compose.customer.yml` passes this new variable to customer-web.
   If the deployment copies Compose files rather than tracking the repository,
   bring over that **one environment mapping** while retaining the existing local
   override's networks, image configuration and volumes. A plain restart does not
   apply changed container environment settings; apply the reviewed image and
   environment by recreating only customer-web after approval. Do not restart the
   database, remove volumes, rotate keys, or replace the entire private `.env`.

4. Verify `/api/customer/session` through public HTTPS succeeds, secure host
   cookies retain `Secure`, `HttpOnly`, `SameSite` and `Path=/`, and direct backend
   HTTP with spoofed `X-Forwarded-Proto: https` from an unlisted source fails.
   Confirm signed test Stripe events work and unsigned events remain rejected.

The exact address must stay accurate: cloudflared container recreation can change
its Docker address. Recheck the peer and update the allowlist when that happens;
do not widen it to the entire bridge. Trust assumes the approved proxy controls
that address and overwrites forwarded headers. A compromised proxy or reassigned
allowlisted address remains inside the configured trust boundary.

This PR changes no authentication, CSRF, email verification, Stripe validation,
license-signing, database schemas or production deployment state. The tests use
isolated fixtures and exercise real HTTP sockets and the existing customer router.
Run `npm run test:customer`; CI also runs it against PostgreSQL 17.
