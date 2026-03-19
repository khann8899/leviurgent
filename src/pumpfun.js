const axios = require('axios');

let seenTokens = new Set();
let lastReset = Date.now();
let urlIndex = 0;

const URLS = [
  'https://api.dexscreener.com/latest/dex/search?q=raydium&chainIds=solana',
  'https://api.dexscreener.com/latest/dex/search?q=pumpfun&chainIds=solana',
  'https://api.dexscreener.com/latest/dex/search?q=moonshot&chainIds=solana',
];

async function fetchNewPumpFunTokens() {
  // Reset seen tokens every 5 minutes
  if (Date.now() - lastReset > 5 * 60 * 1000) {
    seenTokens = new Set();
    lastReset = Date.now();
    console.log('🔄 Reset seen tokens list');
  }

  // Rotate between URLs each scan
  const url = URLS[urlIndex % URLS.length];
  urlIndex++;

  try {
    const response = await axios.get(url, {
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });

    const pairs = response.data?.pairs || [];
    const newCoins = [];
    const now = Date.now();

    const sorted = pairs.sort((a, b) => b.pairCreatedAt - a.pairCreatedAt);

    for (const pair of sorted) {
      const mint = pair.baseToken?.address;
      if (!mint) continue;
      if (mint === 'So11111111111111111111111111111111111111112') continue;
      if (pair.baseToken?.symbol === 'SOL') continue;
      if (pair.baseToken?.symbol === 'WSOL') continue;
      if (seenTokens.has(mint)) continue;

      const ageMinutes = (now - pair.pairCreatedAt) / 1000 / 60;
      if (ageMinutes > 1440 || ageMinutes < 0) continue;

      seenTokens.add(mint);

      newCoins.push({
        mintAddress: mint,
        symbol: pair.baseToken.symbol || 'UNKNOWN',
        name: pair.baseToken.name || 'Unknown',
        priceUSD: parseFloat(pair.priceUsd) || 0,
        liquidityUSD: pair.liquidity?.usd || 0,
        volumeH1: pair.volume?.h1 || 0,
        priceChangeH1: pair.priceChange?.h1 || 0,
        txnsH1: (pair.txns?.h1?.buys || 0) + (pair.txns?.h1?.sells || 0),
        ageMinutes,
        url: pair.url || `https://dexscreener.com/solana/${mint}`,
        createdAt: pair.pairCreatedAt,
      });
    }

    console.log(`📡 DexScreener [${url.split('q=')[1].split('&')[0]}] returned ${pairs.length} pairs, ${newCoins.length} new`);
    return newCoins;

  } catch (e) {
    console.error('Fetch error:', e.message);
    return [];
  }
}

async function fetchRaydiumNewPairs() {
  return [];
}

module.exports = { fetchNewPumpFunTokens, fetchRaydiumNewPairs };