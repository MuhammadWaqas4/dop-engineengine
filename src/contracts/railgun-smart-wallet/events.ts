import { Interface } from 'ethers';
import {
  CommitmentCiphertext,
  CommitmentType,
  Nullifier,
  EncryptCommitment,
  TransactCommitment,
} from '../../models/formatted-types';
import { ByteLength, formatToByteLength, nToHex } from '../../utils/bytes';
import EngineDebug from '../../debugger/debugger';
import {
  CommitmentEvent,
  EventsCommitmentListener,
  EventsNullifierListener,
  EventsDecryptListener,
  DecryptStoredEvent,
} from '../../models/event-types';
import {
  CommitmentCiphertextStructOutput,
  CommitmentPreimageStructOutput,
  NullifiedEvent,
  EncryptCiphertextStructOutput,
  EncryptEvent,
  TransactEvent,
  DecryptEvent,
} from '../../abi/typechain/RailgunSmartWallet';
import { serializeTokenData, serializePreImage, getNoteHash } from '../../note/note-util';
import { EncryptEvent as EncryptEvent_LegacyEncrypt_PreMar23 } from '../../abi/typechain/RailgunSmartWallet_Legacy_PreMar23';
import { ABIRailgunSmartWallet_Legacy_PreMar23 } from '../../abi/legacy/abi-legacy';

/**
 * Parse event data for database
 */
export function formatEncryptCommitments(
  transactionHash: string,
  preImages: CommitmentPreimageStructOutput[],
  encryptCiphertext: EncryptCiphertextStructOutput[],
  blockNumber: number,
  fees: Optional<bigint[]>,
): EncryptCommitment[] {
  const encryptCommitments = preImages.map((commitmentPreImage, index) => {
    const npk = formatToByteLength(commitmentPreImage.npk, ByteLength.UINT_256);
    const tokenData = serializeTokenData(
      commitmentPreImage.token.tokenAddress,
      commitmentPreImage.token.tokenType,
      commitmentPreImage.token.tokenSubID.toString(),
    );
    const { value } = commitmentPreImage;
    const preImage = serializePreImage(npk, tokenData, value);
    const noteHash = getNoteHash(npk, tokenData, value);

    const commitment: EncryptCommitment = {
      commitmentType: CommitmentType.EncryptCommitment,
      hash: nToHex(noteHash, ByteLength.UINT_256),
      txid: formatToByteLength(transactionHash, ByteLength.UINT_256),
      timestamp: undefined,
      blockNumber,
      preImage,
      encryptedBundle: encryptCiphertext[index].encryptedBundle,
      encryptKey: encryptCiphertext[index].encryptKey,
      fee: fees && fees[index] ? fees[index].toString() : undefined,
    };
    return commitment;
  });
  return encryptCommitments;
}

export function formatEncryptEvent(
  encryptEventArgs: EncryptEvent.OutputObject | EncryptEvent_LegacyEncrypt_PreMar23.OutputObject,
  transactionHash: string,
  blockNumber: number,
  fees: Optional<bigint[]>,
): CommitmentEvent {
  const { treeNumber, startPosition, commitments, encryptCiphertext } = encryptEventArgs;
  if (
    treeNumber == null ||
    startPosition == null ||
    commitments == null ||
    encryptCiphertext == null
  ) {
    const err = new Error('Invalid EncryptEventArgs');
    EngineDebug.error(err);
    throw err;
  }

  const formattedCommitments = formatEncryptCommitments(
    transactionHash,
    commitments,
    encryptCiphertext,
    blockNumber,
    fees,
  );
  return {
    txid: formatToByteLength(transactionHash, ByteLength.UINT_256),
    treeNumber: Number(treeNumber),
    startPosition: Number(startPosition),
    commitments: formattedCommitments,
    blockNumber,
  };
}

export function formatCommitmentCiphertext(
  commitmentCiphertext: CommitmentCiphertextStructOutput,
): CommitmentCiphertext {
  const { blindedSenderViewingKey, blindedReceiverViewingKey, annotationData, memo } =
    commitmentCiphertext;
  const ciphertext = commitmentCiphertext.ciphertext.map(
    (el) => formatToByteLength(el, ByteLength.UINT_256), // 32 bytes each.
  );
  const ivTag = ciphertext[0];

  return {
    ciphertext: {
      iv: ivTag.substring(0, 32),
      tag: ivTag.substring(32),
      data: ciphertext.slice(1),
    },
    blindedSenderViewingKey: formatToByteLength(blindedSenderViewingKey, ByteLength.UINT_256), // 32 bytes each.
    blindedReceiverViewingKey: formatToByteLength(blindedReceiverViewingKey, ByteLength.UINT_256), // 32 bytes each.
    annotationData,
    memo,
  };
}

export function formatTransactCommitments(
  transactionHash: string,
  hash: string[],
  commitments: CommitmentCiphertextStructOutput[],
  blockNumber: number,
): TransactCommitment[] {
  return commitments.map((commitment, index) => {
    return {
      commitmentType: CommitmentType.TransactCommitment,
      hash: formatToByteLength(hash[index], ByteLength.UINT_256),
      txid: formatToByteLength(transactionHash, ByteLength.UINT_256),
      timestamp: undefined,
      blockNumber,
      ciphertext: formatCommitmentCiphertext(commitment),
    };
  });
}

export function formatTransactEvent(
  transactEventArgs: TransactEvent.OutputObject,
  transactionHash: string,
  blockNumber: number,
): CommitmentEvent {
  const { treeNumber, startPosition, hash, ciphertext } = transactEventArgs;
  if (treeNumber == null || startPosition == null || hash == null || ciphertext == null) {
    const err = new Error('Invalid TransactEventObject');
    EngineDebug.error(err);
    throw err;
  }

  const formattedCommitments = formatTransactCommitments(
    transactionHash,
    hash,
    ciphertext,
    blockNumber,
  );
  return {
    txid: formatToByteLength(transactionHash, ByteLength.UINT_256),
    treeNumber: Number(treeNumber),
    startPosition: Number(startPosition),
    commitments: formattedCommitments,
    blockNumber,
  };
}

export function formatDecryptEvent(
  decryptEventArgs: DecryptEvent.OutputObject,
  transactionHash: string,
  blockNumber: number,
  eventLogIndex: number,
): DecryptStoredEvent {
  const { to, token, amount, fee } = decryptEventArgs;
  return {
    txid: formatToByteLength(transactionHash, ByteLength.UINT_256),
    timestamp: undefined,
    toAddress: to,
    tokenType: Number(token.tokenType),
    tokenAddress: token.tokenAddress,
    tokenSubID: token.tokenSubID.toString(),
    amount: amount.toString(),
    fee: fee.toString(),
    blockNumber,
    eventLogIndex,
  };
}

export async function processEncryptEvents(
  eventsListener: EventsCommitmentListener,
  logs: EncryptEvent.Log[],
): Promise<void> {
  const filtered = logs.filter((log) => log.args);
  if (logs.length !== filtered.length) {
    throw new Error('Args required for Encrypt events');
  }
  await Promise.all(
    filtered.map(async (log) => {
      const { args, transactionHash, blockNumber } = log;
      const { fees } = args;
      return eventsListener(formatEncryptEvent(args, transactionHash, blockNumber, fees));
    }),
  );
}

export async function processEncryptEvents_LegacyEncrypt_PreMar23(
  eventsListener: EventsCommitmentListener,
  logs: EncryptEvent_LegacyEncrypt_PreMar23.Log[],
): Promise<void> {
  // NOTE: Legacy "Encrypt" event of the same name conflicts with the current ABI's Encrypt event.
  // It seems that the first ABI to load, with "Encrypt" event, for a given contract address,
  // sets a cached version of the ABI interface.
  // So, we need to custom-decode the legacy Encrypt event here.

  const iface = new Interface(
    ABIRailgunSmartWallet_Legacy_PreMar23.filter((fragment) => fragment.type === 'event'),
  );
  // eslint-disable-next-line no-restricted-syntax
  for (const log of logs) {
    const args = iface.decodeEventLog('Encrypt', log.data);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    log.args = args as any;
  }

  const filtered = logs.filter((log) => log.args);
  if (logs.length !== filtered.length) {
    throw new Error('Args required for Legacy Encrypt events');
  }

  await Promise.all(
    filtered.map(async (event) => {
      const { args, transactionHash, blockNumber } = event;
      const fees: Optional<bigint[]> = undefined;
      return eventsListener(formatEncryptEvent(args, transactionHash, blockNumber, fees));
    }),
  );
}

export async function processTransactEvents(
  eventsListener: EventsCommitmentListener,
  logs: TransactEvent.Log[],
): Promise<void> {
  const filtered = logs.filter((log) => log.args);
  if (logs.length !== filtered.length) {
    throw new Error('Args required for Transact events');
  }
  await Promise.all(
    filtered.map(async (event) => {
      const { args, transactionHash, blockNumber } = event;
      return eventsListener(formatTransactEvent(args, transactionHash, blockNumber));
    }),
  );
}

export async function processDecryptEvents(
  eventsDecryptListener: EventsDecryptListener,
  logs: DecryptEvent.Log[],
): Promise<void> {
  const decrypts: DecryptStoredEvent[] = [];

  const filtered = logs.filter((log) => log.args);
  if (logs.length !== filtered.length) {
    throw new Error('Args required for Decrypt events');
  }
  filtered.forEach((log) => {
    const { args, transactionHash, blockNumber } = log;
    decrypts.push(formatDecryptEvent(args, transactionHash, blockNumber, log.index));
  });

  await eventsDecryptListener(decrypts);
}

export function formatNullifiedEvents(
  nullifierEventArgs: NullifiedEvent.OutputObject,
  transactionHash: string,
  blockNumber: number,
): Nullifier[] {
  const nullifiers: Nullifier[] = [];

  nullifierEventArgs.nullifier.forEach((nullifier: string) => {
    nullifiers.push({
      txid: formatToByteLength(transactionHash, ByteLength.UINT_256),
      nullifier: formatToByteLength(nullifier, ByteLength.UINT_256),
      treeNumber: Number(nullifierEventArgs.treeNumber),
      blockNumber,
    });
  });

  return nullifiers;
}

export async function processNullifiedEvents(
  eventsNullifierListener: EventsNullifierListener,
  logs: NullifiedEvent.Log[],
): Promise<void> {
  const nullifiers: Nullifier[] = [];

  const filtered = logs.filter((log) => log.args);
  if (logs.length !== filtered.length) {
    throw new Error('Args required for Nullified events');
  }

  filtered.forEach((log) => {
    const { args, transactionHash, blockNumber } = log;
    nullifiers.push(...formatNullifiedEvents(args, transactionHash, blockNumber));
  });

  await eventsNullifierListener(nullifiers);
}
