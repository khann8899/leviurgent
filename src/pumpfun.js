const axios = require('axios');
const seenTokens = new Set();

async function fetchNewPumpFunTokens() {
  try {
    const response = await axios.get(
      'https://api.dexscreener.com/latest/dex/search?q=pump.fun&chainIds=solana',
      { timeout: 8000 }
    );
    const pairs = response.data?.pairs || [];
    const newCoins = [];
    const now = Date.now();

    for (const pair of pairs) {
      const mint = pair.baseToken?.address;
      if (!mint || seenTokens.has(mint)) continue;
      if (mint === 'So11111111111111111111111111111111111111112') continue;
      const ageMinutes = (now - pair.pairCreatedAt) / 1000 / 60;
      if (ageMinutes > 1440 || ageMinutes < 0) continue;
      seenTokens.add(mint);
      if (seenTokens.size > 50) {
        const first = seenTokens.values().next().value;
        seenTokens.delete(first);
      }
      newCoins.push({
        mintAddress: mint,
        symbol: pair.baseToken.symbol || 'UNKNOWN',
        name: pair.baseToken.name || 'Unknown',
        priceUSD: parseFloat(pair.priceUsd) || 0,
        liquidityUSD: pair.liquidity?.usd || 0,
        volumeH1: pair.volume?.h1 || 0,
        priceChangeH1: pair.priceChange?.h1 || 0,
        ageMinutes,
        url: pair.url || '',
        createdAt: pair.pairCreatedAt,
      });
    }
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