const { isIP } = require('node:net');

// Customer HTTPS enforcement must depend on the socket peer, never on an address
// supplied in X-Forwarded-For, a hop count, or the media server's legacy setting.
function configureProxyTrust(app, env = process.env) {
  const customer = env.HOMESTEAD_CUSTOMER_ENABLED === 'true' || env.HOMESTEAD_CUSTOMER_ONLY === 'true';
  if (!customer) {
    app.set('trust proxy', env.HOMESTEAD_TRUST_PROXY || 'loopback');
    return;
  }

  const setting = env.HOMESTEAD_CUSTOMER_TRUSTED_PROXIES;
  if (setting === undefined || setting === '') {
    app.set('trust proxy', false);
    return;
  }
  // Exact addresses only: Docker network names, aliases, CIDRs and trust-all
  // switches cannot accidentally authorize other containers on a shared bridge.
  const addresses = typeof setting === 'string' ? setting.split(',').map(value => value.trim()) : [];
  if (!addresses.length || addresses.some(address => !isIP(address) || address.includes('%'))) {
    throw new Error('HOMESTEAD_CUSTOMER_TRUSTED_PROXIES must contain only comma-separated exact proxy IP addresses.');
  }

  // Let Express normalize IPv4/IPv6 (including IPv4-mapped IPv6) consistently.
  app.set('trust proxy', addresses);
  const trustedAddress = app.get('trust proxy fn');
  app.set('trust proxy', (address, hop) => hop === 0 && trustedAddress(address));
}

module.exports = { configureProxyTrust };
