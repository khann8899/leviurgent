// Levi Urgent - Strategy Modes Configuration

const MODES = {
  1: {
    name: "Safe Filter Swing",
    emoji: "🟢",
    description: "Strict filters, modest targets, capital preservation",
    slots: 4,
    filters: {
      minLiquidityUSD: 50000,      // Minimum liquidity pool size
      minHolders: 200,              // Minimum unique holders
      maxTopHolderPercent: 20,      // Top holder can't own more than 20%
      mustHaveLockedLiquidity: true,
      mustHaveNoMintAuthority: true,
      mustHaveNoFreezeAuthority: true,
      maxAgeMinutes: 120,           // Only coins under 2 hours old
      minAgeMinutes: 15,            // Must be at least 15 mins old (survived initial dump)
    },
    takeProfits: [
      { multiplier: 1.5, sellPercent: 50 },   // At 1.5x sell 50%
      { multiplier: 3.0, sellPercent: 30 },   // At 3x sell 30%
    ],
    trailingStopPercent: 15,        // Sell remainder if drops 15% from peak
    stopLossPercent: 25,            // Hard stop loss at -25% from entry
    approvalTimeoutMinutes: 10,
  },

  2: {
    name: "Momentum Riding",
    emoji: "🟡",
    description: "Coins already showing movement, ride the second wave",
    slots: 4,
    filters: {
      minLiquidityUSD: 30000,
      minHolders: 100,
      maxTopHolderPercent: 25,
      mustHaveLockedLiquidity: true,
      mustHaveNoMintAuthority: true,
      mustHaveNoFreezeAuthority: false,        // Slightly relaxed
      maxAgeMinutes: 60,
      minAgeMinutes: 30,                       // Must be 30 mins old with proven momentum
      minPriceChangePercent: 50,               // Must have already moved 50%+ since launch
    },
    takeProfits: [
      { multiplier: 2.0, sellPercent: 50 },   // At 2x sell 50%
      { multiplier: 5.0, sellPercent: 25 },   // At 5x sell 25%
    ],
    trailingStopPercent: 20,
    stopLossPercent: 40,
    approvalTimeoutMinutes: 10,
  },

  3: {
    name: "Early Launch Snipe",
    emoji: "🟠",
    description: "First 10 minutes, basic scam checks only, high upside",
    slots: 4,
    filters: {
      minLiquidityUSD: 10000,
      minHolders: 50,
      maxTopHolderPercent: 30,
      mustHaveLockedLiquidity: false,          // Relaxed for early entries
      mustHaveNoMintAuthority: true,           // Still check this - critical
      mustHaveNoFreezeAuthority: false,
      maxAgeMinutes: 10,                       // Only coins under 10 mins old
      minAgeMinutes: 1,
    },
    takeProfits: [
      { multiplier: 3.0, sellPercent: 40 },   // At 3x sell 40%
      { multiplier: 10.0, sellPercent: 30 },  // At 10x sell 30%
    ],
    trailingStopPercent: 25,
    stopLossPercent: 50,
    approvalTimeoutMinutes: 10,
  },

  4: {
    name: "Degen First-Minute Snipe",
    emoji: "🔴",
    description: "Pure speed, first 60 seconds, honeypot check only",
    slots: 4,
    filters: {
      minLiquidityUSD: 5000,
      minHolders: 10,
      maxTopHolderPercent: 50,                // Very relaxed
      mustHaveLockedLiquidity: false,
      mustHaveNoMintAuthority: false,          // Only honeypot check matters
      mustHaveNoFreezeAuthority: false,
      maxAgeMinutes: 1,                        // Only coins under 1 minute old
      minAgeMinutes: 0,
    },
    takeProfits: [
      { multiplier: 5.0, sellPercent: 40 },   // At 5x sell 40%
      { multiplier: 20.0, sellPercent: 30 },  // At 20x sell 30%
    ],
    trailingStopPercent: 30,
    stopLossPercent: 60,
    approvalTimeoutMinutes: 10,
  },
};

module.exports = { MODES };
