declare module 'blake-hash/js.js' {
  const createHash: (alg: 'blake512' | 'blake256' | 'blake384' | 'blake224') => {
    update(data: unknown): { digest(): Uint8Array };
  };
  export default createHash;
}
