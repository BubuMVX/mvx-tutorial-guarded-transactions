import { Address, TransactionsFactoryConfig, TransferTransactionsFactory } from '@multiversx/sdk-core/out';
import { TRANSACTION_OPTIONS_TX_GUARDED } from '@multiversx/sdk-core/out/core/constants';
import GenericGuardianProvider from '@multiversx/sdk-guardians-provider/out/genericGuardianProvider';
import GuardianProviderFactory from '@multiversx/sdk-guardians-provider/out/guardianProviderFactory';
import TCSGuardianProvider from '@multiversx/sdk-guardians-provider/out/providers/TCSGuardianProvider';
import { ApiNetworkProvider } from '@multiversx/sdk-network-providers/out';
import { ErrNetworkProvider } from '@multiversx/sdk-network-providers/out/errors';
import { Mnemonic, UserSigner } from '@multiversx/sdk-wallet/out';
import BigNumber from 'bignumber.js';
import OTP from 'otp';
import { load } from 'ts-dotenv';

(async () => {
    // Load env variables
    const env = load({
        MNEMONIC: String,
        WALLET_INDEX: Number,
        GUARDIAN_OTP: String,
        NETWORK_NAME: String,
        NETWORK_API: String,
    });

    // Load mnemonic seed phrase
    const mnemonic = Mnemonic.fromString(env.MNEMONIC);
    // Derive the seed as a key for the specified index
    const walletKey = mnemonic.deriveKey(env.WALLET_INDEX);
    // Create a transaction signer for this wallet
    const walletSigner = new UserSigner(walletKey);
    // Create an address object
    const address = new Address(walletSigner.getAddress().bech32());
    // Create a network provider using the MVX API
    const provider = new ApiNetworkProvider(env.NETWORK_API, {
        clientName: 'mvx-tutorial-guardian',
    });
    // Load the selected network configuration
    const networkConfig = await provider.getNetworkConfig();
    // Create a network provider using Guardian API for the current wallet
    const guardianProvider: TCSGuardianProvider | GenericGuardianProvider = await GuardianProviderFactory.createProvider({
        address: address.toBech32(),
        apiAddress: env.NETWORK_API,
        networkId: env.NETWORK_NAME,
    });

    // Create transaction factories for a simple EGLD transfer
    const factoryConfig = new TransactionsFactoryConfig({
        chainID: networkConfig.ChainID,
    });
    const factory = new TransferTransactionsFactory({
        config: factoryConfig,
    });

    // Load the current status of the wallet from the network (balance, current nonce, etc)
    const account = await provider.getAccount(address);

    // Create a new transaction: send 1 EGLD to ourself (EGLD has 18 decimals)
    const transaction = factory.createTransactionForNativeTokenTransfer(
        address,
        {
            receiver: address,
            nativeAmount: BigInt(new BigNumber(1).shiftedBy(18).toFixed()),
        },
    );

    // Add more gas for the Guardian verification
    transaction.gasLimit += 50000n;
    // Set the transaction nonce
    transaction.nonce = BigInt(account.nonce);
    // Prepare the transaction for Guardian
    transaction.options = TRANSACTION_OPTIONS_TX_GUARDED;
    transaction.version = 2;
    transaction.guardian = new Address(guardianProvider.guardianAddress);

    // Create a new One-Time Password object with our secret 2FA seed
    const otp = new OTP({
        secret: env.GUARDIAN_OTP,
    });
    // Get the current OTP code valid right now
    const code = otp.totp(Date.now());

    // Apply the Guardian signature to the transaction
    const guardedTransactions = await guardianProvider.applyGuardianSignature({
        transactions: [transaction],
        code: code,
    });

    // Get the first transaction sent
    const guardedTransaction = guardedTransactions[0];
    // Serialize the transaction
    const serializedTx = guardedTransaction.serializeForSigning();
    // Sign the final transaction state with the wallet
    guardedTransaction.signature = await walletSigner.sign(serializedTx);

    // Broadcast the fully crafted transaction
    await provider
        .sendTransaction(guardedTransaction)
        .then((txHash) => {
            console.log('Transaction hash', txHash);
        })
        .catch((reason: ErrNetworkProvider) => {
            console.error(reason.message);
        });
})();
