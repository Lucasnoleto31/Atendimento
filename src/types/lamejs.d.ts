declare module "lamejs" {
  export class Mp3Encoder {
    constructor(canais: number, taxaAmostragem: number, kbps: number);
    encodeBuffer(esquerda: Int16Array, direita?: Int16Array): Int8Array;
    flush(): Int8Array;
  }
  const lamejs: { Mp3Encoder: typeof Mp3Encoder };
  export default lamejs;
}
