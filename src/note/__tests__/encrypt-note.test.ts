import { poseidon } from 'circomlibjs';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { randomBytes } from '@noble/hashes/utils';
import {
  ByteLength,
  formatToByteLength,
  hexlify,
  hexToBigInt,
  hexToBytes,
  randomHex,
} from '../../utils/bytes';
import { getPublicViewingKey, getRandomScalar } from '../../utils/keys-utils';
import { config } from '../../test/config.test';
import { TokenType } from '../../models/formatted-types';
import { EncryptNote } from '../encrypt-note';
import { EncryptNoteERC20 } from '../erc20/encrypt-note-erc20';

chai.use(chaiAsPromised);
const { expect } = chai;

const TOKEN_ADDRESS: string = formatToByteLength(config.contracts.rail, ByteLength.Address, true);

let mpk: bigint;
let vpk: Uint8Array;
let encrypt: EncryptNote;

describe('Note/EncryptNote', () => {
  it('Should get expected signature message for encryptPrivateKey', () => {
    expect(EncryptNote.getEncryptPrivateKeySignatureMessage()).to.equal('RAILGUN_SHIELD');
  });

  it('Should create encrypt note', () => {
    mpk = getRandomScalar();
    const rand = randomHex(16);
    encrypt = new EncryptNoteERC20(mpk, rand, 1000n, TOKEN_ADDRESS);
    const { tokenAddress, tokenType, tokenSubID } = encrypt.tokenData;
    expect(tokenAddress).to.equal(TOKEN_ADDRESS);
    expect(tokenType).to.equal(TokenType.ERC20);
    expect(BigInt(tokenSubID)).to.equal(0n);
    const npk: bigint = poseidon([mpk, hexToBigInt(rand)]);
    expect(encrypt.notePublicKey).to.equal(npk);
    expect(encrypt.value).to.equal(1000n);
  });

  it('Should validate length of random parameter', () => {
    const msg = /Random must be length 32.*/;
    mpk = getRandomScalar();
    expect(() => new EncryptNoteERC20(mpk, randomHex(15), 1000n, TOKEN_ADDRESS)).to.throw(msg);
    expect(() => new EncryptNoteERC20(mpk, randomHex(17), 1000n, TOKEN_ADDRESS)).to.throw(msg);
    expect(new EncryptNoteERC20(mpk, randomHex(16), 1000n, TOKEN_ADDRESS)).to.be.an.instanceOf(
      EncryptNote,
    );
  });

  it('Should serialize EncryptNote to preimage and ciphertext', async () => {
    mpk = getRandomScalar();
    vpk = randomBytes(32);
    const viewingPublicKey = await getPublicViewingKey(vpk);
    const rand = randomHex(16);
    encrypt = new EncryptNoteERC20(mpk, rand, 1000n, TOKEN_ADDRESS);
    const encryptPrivateKey = hexToBytes(randomHex(32));
    const { preimage, ciphertext } = await encrypt.serialize(encryptPrivateKey, viewingPublicKey);
    expect(hexlify(await preimage.npk)).length(64);
    expect(preimage.token.tokenAddress).to.equal(TOKEN_ADDRESS);
    expect(preimage.value).to.equal(1000n);
    expect(ciphertext.encryptedBundle).length(3);
  });
});
