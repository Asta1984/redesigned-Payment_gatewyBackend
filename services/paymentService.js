const { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } = require('@solana/web3.js');
require('dotenv').config();

const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL; // Use Alchemy Testnet RPC
const connection = new Connection(SOLANA_RPC_URL, 'confirmed'); // Connect to Alchemy's RPC

// Parse the Uint8Array private key from .env
const privateKeyArray = JSON.parse(process.env.WALLET_PRIVATE_KEY);
const walletKeypair = Keypair.fromSecretKey(Uint8Array.from(privateKeyArray));

const processExternalPayment = async (paymentData) => {
    try {
        console.log("Connecting to Solana Testnet via Alchemy...");

        // Fetch recent blockhash
        const { blockhash } = await connection.getLatestBlockhash();

        // Sample transaction to send SOL (Replace this with Jupiter Swap logic)
        const transaction = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: walletKeypair.publicKey,
                toPubkey: new PublicKey(paymentData.userWallet),
                lamports: paymentData.amount * 1e9 // Convert SOL to lamports
            })
        );

        transaction.recentBlockhash = blockhash;
        transaction.sign(walletKeypair);

        // Send and confirm transaction
        const txSignature = await sendAndConfirmTransaction(connection, transaction, [walletKeypair]);

        console.log(`Transaction Successful: ${txSignature}`);

        return { success: true, transactionId: txSignature };
    } catch (error) {
        console.error("Alchemy Solana Testnet Payment Error:", error);
        return { success: false, error: error.message };
    }
};

module.exports = { processExternalPayment };
