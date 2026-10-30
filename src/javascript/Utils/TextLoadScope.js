import { FontLoader } from "three/examples/jsm/loaders/FontLoader.js";

export default class TextLoadScope {
  constructor(loader = new FontLoader()) {
    this.loader = loader;
    this.pending = new Map();
    this.fonts = new Map();
    this.nextId = 0;
    this.disposed = false;
  }

  get pendingCount() { return this.pending.size; }

  load(url, callback) {
    if (this.disposed) return;
    const id = ++this.nextId;
    this.pending.set(id, callback);
    let promise = this.fonts.get(url);
    if (!promise) {
      promise = new Promise((resolve, reject) => this.loader.load(url, resolve, undefined, reject));
      this.fonts.set(url, promise);
      // Bound retained parsed fonts even if callers use dynamically changing URLs.
      if (this.fonts.size > 16) this.fonts.delete(this.fonts.keys().next().value);
    }
    promise.then(font => {
      const build = this.pending.get(id);
      this.pending.delete(id);
      if (build && !this.disposed) build(font);
    }).catch(error => {
      const wasActive = this.pending.delete(id);
      if (this.fonts.get(url) === promise) this.fonts.delete(url);
      if (wasActive && !this.disposed) console.warn("Blazor3D text load failed.", error);
    });
  }

  clear() { this.pending.clear(); }
  dispose() {
    this.disposed = true;
    this.clear();
    this.fonts.clear();
    this.loader = null;
  }
}
