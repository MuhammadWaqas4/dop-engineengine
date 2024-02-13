import { ContractTransaction, AbiCoder, keccak256 } from 'ethers';
import { randomHex, hexToBytes } from '../../utils/bytes';
import { EncryptNoteERC20 } from '../../note/erc20/encrypt-note-erc20';
import { AddressData, decodeAddress } from '../../key-derivation';
import {
  NFTTokenData,
  RelayAdaptEncryptERC20Recipient,
  RelayAdaptEncryptNFTRecipient,
  TokenType,
} from '../../models/formatted-types';
import { EncryptNoteNFT } from '../../note/nft/encrypt-note-nft';
import { ERC721_NOTE_VALUE } from '../../note/note-util';
import { RelayAdapt, EncryptRequestStruct, TransactionStruct } from '../../abi/typechain/RelayAdapt';

class RelayAdaptHelper {
  static async generateRelayEncryptRequests(
    random: string,
    encryptERC20Recipients: RelayAdaptEncryptERC20Recipient[],
    encryptNFTRecipients: RelayAdaptEncryptNFTRecipient[],
  ): Promise<EncryptRequestStruct[]> {
    return Promise.all([
      ...(await RelayAdaptHelper.createRelayEncryptRequestsERC20s(random, encryptERC20Recipients)),
      ...(await RelayAdaptHelper.createRelayEncryptRequestsNFTs(random, encryptNFTRecipients)),
    ]);
  }

  private static async createRelayEncryptRequestsERC20s(
    random: string,
    encryptERC20Recipients: RelayAdaptEncryptERC20Recipient[],
  ): Promise<EncryptRequestStruct[]> {
    return Promise.all(
      encryptERC20Recipients.map(({ tokenAddress, recipientAddress }) => {
        const addressData: AddressData = decodeAddress(recipientAddress);
        const encryptERC20 = new EncryptNoteERC20(
          addressData.masterPublicKey,
          random,
          0n, // 0n will automatically encrypt entire balance.
          tokenAddress,
        );

        // Random private key for Relay Adapt encrypt.
        const encryptPrivateKey = hexToBytes(randomHex(32));

        return encryptERC20.serialize(encryptPrivateKey, addressData.viewingPublicKey);
      }),
    );
  }

  private static async createRelayEncryptRequestsNFTs(
    random: string,
    encryptNFTRecipients: RelayAdaptEncryptNFTRecipient[],
  ): Promise<EncryptRequestStruct[]> {
    return Promise.all(
      encryptNFTRecipients.map(({ nftTokenData, recipientAddress }) => {
        const value = RelayAdaptHelper.valueForNFTEncrypt(nftTokenData);
        const addressData: AddressData = decodeAddress(recipientAddress);
        const encryptNFT = new EncryptNoteNFT(
          addressData.masterPublicKey,
          random,
          value,
          nftTokenData,
        );

        // Random private key for Relay Adapt encrypt.
        const encryptPrivateKey = hexToBytes(randomHex(32));

        return encryptNFT.serialize(encryptPrivateKey, addressData.viewingPublicKey);
      }),
    );
  }

  private static valueForNFTEncrypt(nftTokenData: NFTTokenData): bigint {
    switch (nftTokenData.tokenType) {
      case TokenType.ERC721:
        return ERC721_NOTE_VALUE;
      case TokenType.ERC1155:
        return 0n; // 0n will automatically encrypt entire balance.
    }
    throw new Error('Unhandled NFT token type.');
  }

  /**
   * Format action data field for relay call.
   */
  static getActionData(
    random: string,
    requireSuccess: boolean,
    calls: ContractTransaction[],
    minGasLimit: bigint,
  ): RelayAdapt.ActionDataStruct {
    const formattedRandom = RelayAdaptHelper.formatRandom(random);
    return {
      random: formattedRandom,
      requireSuccess,
      minGasLimit,
      calls: RelayAdaptHelper.formatCalls(calls),
    };
  }

  /**
   * Get relay adapt params hash.
   * Hashes transaction data and params to ensure that transaction is not modified by MITM.
   *
   * @param transactions - serialized transactions
   * @param random - random value
   * @param requireSuccess - require success on calls
   * @param calls - calls list
   * @returns adapt params
   */
  static getRelayAdaptParams(
    transactions: TransactionStruct[],
    random: string,
    requireSuccess: boolean,
    calls: ContractTransaction[],
    minGasLimit = BigInt(0),
  ): string {
    const nullifiers = transactions.map((transaction) => transaction.nullifiers);
    const actionData = RelayAdaptHelper.getActionData(random, requireSuccess, calls, minGasLimit);

    const preimage = AbiCoder.defaultAbiCoder().encode(
      [
        'bytes32[][] nullifiers',
        'uint256 transactionsLength',
        'tuple(bytes31 random, bool requireSuccess, uint256 minGasLimit, tuple(address to, bytes data, uint256 value)[] calls) actionData',
      ],
      [nullifiers, transactions.length, actionData],
    );

    return keccak256(hexToBytes(preimage));
  }

  /**
   * Strips all unnecessary fields from populated transactions
   *
   * @param {object[]} calls - calls list
   * @returns {object[]} formatted calls
   */
  static formatCalls(calls: ContractTransaction[]): RelayAdapt.CallStruct[] {
    return calls.map((call) => ({
      to: call.to || '',
      data: call.data || '',
      value: call.value ?? 0n,
    }));
  }

  static formatRandom(random: string): Uint8Array {
    if (random.length !== 62) {
      throw new Error('Relay Adapt random parameter must be a hex string of length 62 (31 bytes).');
    }
    return hexToBytes(random);
  }
}

export { RelayAdaptHelper };
