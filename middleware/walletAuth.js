const nacl = require("tweetnacl");
const bs58 = require("bs58");

const verifyWalletSignature = async (walletAddress, signedMessage, nonce) => {
    if (!walletAddress || !signedMessage || !nonce) return false;

    try {
        const message = `Sign this message to authenticate: ${nonce}`;
        const messageUint8 = new TextEncoder().encode(message);
        const signatureUint8 = bs58.decode(signedMessage);
        const publicKeyUint8 = bs58.decode(walletAddress);

        return nacl.sign.detached.verify(messageUint8, signatureUint8, publicKeyUint8);
    } catch (error) {
        console.error("Wallet signature verification failed:", error);
        return false;
    }
};

module.exports = { verifyWalletSignature };
