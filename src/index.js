// Levi Urgent 1.0 - Main Entry Point
require('dotenv').config();

const { Connection } = require('@solana/web3.js');
const { state, createPosition } = require('./state');
const { MODES } = require('../config/modes');
const { analyzeCoin } = require('./scanner');
const { initWallet, buyToken, getSOLBalance, getSOLPrice } = require('./trader');
const { monitorPositions, closeAllPositions } = require('./monitor');
const { fetchNewPumpFunTokens } = require('./pumpfun');
const {
  initBot, getBot, sendStartupMessage,
  sendCoinAlert, sendTradeOpened,
  sendCloseAllConfirmation, sendWeeklyReport,
  removeButtons,
} = require('./telegram');

function validateEnv() {
  const required = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'WALLET_PRIVATE_KEY', 'SOLANA_RPC_URL'];
  for (const key of required) {
    if (!process.env[key]) throw new Error(`Missing: ${key}`);
  }
}

async function main() {
  validateEnv();

  const connection = new Connection(process.env.SOLANA_RPC_URL, 'confirmed');
  const wallet = initWallet();

  console.log(`✅ Wallet: ${wallet.publicKey.toString()}`);

  const initialSOL = await getSOLBalance(connection, wallet.publicKey);
  const solPrice = await getSOLPrice();
  const initialUSD = initialSOL * solPrice;

  state.weekStartBalance = initialUSD;
  state.betSizeUSD = parseFloat((initialUSD / 4).toFixed(2));

  console.log(`💰 Balance: ${initialSOL.toFixed(4)} SOL ($${initialUSD.toFixed(2)})`);
  console.log(`🎯 Bet size: $${state.betSizeUSD} per slot`);

  const bot = initBot();

  // Wait for bot to be ready
  await new Promise(resolve => setTimeout(resolve, 3000));

  await sendStartupMessage();

  // ==================== COMMANDS ====================

  for (let i = 1; i <= 4; i++) {
    bot.onText(new RegExp(`^/mode${i}$`), async (msg) => {
      if (msg.chat.id.toString() !== process.env.TELEGRAM_CHAT_ID) return;
      const prevMode = state.currentMode;
      const prevStats = state.sessionStats;
      const mode = MODES[i];
      await bot.sendMessage(msg.chat.id,
        `📊 Mode ${prevMode} Session:\nTrades: ${prevStats.trades} | Net: ${prevStats.netPnlPercent >= 0 ? '+' : ''}${prevStats.netPnlPercent.toFixed(1)}%\n\n` +
        `Switching to Mode ${i} ${mode.emoji} — ${mode.name}`
      );
      state.currentMode = i;
      state.sessionStats = { mode: i, trades: 0, netPnlPercent: 0, startTime: new Date() };
    });
  }

  bot.onText(/^\/pause$/, async (msg) => {
    if (msg.chat.id.toString() !== process.env.TELEGRAM_CHAT_ID) return;
    state.isPaused = true;
    await bot.sendMessage(msg.chat.id, '⏸️ Paused. Use /resume to restart.');
  });

  bot.onText(/^\/resume$/, async (msg) => {
    if (msg.chat.id.toString() !== process.env.TELEGRAM_CHAT_ID) return;
    state.isPaused = false;
    await bot.sendMessage(msg.chat.id, '▶️ Resumed. Scanning...');
  });

  bot.onText(/^\/closeall$/, async (msg) => {
    if (msg.chat.id.toString() !== process.env.TELEGRAM_CHAT_ID) return;
    const count = Object.keys(state.openPositions).length;
    if (count === 0) { await bot.sendMessage(msg.chat.id, '📭 No open positions.'); return; }
    await bot.sendMessage(msg.chat.id, `⏳ Closing ${count} position(s)...`);
    const totalUSD = await closeAllPositions(connection, wallet);
    await sendCloseAllConfirmation(totalUSD);
  });

  bot.onText(/^\/portfolio$/, async (msg) => {
    if (msg.chat.id.toString() !== process.env.TELEGRAM_CHAT_ID) return;
    const positions = Object.values(state.openPositions);
    if (positions.length === 0) { await bot.sendMessage(msg.chat.id, '📭 No open positions.'); return; }
    let message = `📋 *Open Positions (${positions.length}/4)*\n\n`;
    for (const pos of positions) {
      const multiplier = pos.currentPrice / pos.entryPrice;
      const pnl = (multiplier - 1) * 100;
      message += `${pnl >= 0 ? '🟢' : '🔴'} *$${pos.symbol}*\n`;
      message += `P&L: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(1)}% (${multiplier.toFixed(2)}x)\n`;
      message += `Remaining: ${pos.remainingPercent}%\n\n`;
    }
    await bot.sendMessage(msg.chat.id, message, { parse_mode: 'Markdown' });
  });

  bot.onText(/^\/status$/, async (msg) => {
    if (msg.chat.id.toString() !== process.env.TELEGRAM_CHAT_ID) return;
    const mode = MODES[state.currentMode];
    const solBal = await getSOLBalance(connection, wallet.publicKey);
    const solPriceNow = await getSOLPrice();
    await bot.sendMessage(msg.chat.id,
      `📡 *Bot Status*\n\n` +
      `Mode: ${mode.emoji} ${mode.name}\n` +
      `Status: ${state.isPaused ? '⏸️ Paused' : '▶️ Active'}\n` +
      `Open Positions: ${Object.keys(state.openPositions).length}/4\n` +
      `Bet Size: $${state.betSizeUSD}\n` +
      `Balance: ${solBal.toFixed(4)} SOL ($${(solBal * solPriceNow).toFixed(2)})`,
      { parse_mode: 'Markdown' }
    );
  });

  bot.onText(/^\/betsize (.+)$/, async (msg, match) => {
    if (msg.chat.id.toString() !== process.env.TELEGRAM_CHAT_ID) return;
    const amount = parseFloat(match[1].replace('$', ''));
    if (isNaN(amount) || amount <= 0) { await bot.sendMessage(msg.chat.id, '❌ Example: /betsize 3'); return; }
    state.betSizeUSD = amount;
    await bot.sendMessage(msg.chat.id, `✅ Bet size: $${amount} per trade`);
  });

  bot.onText(/^\/report$/, async (msg) => {
    if (msg.chat.id.toString() !== process.env.TELEGRAM_CHAT_ID) return;
    const solBal = await getSOLBalance(connection, wallet.publicKey);
    const solPriceNow = await getSOLPrice();
    await sendWeeklyReport(state.weeklyStats[state.currentMode], state.currentMode, solBal, solPriceNow);
  });

  // ==================== APPROVALS ====================

  bot.on('callback_query', async (query) => {
    if (query.message.chat.id.toString() !== process.env.TELEGRAM_CHAT_ID) return;
    await bot.answerCallbackQuery(query.id);
    const data = query.data;

    if (data.startsWith('approve_')) {
      const mintAddress = data.replace('approve_', '');
      const pending = state.pendingApprovals[mintAddress];
      if (!pending) { await bot.sendMessage(query.message.chat.id, '⏰ Alert expired.'); return; }
      clearTimeout(pending.timeout);
      delete state.pendingApprovals[mintAddress];
      await removeButtons(query.message.message_id);

      if (Object.keys(state.openPositions).length >= 4) {
        await bot.sendMessage(query.message.chat.id, '⚠️ All 4 slots full.');
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
      if (pending) { clearTimeout(pending.timeout); delete state.pendingApprovals[mintAddress]; }
      await removeButtons(query.message.message_id);
      await bot.sendMessage(query.message.chat.id, `⏭️ Skipped.`);
    }
  });

  // ==================== SCAN LOOP ====================

  async function scanForNewCoins() {
    if (state.isPaused) return;
    if (Object.keys(state.openPositions).length >= 4) return;

    try {
      const newTokens = await fetchNewPumpFunTokens();
      console.log(`🔎 Found ${newTokens.length} new tokens to check`);

      for (const token of newTokens) {
        if (state.isPaused) break;
        if (Object.keys(state.openPositions).length >= 4) break;
        if (state.pendingApprovals[token.mintAddress]) continue;
        if (state.openPositions[token.mintAddress]) continue;

        const modeConfig = MODES[state.currentMode];
        console.log(`🔍 Analyzing ${token.symbol} (${token.mintAddress.slice(0, 8)}...)`);

        const analysis = await analyzeCoin(token, modeConfig, connection);
        if (!analysis) continue;

        console.log(`📊 ${token.symbol} score: ${analysis.score}/10 | passes: ${analysis.passesFilters}`);

        if (!analysis.passesFilters) continue;

        console.log(`✅ ${token.symbol} passed! Sending alert...`);
        const messageId = await sendCoinAlert(analysis, modeConfig);

        const timeout = setTimeout(async () => {
          if (state.pendingApprovals[token.mintAddress]) {
            delete state.pendingApprovals[token.mintAddress];
            await removeButtons(messageId);
            await getBot().sendMessage(process.env.TELEGRAM_CHAT_ID, `⏰ Auto-skipped $${token.symbol}`);
          }
        }, 10 * 60 * 1000);

        state.pendingApprovals[token.mintAddress] = { coin: analysis, timeout, messageId };
      }
    } catch (e) {
      console.error('Scan error:', e.message);
    }
  }

  // ==================== WEEKLY REPORT ====================

  function scheduleWeeklyReport() {
    const now = new Date();
    const nextSunday = new Date(now);
    nextSunday.setDate(now.getDate() + (7 - now.getDay()));
    nextSunday.setHours(20, 0, 0, 0);
    const ms = nextSunday - now;
    setTimeout(async () => {
      const solBal = await getSOLBalance(connection, wallet.publicKey);
      const solPriceNow = await getSOLPrice();
      await sendWeeklyReport(state.weeklyStats[state.currentMode], state.currentMode, solBal, solPriceNow);
      state.weeklyStats[state.currentMode] = { trades: 0, wins: 0, losses: 0, bestMultiplier: 0, worstMultiplier: 0, netPnlPercent: 0 };
      scheduleWeeklyReport();
    }, ms);
  }

  scheduleWeeklyReport();

  // Scan every 45 seconds
  setInterval(scanForNewCoins, 45000);

  // Monitor positions every 30 seconds
  setInterval(() => monitorPositions(connection, wallet), 30000);

  // Initial scan
  await scanForNewCoins();

  console.log('🚀 Levi Urgent 1.0 is running!');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
