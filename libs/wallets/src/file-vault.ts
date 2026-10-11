import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt, type ScryptOptions } from "node:crypto";
import { promises as fs } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import type { Hex } from "viem";
import type { SessionKeyVault } from "./store.js";

// A SessionKeyVault on the local filesystem, encrypted at rest, for Monad testnet and local development only
// (SECURITY.md section 11). It is not a secrets manager: whoever holds the passphrase and the files holds the keys.
// `loadFileVaults` refuses it with MONADEUM_ENV=production.

export class FileVaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileVaultError";
  }
}

/**
 * What a vault holds. Written into the vault's header and into every key's associated data, so a session-key vault
 * cannot be opened as the x402 vault, and a key file copied between vaults or between agents fails to decrypt.
 */
export type VaultPurpose = "session" | "x402";

/** scrypt cost parameters. N must be a power of two. */
export interface ScryptParams {
  N: number;
  r: number;
  p: number;
}

/**
 * N = 2^17, r = 8, p = 1: the OWASP Password Storage Cheat Sheet's scrypt recommendation (128 MiB, about a few hundred
 * milliseconds once per process start). Tests pass cheaper parameters; a vault always opens with the parameters its
 * header records.
 */
export const DEFAULT_SCRYPT: ScryptParams = { N: 2 ** 17, r: 8, p: 1 };

/** Passphrases shorter than this are refused. */
export const MIN_PASSPHRASE_LENGTH = 16;

const FORMAT = "monadeum-file-vault";
const VERSION = 1;
const HEADER = "vault.json";
const KEY_SUFFIX = ".key";
const CHECK_PLAINTEXT = Buffer.from("monadeum-file-vault-check", "utf8");
const IV_BYTES = 12;
const TAG_BYTES = 16;
const SALT_BYTES = 16;
const KEY_BYTES = 32;

interface Sealed {
  iv: string;
  tag: string;
  ct: string;
}

interface Header {
  format: typeof FORMAT;
  version: typeof VERSION;
  purpose: VaultPurpose;
  kdf: { name: "scrypt"; N: number; r: number; p: number; salt: string };
  check: Sealed;
}

interface KeyFile {
  format: typeof FORMAT;
  version: typeof VERSION;
  sealed: Sealed;
}

export interface FileVaultOptions {
  /** The vault's directory. Created with mode 0700 when absent; refused when group or others can access it. */
  directory: string;
  passphrase: string;
  purpose: VaultPurpose;
  /** Used only when the vault is created. Default `DEFAULT_SCRYPT`. */
  scrypt?: ScryptParams;
}

const isErrno = (error: unknown, code: string) => error instanceof Error && (error as NodeJS.ErrnoException).code === code;

function deriveKey(passphrase: string, salt: Buffer, params: ScryptParams): Promise<Buffer> {
  const options: ScryptOptions = { N: params.N, r: params.r, p: params.p, maxmem: 256 * params.N * params.r + 32 * 1024 * 1024 };
  return new Promise((resolve, reject) => scrypt(passphrase.normalize("NFC"), salt, KEY_BYTES, options, (error, key) => (error ? reject(error) : resolve(key))));
}

function seal(key: Buffer, plaintext: Buffer, aad: string): Sealed {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { iv: iv.toString("hex"), tag: cipher.getAuthTag().toString("hex"), ct: ct.toString("hex") };
}

/** Throws on a wrong key, wrong associated data, or any modified byte. */
function open(key: Buffer, sealed: Sealed, aad: string): Buffer {
  const iv = Buffer.from(sealed.iv, "hex");
  const tag = Buffer.from(sealed.tag, "hex");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new Error("malformed");
  const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(Buffer.from(sealed.ct, "hex")), decipher.final()]);
}

const checkAad = (purpose: VaultPurpose) => `${FORMAT}:v${VERSION}:check:${purpose}`;
const keyAad = (purpose: VaultPurpose, agentId: string) => `${FORMAT}:v${VERSION}:key:${purpose}:${agentId}`;

async function syncDirectory(directory: string) {
  // Makes a rename, link, or unlink durable. Some platforms refuse fsync on a directory; the write itself is still atomic.
  let handle: FileHandle | undefined;
  try {
    handle = await fs.open(directory, "r");
    await handle.sync();
  } catch (error) {
    if (!isErrno(error, "EINVAL") && !isErrno(error, "EISDIR") && !isErrno(error, "EPERM") && !isErrno(error, "EBADF")) throw error;
  } finally {
    await handle?.close();
  }
}

/**
 * Writes `content` to `target` only if `target` does not exist, atomically: the content is written and synced to a
 * temporary file with mode 0600, then hard-linked to the target name, which fails if the name is taken. A reader never
 * sees a partial file, and two writers cannot both succeed. Returns false when the target already existed.
 */
async function createExclusive(directory: string, target: string, content: string): Promise<boolean> {
  const temporary = path.join(directory, `.tmp-${randomBytes(8).toString("hex")}`);
  const handle = await fs.open(temporary, "wx", 0o600);
  try {
    await handle.chmod(0o600);
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fs.link(temporary, path.join(directory, target));
    return true;
  } catch (error) {
    if (isErrno(error, "EEXIST")) return false;
    throw error;
  } finally {
    await fs.unlink(temporary);
    await syncDirectory(directory);
  }
}

function parseHeader(raw: string, directory: string): Header {
  let header: Header;
  try {
    header = JSON.parse(raw) as Header;
  } catch {
    throw new FileVaultError(`${directory}/${HEADER} is not valid JSON`);
  }
  const k = header?.kdf;
  const valid =
    header?.format === FORMAT &&
    header.version === VERSION &&
    (header.purpose === "session" || header.purpose === "x402") &&
    k?.name === "scrypt" &&
    Number.isSafeInteger(k.N) && k.N > 1 && (k.N & (k.N - 1)) === 0 &&
    Number.isSafeInteger(k.r) && k.r > 0 &&
    Number.isSafeInteger(k.p) && k.p > 0 &&
    typeof k.salt === "string" && /^[0-9a-f]{32,}$/.test(k.salt) &&
    typeof header.check?.ct === "string";
  if (!valid) throw new FileVaultError(`${directory}/${HEADER} is not a ${FORMAT} version ${VERSION} header`);
  return header;
}

/**
 * Session or x402 private keys, one file per agent, each sealed with AES-256-GCM under a key derived from a passphrase
 * with scrypt (both from Node's `crypto`). The vault's directory holds `vault.json` (the scrypt salt and parameters,
 * and a sealed check value that tells a wrong passphrase apart at open) and one `<sha256(agentId)>.key` per key, every
 * file mode 0600 in a directory of mode 0700. Each key is sealed with a fresh 96-bit IV and with the vault's purpose and
 * the agent ID as associated data.
 *
 * Writes are atomic and create-only (a temporary file, synced, then hard-linked into place), so the API and the worker
 * can share one directory: `put` refuses an agent that already has a key, as `MemorySessionKeyVault` does, and
 * `destroy` unlinks the file. Destroying makes the key unrecoverable from this vault, not from a backup of it or from the
 * storage underneath: revocation is completed on chain (WalletsService.revokeSessionKey), never by deletion alone.
 *
 * No method logs, and no error message includes, a key or the passphrase.
 */
export class FileSessionKeyVault implements SessionKeyVault {
  private constructor(
    readonly directory: string,
    readonly purpose: VaultPurpose,
    private readonly key: Buffer,
  ) {}

  /** Opens the vault in `directory`, creating it when absent. Refuses a wrong passphrase or a vault of another purpose. */
  static async open(options: FileVaultOptions): Promise<FileSessionKeyVault> {
    if (options.passphrase.length < MIN_PASSPHRASE_LENGTH) throw new FileVaultError(`the vault passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters`);
    const directory = path.resolve(options.directory);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const stat = await fs.stat(directory);
    if (!stat.isDirectory()) throw new FileVaultError(`${directory} is not a directory`);
    if ((stat.mode & 0o077) !== 0) throw new FileVaultError(`${directory} is accessible by group or others (mode ${(stat.mode & 0o777).toString(8)}); it must be 0700`);
    if (typeof process.getuid === "function" && stat.uid !== process.getuid()) throw new FileVaultError(`${directory} is not owned by this process's user`);

    let raw: string;
    try {
      raw = await fs.readFile(path.join(directory, HEADER), "utf8");
    } catch (error) {
      if (!isErrno(error, "ENOENT")) throw error;
      const params = options.scrypt ?? DEFAULT_SCRYPT;
      const salt = randomBytes(SALT_BYTES);
      const key = await deriveKey(options.passphrase, salt, params);
      const header: Header = {
        format: FORMAT,
        version: VERSION,
        purpose: options.purpose,
        kdf: { name: "scrypt", ...params, salt: salt.toString("hex") },
        check: seal(key, CHECK_PLAINTEXT, checkAad(options.purpose)),
      };
      // Another process may create the header at the same time; then the one that won is read back below.
      if (await createExclusive(directory, HEADER, `${JSON.stringify(header, null, 2)}\n`)) return new FileSessionKeyVault(directory, options.purpose, key);
      key.fill(0);
      raw = await fs.readFile(path.join(directory, HEADER), "utf8");
    }
    const header = parseHeader(raw, directory);
    if (header.purpose !== options.purpose) throw new FileVaultError(`${directory} is a ${header.purpose} vault, not a ${options.purpose} vault`);
    const key = await deriveKey(options.passphrase, Buffer.from(header.kdf.salt, "hex"), header.kdf);
    let check: Buffer;
    try {
      check = open(key, header.check, checkAad(options.purpose));
    } catch {
      key.fill(0);
      throw new FileVaultError(`the passphrase does not open the ${options.purpose} vault in ${directory}`);
    }
    if (!check.equals(CHECK_PLAINTEXT)) {
      key.fill(0);
      throw new FileVaultError(`the passphrase does not open the ${options.purpose} vault in ${directory}`);
    }
    return new FileSessionKeyVault(directory, options.purpose, key);
  }

  private fileName(agentId: string) {
    if (agentId.length === 0) throw new FileVaultError("agent ID is empty");
    return `${createHash("sha256").update(agentId, "utf8").digest("hex")}${KEY_SUFFIX}`;
  }

  async put(agentId: string, privateKey: Hex): Promise<void> {
    if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) throw new FileVaultError("not a 32-byte private key");
    const plaintext = Buffer.from(privateKey.slice(2), "hex");
    try {
      const file: KeyFile = { format: FORMAT, version: VERSION, sealed: seal(this.key, plaintext, keyAad(this.purpose, agentId)) };
      const created = await createExclusive(this.directory, this.fileName(agentId), `${JSON.stringify(file)}\n`);
      if (!created) throw new FileVaultError(`a ${this.purpose} key is already held for ${agentId}`);
    } finally {
      plaintext.fill(0);
    }
  }

  async get(agentId: string): Promise<Hex | null> {
    let raw: string;
    try {
      raw = await fs.readFile(path.join(this.directory, this.fileName(agentId)), "utf8");
    } catch (error) {
      if (isErrno(error, "ENOENT")) return null;
      throw error;
    }
    let plaintext: Buffer;
    try {
      const file = JSON.parse(raw) as KeyFile;
      if (file?.format !== FORMAT || file.version !== VERSION) throw new Error("format");
      plaintext = open(this.key, file.sealed, keyAad(this.purpose, agentId));
    } catch {
      // Fails closed: a damaged or foreign file is an error, never read as "no key".
      throw new FileVaultError(`the ${this.purpose} key file for ${agentId} does not decrypt in this vault`);
    }
    if (plaintext.length !== KEY_BYTES) throw new FileVaultError(`the ${this.purpose} key file for ${agentId} does not hold a 32-byte key`);
    const hex = `0x${plaintext.toString("hex")}` as Hex;
    plaintext.fill(0);
    return hex;
  }

  async destroy(agentId: string): Promise<void> {
    try {
      await fs.unlink(path.join(this.directory, this.fileName(agentId)));
    } catch (error) {
      if (isErrno(error, "ENOENT")) return;
      throw error;
    }
    await syncDirectory(this.directory);
  }

  /** Overwrites the derived key in memory. The vault cannot be used afterwards. */
  close() {
    this.key.fill(0);
  }
}

type Env = Record<string, string | undefined>;

/** The two vaults a process holds: session keys, and x402 keys when configured. Always different directories. */
export interface FileVaults {
  session: FileSessionKeyVault;
  x402: FileSessionKeyVault | null;
}

async function passphrase(env: Env, prefix: string): Promise<string> {
  const direct = env[`${prefix}_PASSPHRASE`];
  const file = env[`${prefix}_PASSPHRASE_FILE`]?.trim();
  if (direct && file) throw new FileVaultError(`set ${prefix}_PASSPHRASE or ${prefix}_PASSPHRASE_FILE, not both`);
  if (file) {
    // A trailing newline from `echo` or an editor is not part of the passphrase.
    return (await fs.readFile(file, "utf8")).replace(/\r?\n$/, "");
  }
  if (direct) return direct;
  throw new FileVaultError(`${prefix}_PASSPHRASE or ${prefix}_PASSPHRASE_FILE is not set`);
}

const inside = (parent: string, child: string) => {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

/**
 * Opens the local encrypted vaults named by the environment, or returns null when `WALLETS_SESSION_VAULT_DIR` is unset.
 *
 * - `WALLETS_SESSION_VAULT_DIR`, with `WALLETS_SESSION_VAULT_PASSPHRASE` or `WALLETS_SESSION_VAULT_PASSPHRASE_FILE`.
 * - `WALLETS_X402_VAULT_DIR`, with `WALLETS_X402_VAULT_PASSPHRASE` or `WALLETS_X402_VAULT_PASSPHRASE_FILE`: optional;
 *   required by the caller when x402 is configured. It must not be the session directory or inside it, or contain it.
 *
 * Refuses to open anything with `MONADEUM_ENV=production`: a production deployment needs a secrets manager behind
 * `SessionKeyVault` (SECURITY.md section 11), which this is not.
 */
export async function loadFileVaults(env: Env, options: { scrypt?: ScryptParams } = {}): Promise<FileVaults | null> {
  const sessionDir = env.WALLETS_SESSION_VAULT_DIR?.trim();
  const x402Dir = env.WALLETS_X402_VAULT_DIR?.trim();
  if (!sessionDir && !x402Dir) return null;
  if ((env.MONADEUM_ENV?.trim() || "development") === "production") {
    throw new FileVaultError("MONADEUM_ENV is production: the local file vault is for testnet and local development only; production needs a secrets manager");
  }
  if (!sessionDir) throw new FileVaultError("WALLETS_X402_VAULT_DIR is set but WALLETS_SESSION_VAULT_DIR is not");
  if (x402Dir) {
    const a = path.resolve(sessionDir);
    const b = path.resolve(x402Dir);
    if (inside(a, b) || inside(b, a)) throw new FileVaultError("WALLETS_X402_VAULT_DIR must be a separate directory from WALLETS_SESSION_VAULT_DIR, neither inside the other");
  }
  const session = await FileSessionKeyVault.open({ directory: sessionDir, passphrase: await passphrase(env, "WALLETS_SESSION_VAULT"), purpose: "session", scrypt: options.scrypt });
  try {
    const x402 = x402Dir
      ? await FileSessionKeyVault.open({ directory: x402Dir, passphrase: await passphrase(env, "WALLETS_X402_VAULT"), purpose: "x402", scrypt: options.scrypt })
      : null;
    return { session, x402 };
  } catch (error) {
    session.close();
    throw error;
  }
}
