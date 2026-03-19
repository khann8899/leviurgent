// Levi Urgent - Trade Execution via Raydium API
const axios = require('axios');
const { Connection, PublicKey, VersionedTransaction, Keypair, Transaction, SystemProgram } = require('@solana/web3.js');
const bs58 = require('bs58');

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const RAYDIUM_SWAP_API = 'https://transaction-v1.raydium.io';

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
    return 150;
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

// Get swap transaction from Raydium
async function getRaydiumSwapTx(inputMint, outputMint, amount, wallet) {
  try {
    // Step 1: Get priority fee
    const priorityResponse = await axios.get(
      `${RAYDIUM_SWAP_API}/main/auto-fee`,
      { timeout: 8000 }
    );
    const priorityFee = priorityResponse.data?.data?.h || 10000;

    // Step 2: Get swap transaction
    const swapResponse = await axios.post(
      `${RAYDIUM_SWAP_API}/transaction/swap-base-in`,
      {
        computeUnitPriceMicroLamports: String(priorityFee),
        swapResponse: {
          id: `swap-${Date.now()}`,
          success: true,
          version: 'V0',
          data: {
            swapType: 'BaseIn',
            inputMint,
            inputAmount: String(amount),
            outputMint,
            outputAmount: '0',
            otherAmountThreshold: '0',
            slippageBps: 1000,
            priceImpactPct: 0,
            referencePrograms: [],
            routePlan: []
          }
        },
        txVersion: 'V0',
        wallet: wallet.publicKey.toString(),
        wrapSol: inputMint === SOL_MINT,
        unwrapSol: outputMint === SOL_MINT,
      },
      { timeout: 10000 }
    );

    return swapResponse.data;
  } catch (e) {
    throw new Error(`Raydium API error: ${e.message}`);
  }
}

// Alternative: Use Raydium's quote + swap flow
async function swapWithRaydium(inputMint, outputMint, amountLamports, wallet, connection) {
  try {
    // Get quote from Raydium
    const quoteResponse = await axios.get(
      `https://api-v3.raydium.io/compute/swap-base-in?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountLamports}&slippageBps=1000&txVersion=V0`,
      { timeout: 10000 }
    );

    if (!quoteResponse.data?.success) {
      throw new Error('Raydium quote failed');
    }

    const swapData = quoteResponse.data.data;

    // Get swap transaction
    const txResponse = await axios.post(
      'https://api-v3.raydium.io/transaction/swap-base-in',
      {
        computeUnitPriceMicroLamports: '10000',
        swapResponse: swapData,
        txVersion: 'V0',
        wallet: wallet.publicKey.toString(),
        wrapSol: inputMint === SOL_MINT,
        unwrapSol: outputMint === SOL_MINT,
      },
      { timeout: 10000 }
    );

    if (!txResponse.data?.success) {
      throw new Error('Raydium swap transaction failed');
    }

    const transactions = txResponse.data.data;

    // Sign and send each transaction
    let lastTxid = null;
    for (const txData of transactions) {
      const txBuffer = Buffer.from(txData.transaction, 'base64');
      const tx = VersionedTransaction.deserialize(txBuffer);
      tx.sign([wallet]);

      const txid = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: true,
        maxRetries: 3,
      });

      await connection.confirmTransaction(txid, 'confirmed');
      lastTxid = txid;
      console.log(`✅ Transaction confirmed: ${txid}`);
    }

    return { success: true, txid: lastTxid, outAmount: swapData.outputAmount };

  } catch (e) {
    console.error('Raydium swap error:', e.message);
    return { success: false, error: e.message };
  }
}

async function buyToken(mintAddress, amountUSD, connection, wallet) {
  try {
    const solPrice = await getSOLPrice();
    const solAmount = amountUSD / solPrice;
    const lamports = Math.floor(solAmount * 1e9);

    console.log(`💱 Buying ${mintAddress} with ${solAmount.toFixed(4)} SOL ($${amountUSD})`);

    const result = await swapWithRaydium(SOL_MINT, mintAddress, lamports, wallet, connection);

    if (result.success) {
      return {
        success: true,
        txid: result.txid,
        tokensReceived: parseInt(result.outAmount) || 0,
        solSpent: solAmount,
        usdSpent: amountUSD,
      };
    } else {
      return { success: false, error: result.error };
    }
  } catch (e) {
    console.error('Buy error:', e.message);
    return { success: false, error: e.message };
  }
}

async function sellToken(mintAddress, percentToSell, tokensHeld, connection, wallet) {
  try {
    const tokensToSell = Math.floor(tokensHeld * (percentToSell / 100));
    if (tokensToSell <= 0) return { success: false, error: 'No tokens to sell' };

    console.log(`💱 Selling ${tokensToSell} tokens (${percentToSell}%) of ${mintAddress}`);

    const result = await swapWithRaydium(mintAddress, SOL_MINT, tokensToSell, wallet, connection);

    if (result.success) {
      const solReceived = parseInt(result.outAmount) / 1e9;
      const solPrice = await getSOLPrice();
      return {
        success: true,
        txid: result.txid,
        tokensSold: tokensToSell,
        solReceived,
        usdReceived: solReceived * solPrice,
      };
    } else {
      return { success: false, error: result.error };
    }
  } catch (e) {
    console.error('Sell error:', e.message);
    return { success: false, error: e.message };
  }
}

module.exports = { initWallet, buyToken, sellToken, getTokenPrice, getSOLBalance, getSOLPrice };