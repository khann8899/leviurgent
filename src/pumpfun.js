const axios = require('axios');
const seenTokens = new Set();

async function fetchNewPumpFunTokens() {
  try {
    const response = await axios.get(
      'https://api.dexscreener.com/token-profiles/latest/v1',
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
    console.error('DexScreener fetch error:', e.message);
    return [];
  }
}

async function fetchRaydiumNewPairs() {
  try {
    const response = await axios.get(
      'https://api.dexscreener.com/latest/dex/search?q=pump&chainIds=solana',
      { timeout: 8000 }
    );
    const pairs = response.data?.pairs || [];
    const newTokens = [];

    for (const pair of pairs) {
      if (pair.chainId !== 'solana') continue;
      const mint = pair.baseToken?.address;
      if (!mint || seenTokens.has(mint)) continue;
      const ageMinutes = (Date.now() - pair.pairCreatedAt) / 1000 / 60;
      if (ageMinutes > 60) continue;
      seenTokens.add(mint);
      newTokens.push({
        mintAddress: mint,
        symbol: pair.baseToken.symbol || 'UNKNOWN',
        name: pair.baseToken.name || 'Unknown',
        createdAt: pair.pairCreatedAt,
      });
    }
    return newTokens;
  } catch (e) {
    return [];
  }
}

module.exports = { fetchNewPumpFunTokens, fetchRaydiumNewPairs };