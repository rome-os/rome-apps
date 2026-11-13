/** Discard responses from an older poll, before a manual intent, or another chat mount. */
export class SelectionGate {
  revision = -1;
  intent = 0;
  pending = 0;
  beginManual() {
    this.intent++;
    this.pending++;
  }
  finishManual(revision?: number) {
    this.pending--;
    if (revision !== undefined)
      this.revision = Math.max(this.revision, revision);
  }
  accept(revision: number, intent: number) {
    if (this.pending || intent !== this.intent || revision <= this.revision)
      return false;
    this.revision = revision;
    return true;
  }
}
