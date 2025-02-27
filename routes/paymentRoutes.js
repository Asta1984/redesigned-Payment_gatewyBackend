const express = require('express');
const router = express.Router();
const redisClient = require('../config/redisClient');
const Payment = require('../models/Payment');
const { processExternalPayment } = require('../services/paymentService');
const { verifyWalletSignature } = require('../middleware/walletAuth'); // New auth method

router.post('/payments', async (req, res) => {
    const idempotencyKey = req.headers['idempotency-key'];
    if (!idempotencyKey) {
        return res.status(400).json({ error: "Idempotency-Key is required" });
    }

    try {
        // Verify Wallet Signature (Instead of JWT)
        const { userWallet, signedMessage, nonce } = req.body;
        const isVerified = await verifyWalletSignature(userWallet, signedMessage, nonce);
        if (!isVerified) {
            return res.status(403).json({ error: "Invalid wallet signature" });
        }

        // Check if request has already been processed (idempotency)
        const cachedResponse = await redisClient.get(idempotencyKey);
        if (cachedResponse) {
            return res.json(JSON.parse(cachedResponse));
        }

        // Save initial payment record in DB
        const payment = await Payment.create({
            userWallet,
            orderId: req.body.orderId,
            amount: req.body.amount,
            status: "processing"
        });

        // Call Jupiter Web3 Payment Service
        const paymentResult = await processExternalPayment({
            amount: req.body.amount,
            sourceToken: req.body.sourceToken,
            destinationToken: req.body.destinationToken,
            userWallet
        });

        // Update payment status
        payment.status = paymentResult.success ? "completed" : "failed";
        await payment.save();

        // Store in Redis for idempotency (1 hour expiry)
        await redisClient.set(idempotencyKey, JSON.stringify(payment), { EX: 3600 });

        return res.json(payment);
    } catch (error) {
        return res.status(500).json({ error: "Payment failed", details: error.message });
    }
});

module.exports = router;
