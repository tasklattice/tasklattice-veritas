declare module 'lzma-native' {
  export function decompress(input: Buffer, callback: (result: Buffer | false, error?: Error) => void): void;
}
