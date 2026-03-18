// Levi Urgent - Trade Execution via Jupiter DEX
const axios = require('axios');
const { Connection, PublicKey, VersionedTransaction, Keypair } = require('@solana/web3.js');
const bs58 = require('bs58');

const SOL_MINT = 'So11111111111111111111111111111111111111112';

// Try multiple Jupiter endpoints
const JUPITER_ENDPOINTS = [
  'https://quote-api.jup.ag/v6',
  'https://jup.ag/api/v6',
];

async function getJupiterQuote(inputMint, outputMint, amount, slippageBps) {
  for (const base of JUPITER_ENDPOINTS) {
    try {
      const response = await axios.get(`${base}/quote`, {
        params: { inputMint, outputMint, amount, slippageBps },
        timeout: 10000,
      });
      if (response.data) return { quote: response.data, baseUrl: base };
    } catch (e) {
      console.log(`Jupiter endpoint ${base} failed: ${e.message}`);
    }
  }
  return null;
}

function initWallet() {
  const privateKeyString = process.env.WALLET_PRIVATE_KEY;
  if (!privateKeyString) throw new Error('WALLET_PRIVATE_KEY not set');
  const decoded = bs58.decode(privateKeyString);
  return Keypair.fromSecretKey(decoded);
}

async function getSOLBalance(connection, publicKey) {
  const balance = await connection.getBalance(new PublicKey(publicKey));
  return balance / 1e9;
}

async function getSOLPrice() {
  try {
    const response = await axios.get(
      'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
      { timeout: 5000 }
    );
    return response.data?.solana?.usd || 150;
  } catch {
    try {
      const r = await axios.get(
        'https://price.jup.ag/v4/price?ids=SOL',
        { timeout: 5000 }
      );
      return r.data?.data?.SOL?.price || 150;
    } catch {
      return 150;
    }
  }
}

async function buyToken(mintAddress, amountUSD, connection, wallet) {
  try {
    const solPrice = await getSOLPrice();
    const solAmount = amountUSD / solPrice;
    const lamports = Math.floor(solAmount * 1e9);

    const result = await getJupiterQuote(SOL_MINT, mintAddress, lamports, 1000);
    if (!result) throw new Error('All Jupiter endpoints failed - network issue');

    const { quote, baseUrl } = result;

    const swapResponse = await axios.post(`${baseUrl}/swap`, {
      quoteResponse: quote,
      userPublicKey: wallet.publicKey.toString(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 10000,
    }, { timeout: 10000 });

    const { swapTransaction } = swapResponse.data;
    const swapTransactionBuf = Buffer.from(swapTransaction, 'base64');
    const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
    transaction.sign([wallet]);

    const rawTransaction = transaction.serialize();
    const txid = await connection.sendRawTransaction(rawTransaction, {
      skipPreflight: true,
      maxRetries: 3,
    });

    await connection.confirmTransaction(txid, 'confirmed');

    return {
      success: true,
      txid,
      tokensReceived: parseInt(quote.outAmount),
      solSpent: solAmount,
      usdSpent: amountUSD,
    };
  } catch (e) {
    console.error('Buy error:', e.message);
    return { success: false, error: e.message };
  }
}

async function sellToken(mintAddress, percentToSell, tokensHeld, connection, wallet) {
  try {
    const tokensToSell = Math.floor(tokensHeld * (percentToSell / 100));
    if (tokensToSell <= 0) return { success: false, error: 'No tokens to sell' };

    const result = await getJupiterQuote(mintAddress, SOL_MINT, tokensToSell, 1500);
    if (!result) throw new Error('All Jupiter endpoints failed');

    const { quote, baseUrl } = result;

    const swapResponse = await axios.post(`${baseUrl}/swap`, {
      quoteResponse: quote,
      userPublicKey: wallet.publicKey.toString(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 10000,
    }, { timeout: 10000 });

    const { swapTransaction } = swapResponse.data;
    const swapTransactionBuf = Buffer.from(swapTransaction, 'base64');
    const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
    transaction.sign([wallet]);

    const rawTransaction = transaction.serialize();
    const txid = await connection.sendRawTransaction(rawTransaction, {
      skipPreflight: true,
      maxRetries: 3,
    });

    await connection.confirmTransaction(txid, 'confirmed');

    const solReceived = parseInt(quote.outAmount) / 1e9;
    const solPrice = await getSOLPrice();

    return {
      success: true,
      txid,
      tokensSold: tokensToSell,
      solReceived,
      usdReceived: solReceived * solPrice,
    };
  } catch (e) {
    console.error('Sell error:', e.message);
    return { success: false, error: e.message };
  }
}

async function getTokenPrice(mintAddress) {
  try {
    const response = await axios.get(
      `https://api.dexscreener.com/latest/dex/tokens/${mintAddress}`,
      { timeout: 5000 }
    );
    const pairs = response.data?.pairs?.filter(p => p.chainId === 'solana');
    if (!pairs || pairs.length === 0) return null;
    return parseFloat(pairs[0].priceUsd) || null;
  } catch {
    return null;
  }
}

module.exports = { initWallet, buyToken, sellToken, getTokenPrice, getSOLBalance, getSOLPrice };
