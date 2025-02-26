const stripe = require('stripe')(process.env.STRIPE_SECRET);

const processExternalPayment = async (paymentData) => {
    try {
        const paymentIntent = await stripe.paymentIntents.create({
            amount: paymentData.amount * 100, // Convert to cents
            currency: 'usd',
            payment_method: paymentData.paymentMethodId,
            confirm: true
        });

        return { success: true, transactionId: paymentIntent.id };
    } catch (error) {
        console.error("Payment Processing Error:", error);
        return { success: false, error: error.message };
    }
};

module.exports = { processExternalPayment };
