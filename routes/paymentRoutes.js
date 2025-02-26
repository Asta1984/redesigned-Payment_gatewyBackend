const express = require('express');
const router = express.Router();
const redisClient = require('config/redisClient');
const Payment = require('models/Payment');
const authMiddleware = require('../middleware/authMiddleware');
const { processExternalPayment } = require('../services/paymentService'); // Payment provider logic

// Process Payment Route (Idempotent)
router.post('/payments', authMiddleware, async (req, res) => {
    const idempotencyKey = req.headers['idempotency-key'];
    if (!idempotencyKey) {
        return res.status(400).json({ error: "Idempotency-Key is required" });
    }

    try {
        // Check Redis for previous response
        const cachedResponse = await redisClient.get(idempotencyKey);
        if (cachedResponse) {
            return res.json(JSON.parse(cachedResponse));
        }

        // Save Payment to DB (Initially Pending)
        const payment = await Payment.create({
            userId: req.user.id,
            orderId: req.body.orderId,
            amount: req.body.amount,
            status: "processing"
        });

        // Process with External Payment Provider
        const paymentResult = await processExternalPayment(req.body);

        // Update Payment Status
        payment.status = paymentResult.success ? "completed" : "failed";
        await payment.save();

        // Cache Response in Redis (Idempotency)
        await redisClient.set(idempotencyKey, JSON.stringify(payment), { EX: 3600 });

        return res.json(payment);
    } catch (error) {
        return res.status(500).json({ error: "Payment failed", details: error.message });
    }
});

module.exports = router;
