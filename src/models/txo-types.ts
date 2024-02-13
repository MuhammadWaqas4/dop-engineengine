import { TransactNote } from '../note/transact-note';
import { NoteAnnotationData, TokenData } from './formatted-types';

export type TXO = {
  tree: number;
  position: number;
  txid: string;
  timestamp: Optional<number>;
  spendtxid: string | false;
  note: TransactNote;
};

export type SentCommitment = {
  tree: number;
  position: number;
  txid: string;
  timestamp: Optional<number>;
  note: TransactNote;
  noteAnnotationData?: NoteAnnotationData;
  isLegacyTransactNote: boolean;
};

export type SpendingSolutionGroup = {
  utxos: TXO[];
  spendingTree: number;
  tokenOutputs: TransactNote[];
  decryptValue: bigint;
  tokenData: TokenData;
};

export type DecryptData = {
  toAddress: string;
  value: bigint;
  tokenData: TokenData;
  allowOverride?: boolean;
};
