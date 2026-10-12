// The V1 catalog uses Stripe charge units: two decimal places except zero-decimal
// currencies. ISK and UGX retain Stripe's two-decimal compatibility representation.
export function money(amount, currency, locale) {
  const formatter = new Intl.NumberFormat(locale, {style:'currency',currency});
  const zeroDecimal = formatter.resolvedOptions().maximumFractionDigits === 0
    && !['isk','ugx'].includes(currency.toLowerCase());
  return formatter.format(Number(amount) / (zeroDecimal ? 1 : 100));
}
