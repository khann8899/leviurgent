// Levi Urgent - Trade Execution via Jupiter DEX
const axios = require('axios');
const { Connection, PublicKey, VersionedTransaction, Keypair } = require('@solana/web3.js');
const bs58 = require('bs58');

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const JUPITER_API = 'https://quote-api.jup.ag/v6';

// Initialize wallet from private key
function initWallet() {
  const privateKeyString = process.env.WALLET_PRIVATE_KEY;
  if (!privateKeyString) throw new Error('WALLET_PRIVATE_KEY not set');
  const decoded = bs58.decode(privateKeyString);
  return Keypair.fromSecretKey(decoded);
}

// Get SOL balance
async function getSOLBalance(connection, publicKey) {
  const balance = await connection.getBalance(new PublicKey(publicKey));
  return balance / 1e9; // Convert lamports to SOL
}

// Get SOL price in USD from DexScreener
async function getSOLPrice() {
  try {
    const response = await axios.get(
      'https://api.dexscreener.com/latest/dex/pairs/solana/So11111111111111111111111111111111111111112',
      { timeout: 5000 }
    );
    // Fallback to a reasonable estimate if API fails
    return response.data?.pairs?.[0]?.priceUsd || 150;
  } catch {
    return 150; // Fallback SOL price
  }
}

// Buy a token using Jupiter
async function buyToken(mintAddress, amountUSD, connection, wallet) {
  try {
    const solPrice = await getSOLPrice();
    const solAmount = amountUSD / solPrice;
    const lamports = Math.floor(solAmount * 1e9);

    // Get quote from Jupiter
    const quoteResponse = await axios.get(`${JUPITER_API}/quote`, {
      params: {
        inputMint: SOL_MINT,
        outputMint: mintAddress,
        amount: lamports,
        slippageBps: 1000, // 10% slippage for memecoins
      },
      timeout: 10000,
    });

    const quote = quoteResponse.data;
    if (!quote) throw new Error('No quote available');

    // Get swap transaction
    const swapResponse = await axios.post(`${JUPITER_API}/swap`, {
      quoteResponse: quote,
      userPublicKey: wallet.publicKey.toString(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 10000, // Small priority fee for faster execution
    }, { timeout: 10000 });

    const { swapTransaction } = swapResponse.data;

    // Deserialize and sign transaction
    const swapTransactionBuf = Buffer.from(swapTransaction, 'base64');
    const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
    transaction.sign([wallet]);

    // Send transaction
    const rawTransaction = transaction.serialize();
    const txid = await connection.sendRawTransaction(rawTransaction, {
      skipPreflight: true,
      maxRetries: 3,
    });

    // Wait for confirmation
    await connection.confirmTransaction(txid, 'confirmed');

    return {
      success: true,
      txid,
      tokensReceived: parseInt(quote.outAmount),
      solSpent: solAmount,
      usdSpent: amountUSD,
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// Sell a percentage of token holdings
async function sellToken(mintAddress, percentToSell, tokensHeld, connection, wallet) {
  try {
    const tokensToSell = Math.floor(tokensHeld * (percentToSell / 100));
    if (tokensToSell <= 0) return { success: false, error: 'No tokens to sell' };

    // Get quote
    const quoteResponse = await axios.get(`${JUPITER_API}/quote`, {
      params: {
        inputMint: mintAddress,
        outputMint: SOL_MINT,
        amount: tokensToSell,
        slippageBps: 1500, // 15% slippage when selling memecoins
      },
      timeout: 10000,
    });

    const quote = quoteResponse.data;
    if (!quote) throw new Error('No quote available');

    // Get swap transaction
    const swapResponse = await axios.post(`${JUPITER_API}/swap`, {
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
    return { success: false, error: e.message };
  }
}

// Get current token price in USD
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
