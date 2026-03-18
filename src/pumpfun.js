// Levi Urgent - Token Scanner via DexScreener
const axios = require('axios');

const seenTokens = new Set();

async function fetchNewPumpFunTokens() {
  try {
    const response = await axios.get(
      'https://api.dexscreener.com/latest/dex/search?q=solana&chainIds=solana&rank=1',
      {
        timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      }
    );

    const pairs = response.data?.pairs || [];
    const newCoins = [];
    const now = Date.now();

    const sorted = pairs.sort((a, b) => b.pairCreatedAt - a.pairCreatedAt);

    for (const pair of sorted) {
      const mint = pair.baseToken?.address;
      if (!mint) continue;
      if (mint === 'So11111111111111111111111111111111111111112') continue;
      if (seenTokens.has(mint)) continue;

      const ageMinutes = (now - pair.pairCreatedAt) / 1000 / 60;
      if (ageMinutes > 1440 || ageMinutes < 0) continue;

      seenTokens.add(mint);

      if (seenTokens.size > 100) {
        const entries = [...seenTokens];
        entries.slice(0, 50).forEach(k => seenTokens.delete(k));
      }

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
        pairAddress: pair.pairAddress || '',
        createdAt: pair.pairCreatedAt,
      });
    }

    console.log(`📡 DexScreener returned ${pairs.length} pairs, ${newCoins.length} new to analyze`);
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
