// Levi Urgent - Telegram Bot Interface
const TelegramBot = require('node-telegram-bot-api');
const { state } = require('./state');
const { MODES } = require('../config/modes');

let bot;

function initBot() {
  bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });
  bot.deleteWebHook().then(() => {
    bot.startPolling({ restart: false, params: { timeout: 10 } });
    console.log('✅ Telegram bot initialized');
  }).catch(() => {
    bot.startPolling({ restart: false, params: { timeout: 10 } });
    console.log('✅ Telegram bot initialized');
  });
  return bot;
}

function getBot() {
  return bot;
}

// Send startup message
async function sendStartupMessage() {
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const mode = MODES[state.currentMode];
  await bot.sendMessage(chatId, 
    `🤖 *Levi Urgent 1.0 is LIVE!*\n\n` +
    `Active Mode: ${mode.emoji} Mode ${state.currentMode} — ${mode.name}\n` +
    `Bet Size: $${state.betSizeUSD} per slot\n` +
    `Slots: 4 max concurrent trades\n\n` +
    `Scanning Pump.fun for new coins...\n\n` +
    `Commands:\n` +
    `/mode1 /mode2 /mode3 /mode4\n` +
    `/pause /resume /closeall\n` +
    `/portfolio /report /status\n` +
    `/betsize [amount]`,
    { parse_mode: 'Markdown' }
  );
}

// Format and send coin alert with Approve/Skip buttons
async function sendCoinAlert(coin, modeConfig) {
  const chatId = process.env.TELEGRAM_CHAT_ID;
  
  const scoreEmoji = coin.score >= 8 ? '🔥' : coin.score >= 6 ? '✅' : coin.score >= 4 ? '⚠️' : '❌';
  const openSlots = 4 - Object.keys(state.openPositions).length;

  const message = 
    `${scoreEmoji} *New Coin Alert — Mode ${state.currentMode} ${modeConfig.emoji}*\n\n` +
    `*$${coin.symbol}* — ${coin.name}\n` +
    `Score: ${coin.score}/10\n\n` +
    `💧 Liquidity: $${Math.round(coin.liquidityUSD).toLocaleString()}\n` +
    `👥 Holders: ${coin.holderInfo.totalHolders}\n` +
    `⏱️ Age: ${Math.round(coin.ageMinutes)} mins\n` +
    `📈 1h Change: ${coin.priceChangeH1 > 0 ? '+' : ''}${coin.priceChangeH1.toFixed(1)}%\n` +
    `🔒 Mint Auth: ${coin.authorities.hasMintAuthority ? '⚠️ Active' : '✅ None'}\n` +
    `🍯 Honeypot: ${coin.honeypotInfo.isHoneypot ? '🚫 YES' : '✅ No'}\n\n` +
    (coin.positives.length > 0 ? `✅ ${coin.positives.join('\n✅ ')}\n\n` : '') +
    (coin.flags.length > 0 ? `⚠️ ${coin.flags.join('\n⚠️ ')}\n\n` : '') +
    `💰 Bet: $${state.betSizeUSD} | Open slots: ${openSlots}/4\n` +
    `🎯 TP1: ${modeConfig.takeProfits[0].multiplier}x → sell ${modeConfig.takeProfits[0].sellPercent}%\n` +
    `🎯 TP2: ${modeConfig.takeProfits[1].multiplier}x → sell ${modeConfig.takeProfits[1].sellPercent}%\n` +
    `🛑 Stop Loss: -${modeConfig.stopLossPercent}%\n\n` +
    `⏳ Auto-skip in 10 minutes\n\n` +
    `[View on DexScreener](${coin.url})`;

  const keyboard = {
    inline_keyboard: [[
      { text: '✅ APPROVE', callback_data: `approve_${coin.mintAddress}` },
      { text: '❌ SKIP', callback_data: `skip_${coin.mintAddress}` },
    ]]
  };

  const sent = await bot.sendMessage(chatId, message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
    disable_web_page_preview: false,
  });

  return sent.message_id;
}

// Send trade opened confirmation
async function sendTradeOpened(coin, amountUSD, txid) {
  const chatId = process.env.TELEGRAM_CHAT_ID;
  await bot.sendMessage(chatId,
    `🟢 *Trade Opened!*\n\n` +
    `$${coin.symbol} — $${amountUSD} invested\n` +
    `Entry Price: $${coin.priceUSD.toFixed(8)}\n` +
    `TX: [View](https://solscan.io/tx/${txid})`,
    { parse_mode: 'Markdown' }
  );
}

// Send take profit hit notification
async function sendTakeProfitHit(position, multiplier, usdReceived, tpIndex) {
  const chatId = process.env.TELEGRAM_CHAT_ID;
  await bot.sendMessage(chatId,
    `💰 *Take Profit ${tpIndex + 1} Hit!*\n\n` +
    `$${position.symbol} hit ${multiplier.toFixed(2)}x\n` +
    `Sold portion for: $${usdReceived.toFixed(2)}\n` +
    `Remaining position: ${position.remainingPercent}%`,
    { parse_mode: 'Markdown' }
  );
}

// Send position closed notification
async function sendPositionClosed(position, reason, finalMultiplier, totalPnlUSD) {
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const isWin = totalPnlUSD > 0;
  const emoji = isWin ? '🏆' : '🔴';
  
  await bot.sendMessage(chatId,
    `${emoji} *Position Closed — ${reason}*\n\n` +
    `$${position.symbol}\n` +
    `Final multiplier: ${finalMultiplier.toFixed(2)}x\n` +
    `P&L: ${isWin ? '+' : ''}$${totalPnlUSD.toFixed(2)}\n` +
    `Duration: ${Math.round((Date.now() - position.openedAt) / 1000 / 60)} mins`,
    { parse_mode: 'Markdown' }
  );
}

// Send close all confirmation
async function sendCloseAllConfirmation(totalUSD) {
  const chatId = process.env.TELEGRAM_CHAT_ID;
  await bot.sendMessage(chatId,
    `🔴 *All Positions Closed*\n\n` +
    `Everything converted to SOL\n` +
    `Estimated value: $${totalUSD.toFixed(2)}`,
    { parse_mode: 'Markdown' }
  );
}

// Send weekly report
async function sendWeeklyReport(stats, currentMode, balanceSOL, solPrice) {
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const mode = MODES[currentMode];
  const balanceUSD = balanceSOL * solPrice;
  const wins = stats.wins;
  const losses = stats.losses;
  const total = wins + losses;
  const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : 0;
  const netEmoji = stats.netPnlPercent >= 0 ? '🟢' : '🔴';

  await bot.sendMessage(chatId,
    `📊 *Weekly Report*\n\n` +
    `Mode: ${mode.emoji} ${mode.name}\n\n` +
    `Trades: ${total} | Wins: ${wins} | Losses: ${losses}\n` +
    `Win Rate: ${winRate}%\n` +
    `Best Trade: +${stats.bestMultiplier.toFixed(2)}x\n` +
    `Worst Trade: ${stats.worstMultiplier.toFixed(2)}x\n\n` +
    `${netEmoji} Net Result: ${stats.netPnlPercent >= 0 ? '+' : ''}${stats.netPnlPercent.toFixed(1)}%\n` +
    `💼 Balance: ${balanceSOL.toFixed(4)} SOL ($${balanceUSD.toFixed(2)})`,
    { parse_mode: 'Markdown' }
  );
}

// Edit message to remove buttons after action taken
async function removeButtons(messageId) {
  const chatId = process.env.TELEGRAM_CHAT_ID;
  try {
    await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
      chat_id: chatId,
      message_id: messageId,
    });
  } catch (e) {
    // Message might already be edited, ignore
  }
}

module.exports = {
  initBot,
  getBot,
  sendStartupMessage,
  sendCoinAlert,
  sendTradeOpened,
  sendTakeProfitHit,
  sendPositionClosed,
  sendCloseAllConfirmation,
  sendWeeklyReport,
  removeButtons,
};