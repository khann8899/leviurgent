// Levi Urgent - Position Monitor
// Tracks open positions and executes take profits / stop losses

const { state } = require('./state');
const { MODES } = require('../config/modes');
const { getTokenPrice, sellToken } = require('./trader');
const { sendTakeProfitHit, sendPositionClosed } = require('./telegram');

// Monitor all open positions every 30 seconds
async function monitorPositions(connection, wallet) {
  const positions = Object.values(state.openPositions);
  if (positions.length === 0) return;

  for (const position of positions) {
    try {
      await checkPosition(position, connection, wallet);
    } catch (e) {
      console.error(`Error monitoring ${position.symbol}:`, e.message);
    }
  }
}

async function checkPosition(position, connection, wallet) {
  const currentPrice = await getTokenPrice(position.mintAddress);
  if (!currentPrice || currentPrice <= 0) return;

  const modeConfig = MODES[position.mode];
  position.currentPrice = currentPrice;

  // Update peak price for trailing stop
  if (currentPrice > position.peakPrice) {
    position.peakPrice = currentPrice;
  }

  const multiplier = currentPrice / position.entryPrice;
  const dropFromPeak = ((position.peakPrice - currentPrice) / position.peakPrice) * 100;
  const dropFromEntry = ((position.entryPrice - currentPrice) / position.entryPrice) * 100;

  // Check take profits in order
  const takeProfits = modeConfig.takeProfits;
  if (position.takeProfitIndex < takeProfits.length) {
    const nextTP = takeProfits[position.takeProfitIndex];
    if (multiplier >= nextTP.multiplier) {
      await executeTakeProfit(position, nextTP, multiplier, connection, wallet);
      return;
    }
  }

  // Check trailing stop (only after first TP hit or if price went up)
  if (position.peakPrice > position.entryPrice * 1.2) {
    if (dropFromPeak >= modeConfig.trailingStopPercent) {
      await closePosition(position, 'Trailing Stop', multiplier, connection, wallet);
      return;
    }
  }

  // Check hard stop loss
  if (dropFromEntry >= modeConfig.stopLossPercent) {
    await closePosition(position, 'Stop Loss', multiplier, connection, wallet);
    return;
  }
}

async function executeTakeProfit(position, tp, multiplier, connection, wallet) {
  const sellPercent = tp.sellPercent;
  const tokensToSell = position.tokensHeld * (sellPercent / 100) * (position.remainingPercent / 100);

  const result = await sellToken(
    position.mintAddress,
    sellPercent,
    tokensToSell,
    connection,
    wallet
  );

  if (result.success) {
    position.remainingPercent -= sellPercent;
    position.takeProfitIndex += 1;

    // Update weekly stats
    updateStats(position.mode, result.usdReceived, position.amountUSD * (sellPercent / 100), multiplier);

    await sendTakeProfitHit(position, multiplier, result.usdReceived, position.takeProfitIndex - 1);

    // If no more TPs and remainder is small, close it
    if (position.takeProfitIndex >= MODES[position.mode].takeProfits.length) {
      console.log(`${position.symbol}: All TPs hit, trailing stop now active on ${position.remainingPercent}% remainder`);
    }
  }
}

async function closePosition(position, reason, multiplier, connection, wallet) {
  const result = await sellToken(
    position.mintAddress,
    100,
    position.tokensHeld * (position.remainingPercent / 100),
    connection,
    wallet
  );

  if (result.success) {
    const originalBet = position.amountUSD * (position.remainingPercent / 100);
    const pnl = result.usdReceived - originalBet;

    updateStats(position.mode, result.usdReceived, originalBet, multiplier, true);

    await sendPositionClosed(position, reason, multiplier, pnl);
    delete state.openPositions[position.mintAddress];
  }
}

// Close ALL positions (for /closeall command)
async function closeAllPositions(connection, wallet) {
  const positions = Object.values(state.openPositions);
  let totalUSD = 0;

  for (const position of positions) {
    try {
      const result = await sellToken(
        position.mintAddress,
        100,
        position.tokensHeld * (position.remainingPercent / 100),
        connection,
        wallet
      );
      if (result.success) {
        totalUSD += result.usdReceived;
        delete state.openPositions[position.mintAddress];
      }
    } catch (e) {
      console.error(`Failed to close ${position.symbol}:`, e.message);
    }
  }

  return totalUSD;
}

function updateStats(mode, usdReceived, usdInvested, multiplier, isFinalClose = false) {
  const stats = state.weeklyStats[mode];
  const sessionStats = state.sessionStats;

  if (isFinalClose) {
    stats.trades += 1;
    sessionStats.trades += 1;

    if (usdReceived > usdInvested) {
      stats.wins += 1;
    } else {
      stats.losses += 1;
    }

    if (multiplier > stats.bestMultiplier) stats.bestMultiplier = multiplier;
    if (multiplier < stats.worstMultiplier || stats.worstMultiplier === 0) stats.worstMultiplier = multiplier;

    const pnlPercent = ((usdReceived - usdInvested) / usdInvested) * 100;
    stats.netPnlPercent += pnlPercent;
    sessionStats.netPnlPercent += pnlPercent;
  }
}

module.exports = { monitorPositions, closeAllPositions };
