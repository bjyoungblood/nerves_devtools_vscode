import { createHmac, pbkdf2 } from "crypto";
import { promisify } from "util";
import { Erlang } from "erlang_js";

const termToBinary = promisify(Erlang.term_to_binary);
const pbkdf2Async = promisify(pbkdf2);

const TAG_SMALL_BIG_EXT = 110;
const TAG_LARGE_BIG_EXT = 111;

// Patch bignum encoding to use BigInt
Erlang._bignum_to_binary = function _bignum_to_binary(term: number) {
  let bignum = BigInt(Math.abs(term));
  let sign;
  if (term < 0) {
    sign = 1;
  } else {
    sign = 0;
  }
  const buffers = [];
  while (bignum > 0) {
    const b = Buffer.alloc(1);
    b.writeUInt8(Number(BigInt.asUintN(8, bignum)), 0);
    buffers.push(b);
    bignum >>= 8n;
  }
  const length = buffers.length;
  if (length <= 255) {
    const header = Buffer.alloc(3);
    header.writeUint8(TAG_SMALL_BIG_EXT, 0);
    header.writeUint8(length, 1);
    header.writeUint8(sign, 2);
    buffers.unshift(header);
    return Buffer.concat(buffers);
  } else if (length <= 4294967295) {
    const header = Buffer.alloc(6);
    header.writeUInt8(TAG_LARGE_BIG_EXT, 0);
    header.writeUInt32BE(length, 1);
    header.writeUInt8(sign, 5);
    buffers.unshift(header);
    return Buffer.concat(buffers);
  } else {
    throw new Error("uint32 overflow");
  }
};

const sha256 = "SFMyNTY";
const sha384 = "SFMzODQ";
const sha512 = "SFM1MTI";

type Digest = "sha256" | "sha384" | "sha512";

function digestToProtected(digest: Digest): string {
  switch (digest) {
    case "sha256":
      return sha256;
    case "sha384":
      return sha384;
    case "sha512":
      return sha512;
  }
}

interface SignOpts {
  keylen?: number;
  iterations?: number;
}

export async function sign(
  secret: string,
  salt: string,
  payload: string,
  digestType: Digest,
  { keylen = 32, iterations = 1000 }: SignOpts = {},
): Promise<string> {
  const hmacKey = await pbkdf2Async(
    secret,
    salt,
    iterations,
    keylen,
    digestType,
  );

  const termBinary = await termToBinary([payload, Date.now(), 86400]);
  const plaintext = `${digestToProtected(digestType)}.${termBinary.toString(
    "base64url",
  )}`;

  const hmac = createHmac(digestType, hmacKey);
  const signature = hmac.update(plaintext).digest("base64url");

  return `${plaintext}.${signature}`;
}
