import { getTokenDataERC20 } from '../note-util';
import { EncryptNote } from '../encrypt-note';

export class EncryptNoteERC20 extends EncryptNote {
  constructor(masterPublicKey: bigint, random: string, value: bigint, tokenAddress: string) {
    const tokenData = getTokenDataERC20(tokenAddress);
    super(masterPublicKey, random, value, tokenData);
  }
}
