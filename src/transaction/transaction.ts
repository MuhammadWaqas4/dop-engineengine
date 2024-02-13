import { RailgunWallet } from '../wallet/railgun-wallet';
import { Prover, ProverProgressCallback } from '../prover/prover';
import {
  ByteLength,
  formatToByteLength,
  hexlify,
  hexToBigInt,
  nToHex,
  randomHex,
} from '../utils/bytes';
import { AdaptID, NFTTokenData, OutputType, TokenData, TokenType } from '../models/formatted-types';
import { DecryptFlag } from '../models/transaction-constants';
import { getNoteBlindingKeys, getSharedSymmetricKey } from '../utils/keys-utils';
import { DecryptNote } from '../note/decrypt-note';
import { TXO, DecryptData } from '../models/txo-types';
import { Memo } from '../note/memo';
import { Chain } from '../models/engine-types';
import { TransactNote } from '../note/transact-note';
import {
  UnprovedTransactionInputs,
  Proof,
  PublicInputs,
  RailgunTransactionRequest,
  PrivateInputs,
} from '../models/prover-types';
import {
  BoundParamsStruct,
  CommitmentCiphertextStruct,
  CommitmentPreimageStruct,
  TransactionStruct,
} from '../abi/typechain/RailgunSmartWallet';
import { hashBoundParams } from './bound-params';
import { getChainFullNetworkID } from '../chain/chain';
import { DecryptNoteERC20 } from '../note/erc20/decrypt-note-erc20';
import { DecryptNoteNFT } from '../note/nft/decrypt-note-nft';
import { getTokenDataHash } from '../note';
import { calculateTotalSpend } from '../solutions/utxos';
import { isDefined } from '../utils/is-defined';

class Transaction {
  private readonly adaptID: AdaptID;

  private readonly chain: Chain;

  private readonly tokenOutputs: TransactNote[] = [];

  private decryptNote: DecryptNote = DecryptNoteERC20.empty();

  private decryptFlag: bigint = DecryptFlag.NO_UNSHIELD;

  private readonly tokenData: TokenData;

  private readonly tokenHash: string;

  private readonly spendingTree: number;

  private readonly utxos: TXO[];

  /**
   * Create ERC20Transaction Object
   * @param tokenAddress - token address, unformatted
   * @param tokenType - enum of token type
   * @param chain - chain type/id of network
   * @param spendingTree - tree index to spend from
   * @param utxos - UTXOs to spend from
   */
  constructor(
    chain: Chain,
    tokenData: TokenData,
    spendingTree: number,
    utxos: TXO[],
    tokenOutputs: TransactNote[],
    adaptID: AdaptID,
  ) {
    if (tokenOutputs.length > 4) {
      // Leave room for optional 5th change output.
      throw new Error('Can not add more than 4 outputs.');
    }

    this.chain = chain;
    this.tokenData = tokenData;
    this.tokenHash = getTokenDataHash(tokenData);
    this.spendingTree = spendingTree;
    this.utxos = utxos;
    this.tokenOutputs = tokenOutputs;
    this.adaptID = adaptID;
  }

  addDecryptData(decryptData: DecryptData, decryptValue: bigint) {
    if (this.decryptFlag !== DecryptFlag.NO_UNSHIELD) {
      throw new Error('You may only call .decrypt once for a given transaction.');
    }

    const tokenHashDecrypt = getTokenDataHash(decryptData.tokenData);
    if (tokenHashDecrypt !== this.tokenHash) {
      throw new Error('Decrypt token does not match Transaction token.');
    }

    const { tokenData, allowOverride } = decryptData;
    const { tokenAddress, tokenType, tokenSubID } = tokenData;

    switch (tokenType) {
      case TokenType.ERC20:
        this.decryptNote = new DecryptNoteERC20(
          decryptData.toAddress,
          decryptValue,
          tokenAddress,
          allowOverride,
        );
        break;
      case TokenType.ERC721:
      case TokenType.ERC1155: {
        const nftTokenData: NFTTokenData = {
          tokenAddress,
          tokenType,
          tokenSubID,
        };
        this.decryptNote = new DecryptNoteNFT(
          decryptData.toAddress,
          nftTokenData,
          allowOverride,
        );
        break;
      }
    }

    this.decryptFlag =
      isDefined(allowOverride) && allowOverride ? DecryptFlag.OVERRIDE : DecryptFlag.UNSHIELD;
  }

  get decryptValue() {
    return isDefined(this.decryptNote) ? this.decryptNote.value : BigInt(0);
  }

  /**
   * @param wallet - wallet to spend from
   * @param encryptionKey - encryption key of wallet
   */
  async generateTransactionRequest(
    wallet: RailgunWallet,
    encryptionKey: string,
    overallBatchMinGasPrice = 0n,
  ): Promise<RailgunTransactionRequest> {
    const merkletree = wallet.merkletrees[this.chain.type][this.chain.id];
    const merkleRoot = await merkletree.getRoot(this.spendingTree);
    const spendingKey = await wallet.getSpendingKeyPair(encryptionKey);
    const nullifyingKey = wallet.getNullifyingKey();
    const senderViewingKeys = wallet.getViewingKeyPair();

    if (this.tokenOutputs.length > 4) {
      // Leave room for optional 5th change output.
      // TODO: Support circuits 1x10 and 1x13.
      throw new Error('Cannot create a transaction with >4 non-change outputs.');
    }

    // Get values
    const nullifiers: bigint[] = [];
    const pathElements: bigint[][] = [];
    const pathIndices: bigint[] = [];

    const { utxos } = this;

    for (let i = 0; i < utxos.length; i += 1) {
      // Get UTXO
      const utxo = utxos[i];

      // Push spending key and nullifier
      nullifiers.push(TransactNote.getNullifier(nullifyingKey, utxo.position));

      // Push path elements
      // eslint-disable-next-line no-await-in-loop
      const merkleProof = await merkletree.getMerkleProof(this.spendingTree, utxo.position);
      pathElements.push(merkleProof.elements.map((element) => hexToBigInt(element)));

      // Push path indices
      pathIndices.push(BigInt(utxo.position));
    }

    const allOutputs: (TransactNote | DecryptNote)[] = [...this.tokenOutputs];

    const totalIn = calculateTotalSpend(utxos);
    const totalOutputNoteValues = TransactNote.calculateTotalNoteValues(this.tokenOutputs);
    const totalOut = totalOutputNoteValues + this.decryptValue;

    const change = totalIn - totalOut;
    if (change < 0n) {
      throw new Error('Negative change value - transaction not possible.');
    }

    const requiresChangeOutput = change > 0n;
    if (requiresChangeOutput) {
      // Add change output
      allOutputs.push(
        TransactNote.createTransfer(
          wallet.addressKeys, // Receiver
          wallet.addressKeys, // Sender
          randomHex(16),
          change,
          this.tokenData,
          senderViewingKeys,
          true, // showSenderAddressToRecipient
          OutputType.Change,
          undefined, // memoText
        ),
      );
    }

    // Push decrypt output if decrypt is requested
    const hasDecrypt =
      this.decryptFlag !== DecryptFlag.NO_UNSHIELD && isDefined(this.decryptNote);
    if (hasDecrypt) {
      allOutputs.push(this.decryptNote);
    }

    const onlyInternalOutputs = allOutputs.filter(
      (note) => note instanceof TransactNote,
    ) as TransactNote[];

    const viewingPrivateKey = wallet.getViewingKeyPair().privateKey;

    const noteBlindedKeys = await Promise.all(
      onlyInternalOutputs.map((note) => {
        const senderRandom = Memo.decryptSenderRandom(note.annotationData, viewingPrivateKey);
        return getNoteBlindingKeys(
          senderViewingKeys.pubkey,
          note.receiverAddressData.viewingPublicKey,
          note.random,
          senderRandom,
        );
      }),
    );

    // Calculate shared keys using sender privateKey and recipient blinding key.
    const sharedKeys = await Promise.all(
      noteBlindedKeys.map(({ blindedReceiverViewingKey }) =>
        getSharedSymmetricKey(senderViewingKeys.privateKey, blindedReceiverViewingKey),
      ),
    );

    const commitmentCiphertext: CommitmentCiphertextStruct[] = onlyInternalOutputs.map(
      (note, index) => {
        const sharedKey = sharedKeys[index];
        if (!sharedKey) {
          throw new Error('Shared symmetric key is not defined.');
        }

        const senderRandom = Memo.decryptSenderRandom(note.annotationData, viewingPrivateKey);
        const { noteCiphertext, noteMemo } = note.encrypt(
          sharedKey,
          wallet.addressKeys.masterPublicKey,
          senderRandom,
        );
        if (noteCiphertext.data.length !== 3) {
          throw new Error('Note ciphertext data must have length 3.');
        }
        const ciphertext: [string, string, string, string] = [
          hexlify(`${noteCiphertext.iv}${noteCiphertext.tag}`, true),
          hexlify(noteCiphertext.data[0], true),
          hexlify(noteCiphertext.data[1], true),
          hexlify(noteCiphertext.data[2], true),
        ];
        return {
          ciphertext,
          blindedSenderViewingKey: hexlify(noteBlindedKeys[index].blindedSenderViewingKey, true),
          blindedReceiverViewingKey: hexlify(
            noteBlindedKeys[index].blindedReceiverViewingKey,
            true,
          ),
          memo: hexlify(noteMemo, true),
          annotationData: hexlify(note.annotationData, true),
        };
      },
    );

    const boundParams: BoundParamsStruct = {
      treeNumber: this.spendingTree,
      minGasPrice: overallBatchMinGasPrice,
      decrypt: this.decryptFlag,
      chainID: hexlify(getChainFullNetworkID(this.chain), true),
      adaptContract: this.adaptID.contract,
      adaptParams: this.adaptID.parameters,
      commitmentCiphertext,
    };

    const publicInputs: PublicInputs = {
      merkleRoot: hexToBigInt(merkleRoot),
      boundParamsHash: hashBoundParams(boundParams),
      nullifiers,
      commitmentsOut: allOutputs.map((note) => note.hash),
    };

    const privateInputs: PrivateInputs = {
      tokenAddress: hexToBigInt(this.tokenHash),
      randomIn: utxos.map((utxo) => hexToBigInt(utxo.note.random)),
      valueIn: utxos.map((utxo) => utxo.note.value),
      pathElements,
      leavesIndices: pathIndices,
      valueOut: allOutputs.map((note) => note.value),
      publicKey: spendingKey.pubkey,
      npkOut: allOutputs.map((x) => x.notePublicKey),
      nullifyingKey,
    };

    const railgunTransactionRequest: RailgunTransactionRequest = {
      privateInputs,
      publicInputs,
      boundParams,
    };

    return railgunTransactionRequest;
  }

  /**
   * Generate proof and return serialized transaction
   * @param prover - prover to use
   * @param wallet - wallet to spend from
   * @param encryptionKey - encryption key for wallet
   * @returns serialized transaction
   */
  async generateProvedTransaction(
    prover: Prover,
    unprovedTransactionInputs: UnprovedTransactionInputs,
    progressCallback: ProverProgressCallback,
  ): Promise<TransactionStruct> {
    const { publicInputs, privateInputs, boundParams } = unprovedTransactionInputs;

    Transaction.assertCanProve(privateInputs);

    const { proof } = await prover.prove(unprovedTransactionInputs, progressCallback);

    return Transaction.createTransactionStruct(
      proof,
      publicInputs,
      boundParams,
      this.decryptNote.preImage,
    );
  }

  /**
   * Return serialized transaction with zero'd proof for gas estimates.
   * @param wallet - wallet to spend from
   * @param encryptionKey - encryption key for wallet
   * @returns serialized transaction
   */
  async generateDummyProvedTransaction(
    prover: Prover,
    transactionRequest: RailgunTransactionRequest,
  ): Promise<TransactionStruct> {
    const { publicInputs, boundParams } = transactionRequest;

    const dummyProof: Proof = prover.dummyProve(publicInputs);

    return Transaction.createTransactionStruct(
      dummyProof,
      publicInputs,
      boundParams,
      this.decryptNote.preImage,
    );
  }

  private static assertCanProve(privateInputs: PrivateInputs) {
    if (
      privateInputs.valueIn.length === 1 &&
      privateInputs.valueOut.length === 1 &&
      privateInputs.valueIn[0] === 0n &&
      privateInputs.valueOut[0] === 0n
    ) {
      throw new Error('Cannot prove transaction with null (zero value) inputs and outputs.');
    }
  }

  private static createTransactionStruct(
    proof: Proof,
    publicInputs: PublicInputs,
    boundParams: BoundParamsStruct,
    decryptPreimage: CommitmentPreimageStruct,
  ): TransactionStruct {
    return {
      proof: Prover.formatProof(proof),
      merkleRoot: nToHex(publicInputs.merkleRoot, ByteLength.UINT_256, true),
      nullifiers: publicInputs.nullifiers.map((n) => nToHex(n, ByteLength.UINT_256, true)),
      boundParams,
      commitments: publicInputs.commitmentsOut.map((n) => nToHex(n, ByteLength.UINT_256, true)),
      decryptPreimage: {
        npk: formatToByteLength(decryptPreimage.npk, ByteLength.UINT_256, true),
        token: decryptPreimage.token,
        value: decryptPreimage.value,
      },
    };
  }
}

export { Transaction };
