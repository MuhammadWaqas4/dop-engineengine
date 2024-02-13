import { NFTTokenData } from '../../models/formatted-types';
import { EncryptNote } from '../encrypt-note';

export class EncryptNoteNFT extends EncryptNote {
  constructor(masterPublicKey: bigint, random: string, value: bigint, tokenData: NFTTokenData) {
    super(masterPublicKey, random, value, tokenData);
  }
}
