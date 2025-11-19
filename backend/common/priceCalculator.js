/**
 * Calculate pricing for a list of parts with a margin rule.
 * @param {Array<object>} partsRecords
 * @param {{ marginPercent?: number }} marginRule
 */
function calculatePricing(partsRecords, marginRule) {
  const marginPercent =
    marginRule && typeof marginRule.marginPercent === "number"
      ? marginRule.marginPercent
      : 15;

  let partsTotal = 0;

  for (const part of partsRecords || []) {
    if (!part) continue;

    const basePrice =
      typeof part.overridePrice === "number"
        ? part.overridePrice
        : getLowestVendorPrice(part.vendorList);

    if (typeof basePrice === "number") {
      partsTotal += basePrice;
    }
  }

  const finalPrice = Number(
    (partsTotal * (1 + marginPercent / 100)).toFixed(2)
  );

  return {
    partsTotal: Number(partsTotal.toFixed(2)),
    marginPercent,
    finalPrice,
  };
}

function getLowestVendorPrice(list) {
  if (!Array.isArray(list) || list.length === 0) return null;

  let min = null;
  for (const v of list) {
    if (typeof v.price !== "number") continue;
    if (min === null || v.price < min) {
      min = v.price;
    }
  }
  return min;
}

module.exports = { calculatePricing };
