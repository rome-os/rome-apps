export const MAX_TITLE_LENGTH = 20;

export function calcTitleLength(value: string): number {
  let weightedLength = 0;
  const encoded = Buffer.from(value, "utf16le");
  for (let index = 0; index < encoded.length; index += 2) {
    const codeUnit = encoded.readUInt16LE(index);
    weightedLength += codeUnit > 127 ? 2 : 1;
  }
  return Math.ceil(weightedLength / 2);
}
