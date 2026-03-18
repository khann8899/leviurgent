// Levi Urgent - Pump.fun New Token Scanner
// Monitors for new token launches in real time

const axios = require('axios');

// Track already seen tokens to avoid duplicates
const seenTokens = new Set();

// Fetch latest tokens from Pump.fun via their API
async function fetchNewPumpFunTokens() {
  try {
    const response = await axios.get(
      'https://frontend-api.pump.fun/coins?offset=0&limit=20&sort=created_timestamp&order=DESC&includeNsfw=false',
      { 
        timeout: 8000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
        }
      }
    );

    const coins = response.data || [];
    const newCoins = [];

    for (const coin of coins) {
      const mint = coin.mint;
      if (!mint || seenTokens.has(mint)) continue;

      seenTokens.add(mint);

      // Keep seenTokens from growing too large
      if (seenTokens.size > 5000) {
        const firstKey = seenTokens.values().next().value;
        seenTokens.delete(firstKey);
      }

      newCoins.push({
        mintAddress: mint,
        symbol: coin.symbol || 'UNKNOWN',
        name: coin.name || 'Unknown',
        createdAt: coin.created_timestamp,
        marketCap: coin.market_cap || 0,
        description: coin.description || '',
        imageUrl: coin.image_uri || '',
      });
    }

    return newCoins;
  } catch (e) {
    console.error('Pump.fun fetch error:', e.message);
    return [];
  }
}

// Also check Raydium for tokens that have graduated from Pump.fun
async function fetchRaydiumNewPairs() {
  try {
    const response = await axios.get(
      'https://api.dexscreener.com/latest/dex/search?q=solana&chainIds=solana',
      { timeout: 8000 }
    );

    const pairs = response.data?.pairs || [];
    const newTokens = [];

    for (const pair of pairs) {
      if (pair.chainId !== 'solana') continue;
      const mint = pair.baseToken?.address;
      if (!mint || seenTokens.has(mint)) continue;

      const ageMinutes = (Date.now() - pair.pairCreatedAt) / 1000 / 60;
      if (ageMinutes > 30) continue; // Only very new pairs

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
