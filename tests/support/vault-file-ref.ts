import type { VaultFileRef } from "../../src/vault/gateway";
import { extensionOf } from "../../src/vault/paths";

export function fileRef(path: string): VaultFileRef {
  return { path, vaultPath: path, extension: extensionOf(path), size: 0 };
}
