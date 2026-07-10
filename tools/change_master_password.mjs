#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { webcrypto } from "node:crypto";

const crypto = webcrypto;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

function base64ToBytes(value) {
  return new Uint8Array(Buffer.from(value, "base64"));
}

function makeSalt(length = 16) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

async function deriveMasterKey(masterPassword, kdf) {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(masterPassword),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: kdf.hash || "SHA-256",
      salt: base64ToBytes(kdf.salt),
      iterations: Number(kdf.iterations),
    },
    baseKey,
    256
  );

  return new Uint8Array(bits);
}

async function importAesKey(aesBytes, usages = ["encrypt", "decrypt"]) {
  return crypto.subtle.importKey("raw", aesBytes, "AES-GCM", false, usages);
}

async function encryptBytes(bytes, aesBytes) {
  const iv = makeSalt(12);
  const key = await importAesKey(aesBytes, ["encrypt"]);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes);
  return {
    iv: bytesToBase64(iv),
    bytes: new Uint8Array(ciphertext),
  };
}

async function decryptBytes(record, aesBytes) {
  const key = await importAesKey(aesBytes, ["decrypt"]);
  const ciphertext = record.bytes || base64ToBytes(record.ciphertext);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(record.iv) },
    key,
    ciphertext
  );
  return new Uint8Array(decrypted);
}

async function encryptJson(payload, aesBytes) {
  const encrypted = await encryptBytes(encoder.encode(JSON.stringify(payload)), aesBytes);
  return {
    iv: encrypted.iv,
    ciphertext: bytesToBase64(encrypted.bytes),
  };
}

async function decryptJson(record, aesBytes) {
  const bytes = await decryptBytes(record, aesBytes);
  return JSON.parse(decoder.decode(bytes));
}

async function validateMasterPassword(masterPassword, manifest) {
  const aesBytes = await deriveMasterKey(masterPassword, manifest.kdf);
  if (manifest.verifier) {
    const verifier = await decryptJson(manifest.verifier, aesBytes);
    if (verifier?.ok !== true) {
      throw new Error("Invalid master password.");
    }
  }
  return aesBytes;
}

function parseArgs(argv) {
  const args = new Map();
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const [flag, inlineValue] = token.slice(2).split("=", 2);
    if (inlineValue !== undefined) {
      args.set(flag, inlineValue);
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args.set(flag, true);
      continue;
    }
    args.set(flag, next);
    index += 1;
  }
  return args;
}

function usage() {
  return `Usage:
  node tools/change_master_password.mjs --manifest resources.encrypted.json --vault-dir resources --old-password OLD --new-password NEW [--output-manifest resources.encrypted.json] [--output-vault-dir resources] [--iterations 650000]

Notes:
  - The vault directory should contain the .vault files referenced by the manifest.
  - Output paths default to the input paths, so the command can rotate in place.
`;
}

async function rotateInlineItem(item, oldKey, newKey) {
  const payload = await decryptJson(item.source, oldKey);
  return {
    ...item,
    source: {
      kind: "inline",
      ...(await encryptJson(payload, newKey)),
    },
  };
}

async function rotateFileItem(item, oldKey, newKey, inputVaultDir, outputVaultDir) {
  const fileName = basename(item.source.path);
  const inputPath = join(inputVaultDir, fileName);
  const bytes = await readFile(inputPath);
  const decryptedBytes = await decryptBytes({
    iv: item.source.iv,
    bytes: new Uint8Array(bytes),
  }, oldKey);
  const encrypted = await encryptBytes(decryptedBytes, newKey);
  const outputPath = join(outputVaultDir, fileName);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, Buffer.from(encrypted.bytes));

  return {
    ...item,
    source: {
      ...item.source,
      iv: encrypted.iv,
    },
  };
}

async function rotateResource(resource, oldKey, newKey, inputVaultDir, outputVaultDir) {
  const rotated = {
    ...resource,
    items: [],
  };

  for (const item of resource.items || []) {
    if (item.source.kind === "inline") {
      rotated.items.push(await rotateInlineItem(item, oldKey, newKey));
    } else if (item.source.kind === "file") {
      rotated.items.push(await rotateFileItem(item, oldKey, newKey, inputVaultDir, outputVaultDir));
    } else {
      throw new Error(`Unknown source kind for ${resource.title || resource.id || "present"}.`);
    }
  }

  if (resource.encryptedPhrase) {
    const phrase = await decryptJson(resource.encryptedPhrase, oldKey);
    rotated.encryptedPhrase = await encryptJson(phrase, newKey);
  }

  return rotated;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.has("help") || args.has("h")) {
    process.stdout.write(usage());
    return;
  }

  const manifestPath = args.get("manifest");
  const oldPassword = args.get("old-password");
  const newPassword = args.get("new-password");
  if (!manifestPath || !oldPassword || !newPassword) {
    process.stderr.write(usage());
    process.exitCode = 1;
    return;
  }

  const inputVaultDir = args.get("vault-dir") || join(dirname(manifestPath), "resources");
  const outputManifestPath = args.get("output-manifest") || manifestPath;
  const outputVaultDir = args.get("output-vault-dir") || inputVaultDir;
  const manifestText = await readFile(manifestPath, "utf8");
  const existingManifest = JSON.parse(manifestText);
  if (existingManifest.version !== 2) {
    throw new Error("Only v2 manifests can be rotated.");
  }

  const now = new Date().toISOString();
  const iterations = Number(args.get("iterations") || existingManifest.kdf?.iterations || 650000);
  const newKdf = {
    name: "PBKDF2",
    hash: "SHA-256",
    iterations,
    salt: bytesToBase64(makeSalt(16)),
  };
  const oldKey = await validateMasterPassword(oldPassword, existingManifest);
  const newKey = await deriveMasterKey(newPassword, newKdf);
  const manifest = {
    ...existingManifest,
    createdAt: now,
    rotatedAt: now,
    kdf: newKdf,
    verifier: await encryptJson({ ok: true }, newKey),
    resources: [],
  };

  for (const resource of existingManifest.resources || []) {
    manifest.resources.push(await rotateResource(resource, oldKey, newKey, inputVaultDir, outputVaultDir));
  }

  await mkdir(dirname(outputManifestPath), { recursive: true });
  await writeFile(outputManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`Rotated ${manifest.resources.length} present(s).\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message || String(error)}\n`);
  process.exitCode = 1;
});
