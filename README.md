# MultiversX coding tutorial: how to sign a transaction with Guardian?

## Introduction

The purpose of this tutorial is to show you how to build and sign a transaction for a wallet protected by Guardian, the
2FA solution for MultiversX.

We will create a Node.js application in TypeScript and use the following libraries:

- `@multiversx/sdk-core`, the MultiversX SDK for JavaScript and TypeScript.
- `@multiversx/sdk-guardians-provider`, the Guardian network providers components for co-signing transactions.
- `@multiversx/sdk-network-providers`, a general purpose network providers components for MultiversX.
- `@multiversx/sdk-wallet`, the wallet components for MultiversX.
- `bignumber.js`, a library for arbitrary-precision decimal and non-decimal arithmetic.
- `otp`, an One-Time Password (OTP) utility.
- `ts-dotenv`, a strongly-typed environment variables loader.

This demonstration will send 1 EGLD from the provided wallet to itself, and show you how to sign the related
transaction.

## Prerequisites

- Node.js installed on your system,
- A MultiversX wallet,
- Guardian must be active on this wallet.

## Code explanations

We start by loading our environment variables:

- `MNEMONIC`: the mnemonic phrase (aka seed phrase) of a wallet.
- `WALLET_INDEX`: the key index to derive from the mnemonic phrase (by default, `0`).
- `NETWORK_NAME`: the name of network we're using (`testnet`, `devnet`, `mainnet`).
- `NETWORK_API`: the base URL of the API we will be using (for example, `https://devnet-api.multiversx.com` for the
  devnet).

```ts
const env = load({
    MNEMONIC: String,
    WALLET_INDEX: Number,
    GUARDIAN_OTP: String,
    NETWORK_NAME: String,
    NETWORK_API: String,
})
```

We initialize the objects representing the wallet:

```ts
// Load mnemonic seed phrase
const mnemonic = Mnemonic.fromString(env.MNEMONIC)
// Derive the seed as a key for the specified index
const walletKey = mnemonic.deriveKey(env.WALLET_INDEX)
// Create a transaction signer
const walletSigner = new UserSigner(walletKey)
// Create an account object representing the state of the wallet
const wallet = new Account(walletSigner.getAddress())
```

We create our network providers for the MultiversX API and the Guardian API:

```ts
// Create a network provider using the MVX API
const provider = new ApiNetworkProvider(env.NETWORK_API)
// Load the selected network configuration
const networkConfig = await provider.getNetworkConfig()
// Create a network provider using Guardian API for the current wallet
const guardianProvider: TCSGuardianProvider | GenericGuardianProvider = await GuardianProviderFactory.createProvider({
    address: wallet.address.bech32(),
    apiAddress: env.NETWORK_API,
    networkId: env.NETWORK_NAME,
})
```

We will also need a transaction factory to easily craft our transaction.

As we want to transfer tokens, we need to use a `TransferTransactionsFactory`.

```ts
// Create transaction factories for a simple EGLD transfer
const factoryConfig = new TransactionsFactoryConfig({
    chainID: networkConfig.ChainID,
})
const factory = new TransferTransactionsFactory({
    config: factoryConfig,
})
```

We update the state of the wallet from the network. This will be important to know the current nonce of the wallet.

```ts
// Load the current status of the wallet from the network (balance, current nonce, etc)
wallet.update(await provider.getAccount(wallet.address))
```

We can now build a new EGLD transfer (EGLD is the native token of MultiversX).

```ts
// Load the current status of the wallet from the network (balance, current nonce, etc)
wallet.update(await provider.getAccount(wallet.address))

// Create a new transaction: send 1 EGLD to ourself (EGLD has 18 decimals)
const transaction = factory.createTransactionForNativeTokenTransfer({
    sender: wallet.address,
    receiver: wallet.address,
    nativeAmount: BigInt(new BigNumber(1).shiftedBy(18).toFixed()),
})

// Add more gas for Guardian
transaction.gasLimit += 50000n
// Set the transaction nonce
transaction.nonce = BigInt(wallet.getNonceThenIncrement().valueOf())
// Prepare the transaction for Guardian
transaction.options = TRANSACTION_OPTIONS_TX_GUARDED
transaction.version = 2
transaction.guardian = guardianProvider.guardianAddress
```

As Guardian uses a one-time password (OTP) as a two-factor authentication mechanism, we need to generate the current 2FA
code.

```ts
// Create a new One-Time Password object with our secret 2FA seed
const otp = new OTP({
    secret: env.GUARDIAN_OTP,
})
// Get the current OTP code
const code = otp.totp(Date.now())
```

It's time to sign our transaction with Guardian!

Note that the Guardian Network Provider expects an array of
transactions, and will also send back an array of signed transactions.

```ts
// Apply the Guardian signature to the transaction
const guardedTransactions = await guardianProvider.applyGuardianSignature(
    [transaction],
    code
)

// Get the first transaction sent
const guardedTransaction = guardedTransactions[0]
// Serialize the transaction
const serializedTx = guardedTransaction.serializeForSigning()
// Sign the final transaction state with the wallet
guardedTransaction.signature = await walletSigner.sign(serializedTx)
```

Finally, everything is ready to be submitted to the blockchain!

```ts
// Broadcast the fully crafted transaction
await provider
    .sendTransaction(guardedTransaction)
    .then((txHash) => {
        console.log('Transaction hash', txHash)
    })
    .catch((reason: ErrNetworkProvider) => {
        console.error(reason.message)
    })
```

At this point, if all has gone well, you should see the transaction hash, which you can search for in the blockchain
explorer.

## Test the demo code

1. Clone this repository
2. Run `npm install`
3. Copy `.env.example` to `.env`
4. Edit `.env` according to your needs and your wallet
5. Run the code with `npm run start`
