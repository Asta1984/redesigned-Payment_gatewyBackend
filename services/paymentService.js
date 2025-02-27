const { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction, SystemProgram } = require('@solana/web3.js');
const fetch = require('cross-fetch');
const { Wallet } = require('@project-serum/anchor');
const bs58 = require('bs58');
const { Token, TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const retry = require('async-retry');
const redisClient = require('../config/redisClient'); // Redis Setup
const logger = require('../config/logger'); // Winston Logger
require('dotenv').config();

const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL;
const connection = new Connection(SOLANA_RPC_URL, 'confirmed');

const privateKeyArray = JSON.parse(process.env.WALLET_PRIVATE_KEY);
const walletKeypair = Keypair.fromSecretKey(Uint8Array.from(privateKeyArray));
const wallet = new Wallet(walletKeypair);

// USDC Mint Address (Solana Mainnet)
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

// 🔹 Function to retry API calls in case of failure
const fetchWithRetry = async (url, options = {}) => {
    return retry(async () => {
        const response = await fetch(url, options);
        if (!response.ok) throw new Error(`Jupiter API error: ${response.status}`);
        return response.json();
    }, { retries: 3, minTimeout: 1000 });
};

// 🔹 Calculate Dynamic Slippage based on Jupiter's Price Impact
const calculateDynamicSlippage = async (inputToken, outputToken, amount) => {
    try {
        const initialQuoteUrl = `https://quote-api.jup.ag/v6/quote?inputMint=${inputToken}&outputMint=${outputToken}&amount=${amount}&slippageBps=50`;
        const initialQuoteData = await fetchWithRetry(initialQuoteUrl);
        
        if (!initialQuoteData.data) return 50; // Default 0.5%

        const priceImpact = initialQuoteData.data.priceImpactPct || 0;
        const baseSlippage = amount > 10000 ? 1.0 : 0.5;
        const impactMultiplier = 2.0;
        const slippageBps = Math.min(Math.max(Math.round((baseSlippage + priceImpact * impactMultiplier) * 100), 50), 500);
        
        return slippageBps;
    } catch (error) {
        logger.warn("Error calculating slippage, using default:", error);
        return 50;
    }
};

// 🔹 Main Function to Process External Payments
const processExternalPayment = async (paymentData) => {
    try {
        logger.info("Processing payment with Jupiter Swap...", { paymentData });

        const destinationToken = paymentData.destinationToken || USDC_MINT;
        const redisKey = `payment:${paymentData.idempotencyKey}`;

        // Check Redis for idempotency
        const cachedTx = await redisClient.get(redisKey);
        if (cachedTx) return JSON.parse(cachedTx);

        // 1. Calculate Dynamic Slippage
        const slippageBps = paymentData.slippageBps || 
            await calculateDynamicSlippage(paymentData.sourceToken, destinationToken, paymentData.amount);

        // 2. Get Jupiter Quote
        const quoteUrl = `https://quote-api.jup.ag/v6/quote?inputMint=${paymentData.sourceToken}&outputMint=${destinationToken}&amount=${paymentData.amount}&slippageBps=${slippageBps}`;
        const quoteData = await fetchWithRetry(quoteUrl);
        
        if (!quoteData.data) throw new Error(`Failed to get quote: ${JSON.stringify(quoteData)}`);

        // 3. Request Swap Transaction
        const swapUrl = 'https://quote-api.jup.ag/v6/swap';
        const swapRequestBody = {
            quoteResponse: quoteData,
            userPublicKey: paymentData.merchantWallet || wallet.publicKey.toString(),
            wrapAndUnwrapSol: true,
            dynamicComputeUnitLimit: true,
            prioritizationFeeLamports: 1000000,
            nonce: Date.now() // Security improvement: prevent replay attacks
        };
        
        const swapResponse = await fetch(swapUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(swapRequestBody)
        });
        
        const swapData = await swapResponse.json();
        if (!swapData.swapTransaction) throw new Error(`Failed to get swap transaction: ${JSON.stringify(swapData)}`);

        // 4. Deserialize, Sign & Send Transaction
        const serializedTransaction = bs58.decode(swapData.swapTransaction);
        const transaction = Transaction.from(serializedTransaction);
        transaction.partialSign(walletKeypair);

        const txSignature = await sendAndConfirmTransaction(
            connection,
            transaction,
            [walletKeypair],
            { skipPreflight: false, commitment: 'confirmed' }
        );

        // 5. Success Response
        const result = {
            success: true,
            transactionId: txSignature,
            inputAmount: paymentData.amount,
            inputToken: paymentData.sourceToken,
            outputAmount: quoteData.data.outAmount,
            outputToken: destinationToken,
            exchangeRate: quoteData.data.price,
            priceImpact: quoteData.data.priceImpactPct,
            slippage: slippageBps / 100,
            merchantWallet: paymentData.merchantWallet || wallet.publicKey.toString()
        };

        // Store in Redis for Idempotency (Expires in 1 Hour)
        await redisClient.set(redisKey, JSON.stringify(result), { EX: 3600 });

        logger.info(`Jupiter Swap Successful: ${txSignature}`, result);
        return result;
    } catch (error) {
        logger.error("Jupiter Swap Payment Error", { error: error.message });
        return { success: false, error: error.message };
    }
};

module.exports = { processExternalPayment };
