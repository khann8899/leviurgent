// Levi Urgent - Scam Detection & Coin Filtering
const axios = require('axios');

// Check if a coin is a honeypot using honeypot.is API
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
    // If API fails, assume it might be risky
    return { isHoneypot: false, buyTax: 0, sellTax: 0, error: true };
  }
}

// Get token info from DexScreener
async function getTokenInfo(mintAddress) {
  try {
    const response = await axios.get(
      `https://api.dexscreener.com/latest/dex/tokens/${mintAddress}`,
      { timeout: 8000 }
    );
    const pairs = response.data?.pairs;
    if (!pairs || pairs.length === 0) return null;

    // Get the most liquid Solana pair
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

// Get holder info from Solscan
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

    // Calculate top holder percentage
    const totalSupply = holders.reduce((sum, h) => sum + h.amount, 0);
    const topHolderAmount = holders[0]?.amount || 0;
    const topHolderPercent = totalSupply > 0 ? (topHolderAmount / totalSupply) * 100 : 100;

    return {
      totalHolders,
      topHolderPercent,
    };
  } catch (e) {
    return { totalHolders: 0, topHolderPercent: 100, error: true };
  }
}

// Check mint and freeze authority via Solana RPC
async function checkAuthorities(mintAddress, connection) {
  try {
    const { PublicKey } = require('@solana/web3.js');
    const mintInfo = await connection.getParsedAccountInfo(new PublicKey(mintAddress));
    const parsed = mintInfo?.value?.data?.parsed?.info;
    if (!parsed) return { hasMintAuthority: true, hasFreezeAuthority: true };

    return {
      hasMintAuthority: parsed.mintAuthority !== null,
      hasFreezeAuthority: parsed.freezeAuthority !== null,
    };
  } catch (e) {
    return { hasMintAuthority: true, hasFreezeAuthority: true };
  }
}

// Score a coin from 1-10 based on mode filters
function scoreCoin(tokenInfo, holderInfo, honeypotInfo, authorities, modeConfig) {
  let score = 5; // Base score
  const flags = [];
  const positives = [];

  // Critical failures - instant disqualify
  if (honeypotInfo.isHoneypot) return { score: 0, flags: ['🚫 HONEYPOT DETECTED'], positives: [] };
  if (honeypotInfo.sellTax > 10) return { score: 0, flags: [`🚫 High sell tax: ${honeypotInfo.sellTax}%`], positives: [] };

  if (modeConfig.filters.mustHaveNoMintAuthority && authorities.hasMintAuthority) {
    return { score: 0, flags: ['🚫 Mint authority active - dev can print tokens'], positives: [] };
  }

  // Liquidity scoring
  const liq = tokenInfo.liquidityUSD;
  if (liq >= modeConfig.filters.minLiquidityUSD) {
    if (liq > modeConfig.filters.minLiquidityUSD * 3) { score += 1; positives.push(`💧 Strong liquidity: $${Math.round(liq).toLocaleString()}`); }
    else { positives.push(`💧 Liquidity: $${Math.round(liq).toLocaleString()}`); }
  } else {
    score -= 2;
    flags.push(`⚠️ Low liquidity: $${Math.round(liq).toLocaleString()}`);
  }

  // Holder scoring
  const holders = holderInfo.totalHolders;
  if (holders >= modeConfig.filters.minHolders) {
    if (holders > modeConfig.filters.minHolders * 2) { score += 1; positives.push(`👥 Strong holder count: ${holders}`); }
    else { positives.push(`👥 Holders: ${holders}`); }
  } else {
    score -= 1;
    flags.push(`⚠️ Low holders: ${holders}`);
  }

  // Top holder concentration
  if (holderInfo.topHolderPercent <= modeConfig.filters.maxTopHolderPercent) {
    positives.push(`📊 Top holder: ${holderInfo.topHolderPercent.toFixed(1)}%`);
  } else {
    score -= 2;
    flags.push(`⚠️ Top holder owns ${holderInfo.topHolderPercent.toFixed(1)}%`);
  }

  // Age check
  const age = tokenInfo.ageMinutes;
  if (age >= modeConfig.filters.minAgeMinutes && age <= modeConfig.filters.maxAgeMinutes) {
    positives.push(`⏱️ Age: ${Math.round(age)} mins`);
  } else if (age < modeConfig.filters.minAgeMinutes) {
    score -= 1;
    flags.push(`⚠️ Too new: ${Math.round(age)} mins`);
  } else {
    score -= 2;
    flags.push(`⚠️ Too old: ${Math.round(age)} mins`);
  }

  // Volume activity
  if (tokenInfo.volumeH1 > 10000) { score += 1; positives.push(`📈 Active volume: $${Math.round(tokenInfo.volumeH1).toLocaleString()}`); }

  // Freeze authority warning
  if (authorities.hasFreezeAuthority && modeConfig.filters.mustHaveNoFreezeAuthority) {
    score -= 1;
    flags.push(`⚠️ Freeze authority active`);
  }

  // Clamp score between 1-10
  score = Math.max(1, Math.min(10, score));

  return { score, flags, positives };
}

// Main function: run all checks and return verdict
async function analyzeCoin(mintAddress, modeConfig, connection) {
  const [tokenInfo, holderInfo, honeypotInfo] = await Promise.all([
    getTokenInfo(mintAddress),
    getHolderInfo(mintAddress),
    checkHoneypot(mintAddress),
  ]);

  if (!tokenInfo) return null;

  const authorities = await checkAuthorities(mintAddress, connection);
  const { score, flags, positives } = scoreCoin(tokenInfo, holderInfo, honeypotInfo, authorities, modeConfig);

  return {
    ...tokenInfo,
    holderInfo,
    honeypotInfo,
    authorities,
    score,
    flags,
    positives,
    passesFilters: score >= 2 && !honeypotInfo.isHoneypot,
  };
}

module.exports = { analyzeCoin, getTokenInfo };
