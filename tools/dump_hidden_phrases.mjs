#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";

const crypto = webcrypto;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64ToBytes(value) {
  return new Uint8Array(Buffer.from(value, "base64"));
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
  node tools/dump_hidden_phrases.mjs --manifest resources.encrypted.json --password PASSWORD [--json]

Options:
  --manifest   Path to the encrypted manifest.
  --password   Master password used to unlock the manifest.
  --json       Print JSON output instead of plain text.
`;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.has("help") || args.has("h")) {
    process.stdout.write(usage());
    return;
  }

  const manifestPath = args.get("manifest");
  const password = args.get("password");
  const asJson = args.has("json");
  if (!manifestPath || !password) {
    process.stderr.write(usage());
    process.exitCode = 1;
    return;
  }

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.version !== 2) {
    throw new Error("Only v2 manifests can be dumped.");
  }

  const aesBytes = await validateMasterPassword(password, manifest);
  const hidden = [];

  for (const resource of manifest.resources || []) {
    if (!resource.encryptedPhrase) continue;
    const payload = await decryptJson(resource.encryptedPhrase, aesBytes);
    hidden.push({
      id: resource.id || "",
      title: resource.title || "",
      phrase: payload.phrase || "",
    });
  }

  if (asJson) {
    process.stdout.write(JSON.stringify({ manifest: manifestPath, hidden }, null, 2) + "\n");
    return;
  }

  if (hidden.length === 0) {
    process.stdout.write("No hidden phrases found.\n");
    return;
  }

  for (const entry of hidden) {
    process.stdout.write(`${entry.title}: ${entry.phrase}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message || String(error)}\n`);
  process.exitCode = 1;
});
