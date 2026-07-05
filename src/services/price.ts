/**
 * price.ts — Live token price service
 * Primary: CoinGecko Pro API (multi-asset)
 * Fallback: Stellar Horizon strict-send paths (XLM/USDC only)
 */

import { getCurrentPriceOfXlmInUsdc } from "./stellar";

const CG_API_KEY = process.env.COINGECKO_API_KEY || "";
const CG_BASE = "https://pro-api.coingecko.com/api/v3";

// Map common asset symbols → CoinGecko coin IDs
const COINGECKO_IDS: Record<string, string> = {
  XLM:   "stellar",
  BTC:   "bitcoin",
  ETH:   "ethereum",
  USDC:  "usd-coin",
  USDT:  "tether",
  SOL:   "solana",
  AQUA:  "aquarius",
  BNB:   "binancecoin",
  MATIC: "matic-network",
  LINK:  "chainlink",
};

export interface PriceResult {
  asset: string;
  priceUsd: number;
  priceUsdc?: number;
  change24h?: number;
  marketCap?: number;
  source: "coingecko" | "horizon";
}

/**
 * Fetch live price(s) for one or more assets.
 * Returns prices in USD (and USDC equivalent for non-stable assets).
 */
export async function getLivePrices(assets: string[]): Promise<PriceResult[]> {
  const normalized = assets.map(a => a.toUpperCase());
  const results: PriceResult[] = [];

  // Resolve to CoinGecko IDs
  const ids = normalized
    .map(a => COINGECKO_IDS[a])
    .filter(Boolean);

  if (ids.length === 0) {
    throw new Error(`No supported assets found. Supported: ${Object.keys(COINGECKO_IDS).join(", ")}`);
  }

  try {
    const url = `${CG_BASE}/simple/price?ids=${ids.join(",")}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true&x_cg_pro_api_key=${CG_API_KEY}`;
    const resp = await fetch(url);

    if (!resp.ok) {
      throw new Error(`CoinGecko API error: ${resp.status} ${resp.statusText}`);
    }

    const data = await resp.json() as Record<string, {
      usd: number;
      usd_24h_change?: number;
      usd_market_cap?: number;
    }>;

    for (const asset of normalized) {
      const cgId = COINGECKO_IDS[asset];
      if (!cgId) continue;
      const entry = data[cgId];
      if (!entry) continue;

      results.push({
        asset,
        priceUsd:   entry.usd,
        priceUsdc:  entry.usd, // USDC ≈ USD for display purposes
        change24h:  entry.usd_24h_change,
        marketCap:  entry.usd_market_cap,
        source: "coingecko",
      });
    }

    return results;
  } catch (err: any) {
    // Fallback for XLM only via Horizon
    console.warn("[Price Service] CoinGecko failed, falling back to Horizon:", err.message);
    if (normalized.includes("XLM")) {
      const price = await getCurrentPriceOfXlmInUsdc();
      return [{
        asset: "XLM",
        priceUsd: price,
        priceUsdc: price,
        source: "horizon",
      }];
    }
    throw err;
  }
}

/**
 * Convenience: get price of a single asset.
 */
export async function getSinglePrice(asset: string): Promise<PriceResult> {
  const results = await getLivePrices([asset]);
  if (results.length === 0) throw new Error(`Could not fetch price for ${asset}`);
  return results[0];
}

/**
 * Format a PriceResult into a readable WhatsApp message.
 */
export function formatPriceMessage(r: PriceResult): string {
  const change = r.change24h !== undefined
    ? ` (${r.change24h >= 0 ? "+" : ""}${r.change24h.toFixed(2)}% 24h)`
    : "";
  const mcap = r.marketCap
    ? `\n📊 Market Cap: $${(r.marketCap / 1e9).toFixed(2)}B`
    : "";
  return `💰 *${r.asset} Price*\n$${r.priceUsd.toFixed(6)} USD${change}${mcap}\n_Source: ${r.source === "coingecko" ? "CoinGecko" : "Stellar Horizon"}_`;
}
