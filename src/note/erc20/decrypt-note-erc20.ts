import { ZERO_ADDRESS } from '../../utils/constants';
import { getTokenDataERC20 } from '../note-util';
import { DecryptNote } from '../decrypt-note';

export class DecryptNoteERC20 extends DecryptNote {
  constructor(
    toAddress: string,
    value: bigint,
    tokenAddress: string,
    allowOverride: boolean = false,
  ) {
    const tokenData = getTokenDataERC20(tokenAddress);
    super(toAddress, value, tokenData, allowOverride);
  }

  static empty(): DecryptNote {
    const toAddress = ZERO_ADDRESS;
    const value = BigInt(0);
    const tokenAddress = ZERO_ADDRESS;
    const allowOverride = false;
    return new DecryptNoteERC20(toAddress, value, tokenAddress, allowOverride);
  }
}
