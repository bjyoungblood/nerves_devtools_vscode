declare module "erlang_js" {
  export class Erlang {
    static _bignum_to_binary(bignum: number | bigint): Buffer;
    static term_to_binary(
      term: any,
      callback: (err: Error | null, result: Buffer) => void,
    ): void;
  }
}
