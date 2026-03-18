// Levi Urgent 1.0 - Main Entry Point
require('dotenv').config();

const { Connection } = require('@solana/web3.js');
const { state, createPosition } = require('./state');
const { MODES } = require('../config/modes');
const { analyzeCoin } = require('./scanner');
const { initWallet, buyToken, getSOLBalance, getSOLPrice } = require('./trader');
const { monitorPositions, closeAllPositions } = require('./monitor');
const { fetchNewPumpFunTokens, fetchRaydiumNewPairs } = require('./pumpfun');
const {
  initBot, getBot, sendStartupMessage,
  sendCoinAlert, sendTradeOpened,
  sendCloseAllConfirmation, sendWeeklyReport,
  removeButtons,
} = require('./telegram');

// Validate environment
function validateEnv() {
  const required = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'WALLET_PRIVATE_KEY', 'SOLANA_RPC_URL'];
  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }
}

async function main() {
  validateEnv();

  // Initialize connections
  const connection = new Connection(process.env.SOLANA_RPC_URL, 'confirmed');
  const wallet = initWallet();
  const bot = initBot();

  console.log(`✅ Wallet: ${wallet.publicKey.toString()}`);

  // Get initial balance
  const initialSOL = await getSOLBalance(connection, wallet.publicKey);
  const solPrice = await getSOLPrice();
  state.weekStartBalance = initialSOL * solPrice;
  state.betSizeUSD = (initialSOL * solPrice) / 4; // Auto set bet size based on balance

  console.log(`💰 Balance: ${initialSOL.toFixed(4)} SOL ($${(initialSOL * solPrice).toFixed(2)})`);
  console.log(`🎯 Bet size: $${state.betSizeUSD.toFixed(2)} per slot`);

  await sendStartupMessage();

  // ==================== COMMAND HANDLERS ====================

  // Mode switching
  for (let i = 1; i <= 4; i++) {
    bot.onText(new RegExp(`/mode${i}`), async (msg) => {
      if (msg.chat.id.toString() !== process.env.TELEGRAM_CHAT_ID) return;

      const prevMode = state.currentMode;
      const prevStats = state.sessionStats;
      const mode = MODES[i];

      // Send session summary before switching
      const sessionSummary = 
        `📊 Mode ${prevMode} Session Summary:\n` +
        `Trades: ${prevStats.trades} | Net: ${prevStats.netPnlPercent >= 0 ? '+' : ''}${prevStats.netPnlPercent.toFixed(1)}%\n\n` +
        `Switching to Mode ${i} ${mode.emoji} — ${mode.name}`;

      await bot.sendMessage(msg.chat.id, sessionSummary);

      // Reset session stats
      state.currentMode = i;
      state.sessionStats = { mode: i, trades: 0, netPnlPercent: 0, startTime: new Date() };
    });
  }

  // Pause
  bot.onText(/\/pause/, async (msg) => {
    if (msg.chat.id.toString() !== process.env.TELEGRAM_CHAT_ID) return;
    state.isPaused = true;
    await bot.sendMessage(msg.chat.id, '⏸️ Bot paused. No new trades will open.\nUse /resume to restart.');
  });

  // Resume
  bot.onText(/\/resume/, async (msg) => {
    if (msg.chat.id.toString() !== process.env.TELEGRAM_CHAT_ID) return;
    state.isPaused = false;
    await bot.sendMessage(msg.chat.id, '▶️ Bot resumed. Scanning for new coins...');
  });

  // Close all positions
  bot.onText(/\/closeall/, async (msg) => {
    if (msg.chat.id.toString() !== process.env.TELEGRAM_CHAT_ID) return;
    const count = Object.keys(state.openPositions).length;
    if (count === 0) {
      await bot.sendMessage(msg.chat.id, '📭 No open positions to close.');
      return;
    }
    await bot.sendMessage(msg.chat.id, `⏳ Closing ${count} position(s)...`);
    const totalUSD = await closeAllPositions(connection, wallet);
    await sendCloseAllConfirmation(totalUSD);
  });

  // Portfolio
  bot.onText(/\/portfolio/, async (msg) => {
    if (msg.chat.id.toString() !== process.env.TELEGRAM_CHAT_ID) return;
    const positions = Object.values(state.openPositions);

    if (positions.length === 0) {
      await bot.sendMessage(msg.chat.id, '📭 No open positions.');
      return;
    }

    let message = `📋 *Open Positions (${positions.length}/4)*\n\n`;
    for (const pos of positions) {
      const multiplier = pos.currentPrice / pos.entryPrice;
      const pnlPercent = (multiplier - 1) * 100;
      const emoji = pnlPercent >= 0 ? '🟢' : '🔴';
      message += `${emoji} *$${pos.symbol}*\n`;
      message += `Entry: $${pos.entryPrice.toFixed(8)} | Now: $${pos.currentPrice.toFixed(8)}\n`;
      message += `P&L: ${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(1)}% (${multiplier.toFixed(2)}x)\n`;
      message += `Remaining: ${pos.remainingPercent}% of position\n\n`;
    }

    await bot.sendMessage(msg.chat.id, message, { parse_mode: 'Markdown' });
  });

  // Status
  bot.onText(/\/status/, async (msg) => {
    if (msg.chat.id.toString() !== process.env.TELEGRAM_CHAT_ID) return;
    const mode = MODES[state.currentMode];
    const solBalance = await getSOLBalance(connection, wallet.publicKey);
    const solPriceNow = await getSOLPrice();
    const usdBalance = solBalance * solPriceNow;

    await bot.sendMessage(msg.chat.id,
      `📡 *Bot Status*\n\n` +
      `Mode: ${mode.emoji} ${mode.name}\n` +
      `Status: ${state.isPaused ? '⏸️ Paused' : '▶️ Active'}\n` +
      `Open Positions: ${Object.keys(state.openPositions).length}/4\n` +
      `Bet Size: $${state.betSizeUSD.toFixed(2)}\n` +
      `Balance: ${solBalance.toFixed(4)} SOL ($${usdBalance.toFixed(2)})`,
      { parse_mode: 'Markdown' }
    );
  });

  // Bet size
  bot.onText(/\/betsize (.+)/, async (msg, match) => {
    if (msg.chat.id.toString() !== process.env.TELEGRAM_CHAT_ID) return;
    const input = match[1].trim().replace('$', '');
    const amount = parseFloat(input);
    if (isNaN(amount) || amount <= 0) {
      await bot.sendMessage(msg.chat.id, '❌ Invalid amount. Example: /betsize 5 or /betsize $5');
      return;
    }
    state.betSizeUSD = amount;
    await bot.sendMessage(msg.chat.id, `✅ Bet size updated to $${amount} per trade`);
  });

  // Weekly report
  bot.onText(/\/report/, async (msg) => {
    if (msg.chat.id.toString() !== process.env.TELEGRAM_CHAT_ID) return;
    const solBalance = await getSOLBalance(connection, wallet.publicKey);
    const solPriceNow = await getSOLPrice();
    await sendWeeklyReport(state.weeklyStats[state.currentMode], state.currentMode, solBalance, solPriceNow);
  });

  // ==================== APPROVAL HANDLERS ====================

  bot.on('callback_query', async (query) => {
    if (query.message.chat.id.toString() !== process.env.TELEGRAM_CHAT_ID) return;

    const data = query.data;
    await bot.answerCallbackQuery(query.id);

    if (data.startsWith('approve_')) {
      const mintAddress = data.replace('approve_', '');
      const pending = state.pendingApprovals[mintAddress];
      if (!pending) {
        await bot.sendMessage(query.message.chat.id, '⏰ This alert has expired or already been processed.');
        return;
      }

      // Clear timeout
      clearTimeout(pending.timeout);
      delete state.pendingApprovals[mintAddress];
      await removeButtons(query.message.message_id);

      // Check slots available
      if (Object.keys(state.openPositions).length >= 4) {
        await bot.sendMessage(query.message.chat.id, '⚠️ All 4 slots are full. Wait for a position to close.');
        return;
      }

      await bot.sendMessage(query.message.chat.id, `⏳ Buying $${pending.coin.symbol}...`);

      const result = await buyToken(mintAddress, state.betSizeUSD, connection, wallet);

      if (result.success) {
        const position = createPosition(pending.coin, pending.coin.priceUSD, state.betSizeUSD, state.currentMode);
        position.tokensHeld = result.tokensReceived;
        state.openPositions[mintAddress] = position;
        await sendTradeOpened(pending.coin, state.betSizeUSD, result.txid);
      } else {
        await bot.sendMessage(query.message.chat.id, `❌ Trade failed: ${result.error}`);
      }
    }

    if (data.startsWith('skip_')) {
      const mintAddress = data.replace('skip_', '');
      const pending = state.pendingApprovals[mintAddress];
      if (pending) {
        clearTimeout(pending.timeout);
        delete state.pendingApprovals[mintAddress];
      }
      await removeButtons(query.message.message_id);
      await bot.sendMessage(query.message.chat.id, `⏭️ Skipped.`);
    }
  });

  // ==================== MAIN SCANNING LOOP ====================

  async function scanForNewCoins() {
    if (state.isPaused) return;
    if (Object.keys(state.openPositions).length >= 4) return;

    try {
      const newTokens = await fetchNewPumpFunTokens();

      for (const token of newTokens) {
        if (state.isPaused) break;
        if (Object.keys(state.openPositions).length >= 4) break;
        if (state.pendingApprovals[token.mintAddress]) continue;
        if (state.openPositions[token.mintAddress]) continue;

        const modeConfig = MODES[state.currentMode];
        console.log(`🔍 Analyzing ${token.symbol} (${token.mintAddress.slice(0, 8)}...)`);

        const analysis = await analyzeCoin(token.mintAddress, modeConfig, connection);
        if (!analysis || !analysis.passesFilters) {
          console.log(`❌ ${token.symbol} failed filters (score: ${analysis?.score || 0})`);
          continue;
        }

        console.log(`✅ ${token.symbol} passed! Score: ${analysis.score}/10 — sending alert`);

        const messageId = await sendCoinAlert(analysis, modeConfig);

        // Set auto-skip timeout (10 minutes)
        const timeout = setTimeout(async () => {
          if (state.pendingApprovals[token.mintAddress]) {
            delete state.pendingApprovals[token.mintAddress];
            await removeButtons(messageId);
            await getBot().sendMessage(
              process.env.TELEGRAM_CHAT_ID,
              `⏰ Auto-skipped $${token.symbol} (10 min timeout)`
            );
          }
        }, 10 * 60 * 1000);

        state.pendingApprovals[token.mintAddress] = {
          coin: analysis,
          timeout,
          messageId,
        };
      }
    } catch (e) {
      console.error('Scan error:', e.message);
    }
  }

  // ==================== WEEKLY REPORT SCHEDULER ====================

  function scheduleWeeklyReport() {
    const now = new Date();
    const nextSunday = new Date(now);
    nextSunday.setDate(now.getDate() + (7 - now.getDay()));
    nextSunday.setHours(20, 0, 0, 0); // 8pm Sunday

    const msUntilReport = nextSunday - now;

    setTimeout(async () => {
      const solBalance = await getSOLBalance(connection, wallet.publicKey);
      const solPriceNow = await getSOLPrice();
      await sendWeeklyReport(state.weeklyStats[state.currentMode], state.currentMode, solBalance, solPriceNow);

      // Reset weekly stats
      state.weeklyStats[state.currentMode] = {
        trades: 0, wins: 0, losses: 0,
        bestMultiplier: 0, worstMultiplier: 0,
        netPnlPercent: 0, startBalance: solBalance * solPriceNow,
      };
      state.weekStartTime = new Date();

      scheduleWeeklyReport(); // Schedule next one
    }, msUntilReport);
  }

  // ==================== START LOOPS ====================

  scheduleWeeklyReport();

  // Scan for new coins every 15 seconds
  setInterval(scanForNewCoins, 15000);

  // Monitor open positions every 30 seconds
  setInterval(() => monitorPositions(connection, wallet), 30000);

  // Initial scan immediately
  await scanForNewCoins();

  console.log('🚀 Levi Urgent 1.0 is running!');
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
