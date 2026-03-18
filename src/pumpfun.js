const axios = require('axios');
const seenTokens = new Set();

async function fetchNewPumpFunTokens() {
  try {
    const response = await axios.get(
      'https://api.dexscreener.com/latest/dex/search?q=solana&chainIds=solana',
      { timeout: 8000 }
    );
    const pairs = response.data?.pairs || [];
    const newCoins = [];

    for (const pair of pairs) {
      if (pair.chainId !== 'solana') continue;
      const mint = pair.baseToken?.address;
      if (!mint || seenTokens.has(mint)) continue;
      const ageMinutes = (Date.now() - pair.pairCreatedAt) / 1000 / 60;
      if (ageMinutes > 120) continue;
      seenTokens.add(mint);
      if (seenTokens.size > 5000) {
        const first = seenTokens.values().next().value;
        seenTokens.delete(first);
      }
      newCoins.push({
        mintAddress: mint,
        symbol: pair.baseToken.symbol || 'UNKNOWN',
        name: pair.baseToken.name || 'Unknown',
        createdAt: pair.pairCreatedAt,
      });
    }
    return newCoins;
  } catch (e) {
    console.error('DexScreener fetch error:', e.message);
    return [];
  }
}

async function fetchRaydiumNewPairs() {
  return [];
}

module.exports = { fetchNewPumpFunTokens, fetchRaydiumNewPairs };