import {
  applyBillingMarkupUsd,
  AUTUMN_SEO_DATA_CREDITS_PER_USD,
  roundUsdForBilling,
} from "./billing";

/** DataForSEO Google Maps Live: one Maps SERP page (up to 100 results). */
const MAPS_LIVE_COST_USD = 0.002;
const PAID_MAPS_SEARCH_OPERATOR =
  /-?(?:allinanchor|allintext|allintitle|allinurl|define|filetype|id|inanchor|info|intext|intitle|inurl|link|site):/i;

export function hasPaidMapsSearchOperator(keyword: string) {
  return PAID_MAPS_SEARCH_OPERATOR.test(keyword);
}

export function estimateGeoGridRunCost(gridSize: number, hosted: boolean) {
  const cells = gridSize * gridSize;
  const costPerCellUsd = hosted
    ? applyBillingMarkupUsd(MAPS_LIVE_COST_USD)
    : MAPS_LIVE_COST_USD;
  // Hosted metering rounds credits per provider call, and each grid cell is a
  // separate live call. Mirror that boundary so the approval never understates
  // the charged credit ceiling.
  const creditsPerCell = Math.ceil(
    costPerCellUsd * AUTUMN_SEO_DATA_CREDITS_PER_USD,
  );
  return {
    cells,
    costUsd: hosted
      ? roundUsdForBilling(
          (creditsPerCell * cells) / AUTUMN_SEO_DATA_CREDITS_PER_USD,
        )
      : roundUsdForBilling(costPerCellUsd * cells),
    costCredits: creditsPerCell * cells,
  };
}

export function estimateScheduledGeoGridCost(
  gridSize: number,
  scheduleInterval: "weekly" | "monthly",
  hosted: boolean,
) {
  const perRun = estimateGeoGridRunCost(gridSize, hosted);
  const checksPerMonth = scheduleInterval === "weekly" ? 52 / 12 : 1;
  return {
    ...perRun,
    scheduleInterval,
    checksPerMonth,
    monthlyCostUsd: roundUsdForBilling(perRun.costUsd * checksPerMonth),
    monthlyCostCredits: Math.ceil(perRun.costCredits * checksPerMonth),
  };
}
