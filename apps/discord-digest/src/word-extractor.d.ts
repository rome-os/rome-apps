declare module "word-extractor" {
  interface WordDocument {
    getBody(): string;
    getFootnotes(): string;
    getHeaders(): string;
  }

  export default class WordExtractor {
    extract(source: string | Buffer): Promise<WordDocument>;
  }
}
