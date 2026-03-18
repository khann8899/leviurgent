// Levi Urgent - Scam Detection & Coin Filtering
const axios = require('axios');

async function checkHoneypot(mintAddress) {
  try {
    const response = await axios.get(
      `https://api.honeypot.is/v2/IsHoneypot?address=${mintAddress}&chainID=solana`,
      { timeout: 5000 }
    );
    const data = response.data;
    return {
      isHoneypot: data.honeypotResult?.isHoneypot || false,
      buyTax: data.simulationResult?.buyTax || 0,
      sellTax: data.simulationResult?.sellTax || 0,
    };
  } catch (e) {
    return { isHoneypot: false, buyTax: 0, sellTax: 0, error: true };
  }
}

async function getTokenInfo(mintAddress) {
  try {
    const response = await axios.get(
      `https://api.dexscreener.com/latest/dex/tokens/${mintAddress}`,
      { timeout: 8000 }
    );
    const pairs = response.data?.pairs;
    if (!pairs || pairs.length === 0) return null;

    const solanaPairs = pairs.filter(p => p.chainId === 'solana');
    if (solanaPairs.length === 0) return null;

    const pair = solanaPairs.sort((a, b) =>
      (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)
    )[0];

    const ageMinutes = (Date.now() - pair.pairCreatedAt) / 1000 / 60;

    return {
      mintAddress,
      symbol: pair.baseToken.symbol,
      name: pair.baseToken.name,
      priceUSD: parseFloat(pair.priceUsd) || 0,
      liquidityUSD: pair.liquidity?.usd || 0,
      volumeH1: pair.volume?.h1 || 0,
      priceChangeH1: pair.priceChange?.h1 || 0,
      txnsH1: (pair.txns?.h1?.buys || 0) + (pair.txns?.h1?.sells || 0),
      ageMinutes,
      pairAddress: pair.pairAddress,
      dexId: pair.dexId,
      url: pair.url,
    };
  } catch (e) {
    return null;
  }
}

async function getHolderInfo(mintAddress) {
  try {
    const response = await axios.get(
      `https://api.solscan.io/token/holders?tokenAddress=${mintAddress}&limit=20&offset=0`,
      {
        timeout: 8000,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      }
    );
    const holders = response.data?.data?.result || [];
    const totalHolders = response.data?.data?.total || 0;
    const totalSupply = holders.reduce((sum, h) => sum + h.amount, 0);
    const topHolderAmount = holders[0]?.amount || 0;
    const topHolderPercent = totalSupply > 0 ? (topHolderAmount / totalSupply) * 100 : 100;

    return { totalHolders, topHolderPercent };
  } catch (e) {
    return { totalHolders: 0, topHolderPercent: 100, error: true };
  }
}

async function checkAuthorities(mintAddress, connection) {
  try {
    const { PublicKey } = require('@solana/web3.js');
    const mintInfo = await connection.getParsedAccountInfo(new PublicKey(mintAddress));
    const parsed = mintInfo?.value?.data?.parsed?.info;
    if (!parsed) return { hasMintAuthority: false, hasFreezeAuthority: false };

    return {
      hasMintAuthority: parsed.mintAuthority !== null,
      hasFreezeAuthority: parsed.freezeAuthority !== null,
    };
  } catch (e) {
    return { hasMintAuthority: false, hasFreezeAuthority: false };
  }
}

function scoreCoin(tokenInfo, holderInfo, honeypotInfo, authorities, modeConfig) {
  let score = 5;
  const flags = [];
  const positives = [];

  // Critical failures
  if (honeypotInfo.isHoneypot) return { score: 0, flags: ['🚫 HONEYPOT DETECTED'], positives: [] };
  if (honeypotInfo.sellTax > 10) return { score: 0, flags: [`🚫 High sell tax: ${honeypotInfo.sellTax}%`], positives: [] };
  if (modeConfig.filters.mustHaveNoMintAuthority && authorities.hasMintAuthority) {
    score -= 2;
    flags.push('⚠️ Mint authority active');
  }

  // Liquidity
  const liq = tokenInfo.liquidityUSD || 0;
  if (liq >= modeConfig.filters.minLiquidityUSD) {
    score += 1;
    positives.push(`💧 Liquidity: $${Math.round(liq).toLocaleString()}`);
  } else if (liq > 0) {
    score -= 1;
    flags.push(`⚠️ Low liquidity: $${Math.round(liq).toLocaleString()}`);
  } else {
    score -= 2;
    flags.push('⚠️ No liquidity data');
  }

  // Age
  const age = tokenInfo.ageMinutes || 0;
  if (age >= modeConfig.filters.minAgeMinutes && age <= modeConfig.filters.maxAgeMinutes) {
    positives.push(`⏱️ Age: ${Math.round(age)} mins`);
    score += 1;
  } else {
    score -= 1;
    flags.push(`⚠️ Age: ${Math.round(age)} mins`);
  }

  // Volume activity
  if (tokenInfo.volumeH1 > 5000) {
    score += 1;
    positives.push(`📈 Volume 1h: $${Math.round(tokenInfo.volumeH1).toLocaleString()}`);
  }

  // Transactions
  if (tokenInfo.txnsH1 > 50) {
    score += 1;
    positives.push(`🔄 Txns 1h: ${tokenInfo.txnsH1}`);
  }

  // Price change
  if (tokenInfo.priceChangeH1 > 10) {
    positives.push(`🚀 1h change: +${tokenInfo.priceChangeH1.toFixed(1)}%`);
  }

  score = Math.max(1, Math.min(10, score));
  return { score, flags, positives };
}

async function analyzeCoin(coin, modeConfig, connection) {
  try {
    // Use data already fetched from DexScreener if available
    let tokenInfo = {
      mintAddress: coin.mintAddress,
      symbol: coin.symbol,
      name: coin.name,
      priceUSD: coin.priceUSD || 0,
      liquidityUSD: coin.liquidityUSD || 0,
      volumeH1: coin.volumeH1 || 0,
      priceChangeH1: coin.priceChangeH1 || 0,
      txnsH1: coin.txnsH1 || 0,
      ageMinutes: coin.ageMinutes || 0,
      url: coin.url || `https://dexscreener.com/solana/${coin.mintAddress}`,
    };

    // Run honeypot and authority checks in parallel
    const [honeypotInfo, authorities] = await Promise.all([
      checkHoneypot(coin.mintAddress),
      checkAuthorities(coin.mintAddress, connection),
    ]);

    // Use basic holder info since Solscan is unreliable
    const holderInfo = { totalHolders: 100, topHolderPercent: 10 };

    const { score, flags, positives } = scoreCoin(tokenInfo, holderInfo, honeypotInfo, authorities, modeConfig);

    return {
      ...tokenInfo,
      holderInfo,
      honeypotInfo,
      authorities,
      score,
      flags,
      positives,
      passesFilters: score >= 3 && !honeypotInfo.isHoneypot,
    };
  } catch (e) {
    console.error(`Analysis error for ${coin.symbol}:`, e.message);
    return null;
  }
}

module.exports = { analyzeCoin, getTokenInfo };
