const normalize = value => String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
const positive = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;

function printingPriceDetails(card = {}, query = {}) {
  const set = normalize(query.setCode), rarity = normalize(query.rarity);
  const matches = (card.card_sets || []).filter(row => set && rarity && normalize(row.set_code) === set && normalize(row.set_rarity) === rarity);
  const values = [...new Set(matches.map(row => positive(row.set_price)).filter(value => value !== null))];
  // Conflicting or absent quotes do not establish a verified variant price.
  const price = values.length === 1 ? values[0] : null;
  const general = card.card_prices?.[0] || {};
  const genericPrice = ['tcgplayer_price', 'ebay_price', 'amazon_price'].map(key => positive(general[key])).find(value => value !== null) ?? null;
  return {
    marketValue: price ?? 0, printingPrice: price ?? 0, genericPrice: genericPrice ?? 0, genericCurrency: 'USD',
    priceAvailable: price !== null, priceSourceType: price !== null ? 'exact-printing' : 'unavailable',
    priceSource: price !== null ? 'YGOPRODeck set/rarity estimate (edition and condition not quoted)' : 'Printing price unavailable',
    pricedSetCode: price !== null ? String(query.setCode || '').trim().toUpperCase() : '',
    pricedRarity: price !== null ? matches[0].set_rarity : '',
    // This source supplies set/rarity estimates, not edition/condition quotes.
    pricedEdition: '', pricedLanguage: '', priceCheckedAt: new Date().toISOString(),
    priceDifferenceWarning: price !== null && genericPrice !== null && Math.max(price, genericPrice) / Math.min(price, genericPrice) >= 3,
  };
}
function refreshHoldings(record, card, summarize) {
  const now = new Date().toISOString();
  const holdings = record.tcg.printings?.length ? record.tcg.printings : [record.tcg];
  const list = holdings.map(holding => {
    const quote = printingPriceDetails(card, holding);
    const manual = holding.priceSourceType === 'manual-override' || (holding.manualPriceOverride != null && Number.isFinite(Number(holding.manualPriceOverride)) && Number(holding.manualPriceOverride) >= 0);
    const marketValue = manual ? Number(holding.manualPriceOverride ?? holding.marketValue ?? 0) : quote.marketValue;
    return { ...holding, ...quote, marketValue, priceAvailable: manual || quote.priceAvailable,
      priceSourceType: manual ? 'manual-override' : quote.priceSourceType,
      priceSource: manual ? 'Manual estimate' : quote.priceSource,
      lastPriceRefresh: now, updatedAt: now,
      priceHistory: [...(holding.priceHistory || []), { ...quote, at: now, marketValue }].slice(-365) };
  });
  return { ...record, tcg: summarize(record.tcg, list), updatedAt: now };
}
function pricingMetadata(input = {}) {
  const result = {};
  for (const key of ['priceProviderId', 'priceCurrency', 'priceCheckedAt', 'priceUpdatedAt', 'pricedSetCode', 'pricedRarity', 'pricedEdition', 'pricedCondition']) {
    if (input[key] !== undefined) result[key] = String(input[key] || '').trim().slice(0, 200);
  }
  return result;
}
module.exports = { printingPriceDetails, refreshHoldings, pricingMetadata };
