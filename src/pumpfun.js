const axios = require('axios');
const seenTokens = new Set();

async function fetchNewPumpFunTokens() {
  try {
    const response = await axios.get(
      'https://api.dexscreener.com/token-boosts/latest/v1',
      { timeout: 8000 }
    );
    const tokens = response.data || [];
    const newCoins = [];
    for (const token of tokens) {
      if (token.chainId !== 'solana') continue;
      const mint = token.tokenAddress;
      if (!mint || seenTokens.has(mint)) continue;
      seenTokens.add(mint);
      if (seenTokens.size > 5000) {
        const first = seenTokens.values().next().value;
        seenTokens.delete(first);
      }
      newCoins.push({
        mintAddress: mint,
        symbol: token.symbol || 'UNKNOWN',
        name: token.name || 'Unknown',
        createdAt: Date.now(),
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