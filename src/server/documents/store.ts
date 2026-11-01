// Where uploaded document files live. Local disk by default (DOCUMENT_STORAGE_DIR); the interface is
// small so an S3-compatible store can replace it later without touching the services.

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export interface DocumentStore {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
}

/** Keys are generated here, never from user input: "<circle uuid>/<random uuid>". */
export function newStorageKey(circleId: string): string {
  return `${circleId}/${randomUUID()}`;
}

const KEY = /^[0-9a-f-]{36}\/[0-9a-f-]{36}$/;

class LocalDiskStore implements DocumentStore {
  constructor(private root: string) {}
  private file(key: string) {
    // Belt and braces: keys are ours, but never let one reach outside the storage folder.
    if (!KEY.test(key)) throw new Error("Invalid storage key");
    return path.join(this.root, ...key.split("/"));
  }
  async put(key: string, bytes: Uint8Array) {
    const file = this.file(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes, { flag: "wx", mode: 0o600 });
  }
  async get(key: string) {
    try {
      return new Uint8Array(await readFile(this.file(key)));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }
  async delete(key: string) {
    await rm(this.file(key), { force: true });
  }
}

let override: DocumentStore | undefined;
let cached: DocumentStore | undefined;

export function getDocumentStore(): DocumentStore {
  if (override) return override;
  cached ??= new LocalDiskStore(path.resolve(process.env.DOCUMENT_STORAGE_DIR ?? ".data/documents"));
  return cached;
}

export function setDocumentStoreForTesting(store: DocumentStore | undefined) {
  override = store;
}
