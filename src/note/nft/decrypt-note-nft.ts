import { NFTTokenData } from '../../models';
import { ERC721_NOTE_VALUE } from '../note-util';
import { DecryptNote } from '../decrypt-note';

export class DecryptNoteNFT extends DecryptNote {
  constructor(toAddress: string, tokenData: NFTTokenData, allowOverride: boolean = false) {
    super(toAddress, ERC721_NOTE_VALUE, tokenData, allowOverride);
  }
}
