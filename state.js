// Levi Urgent - State Management
// Tracks active mode, open positions, weekly stats

const state = {
  // Current active mode (1-4)
  currentMode: 1,

  // Whether bot is actively scanning
  isPaused: false,

  // Bet size per slot in USD
  betSizeUSD: 5, // Default $5 per slot ($20 / 4 slots)

  // Open positions map: { mintAddress -> position }
  openPositions: {},

  // Weekly stats per mode
  weeklyStats: {
    1: { trades: 0, wins: 0, losses: 0, bestMultiplier: 0, worstMultiplier: 0, netPnlPercent: 0, startBalance: 0 },
    2: { trades: 0, wins: 0, losses: 0, bestMultiplier: 0, worstMultiplier: 0, netPnlPercent: 0, startBalance: 0 },
    3: { trades: 0, wins: 0, losses: 0, bestMultiplier: 0, worstMultiplier: 0, netPnlPercent: 0, startBalance: 0 },
    4: { trades: 0, wins: 0, losses: 0, bestMultiplier: 0, worstMultiplier: 0, netPnlPercent: 0, startBalance: 0 },
  },

  // Session stats (since last mode switch)
  sessionStats: {
    mode: 1,
    trades: 0,
    netPnlPercent: 0,
    startTime: new Date(),
  },

  // Pending approvals: { mintAddress -> { coin, timeout, messageId } }
  pendingApprovals: {},

  // Week start time for weekly reports
  weekStartTime: new Date(),
  weekStartBalance: 0,
};

// Position structure template
function createPosition(coin, entryPrice, amountUSD, mode) {
  return {
    mintAddress: coin.mintAddress,
    symbol: coin.symbol,
    entryPrice,
    currentPrice: entryPrice,
    peakPrice: entryPrice,
    amountUSD,
    tokensHeld: amountUSD / entryPrice,
    mode,
    openedAt: new Date(),
    takeProfitIndex: 0,       // Which TP level we're at
    remainingPercent: 100,    // What % of original position still open
    status: 'open',
  };
}

module.exports = { state, createPosition };
