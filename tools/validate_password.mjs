#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
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
  node tools/validate_password.mjs --manifest resources.encrypted.json --password PASSWORD [--check-resources] [--vault-dir resources]

Options:
  --manifest   Path to the encrypted manifest.
  --password   Password to validate.
  --check-resources  Also decrypt every inline payload and encrypted .vault file.
  --vault-dir   Directory that contains encrypted .vault files.
  --json       Print JSON output instead of plain text.
`;
}

async function validateResourcePayload(resource, item, aesBytes, vaultDir) {
  if (item.source.kind === "inline") {
    await decryptJson(item.source, aesBytes);
    return;
  }

  if (item.source.kind !== "file") {
    throw new Error(`Unknown source kind for ${resource.title || resource.id || "present"}.`);
  }

  const fileName = basename(item.source.path || "");
  if (!fileName) {
    throw new Error(`Missing encrypted media path for ${resource.title || resource.id || "present"}.`);
  }

  const filePath = join(vaultDir, fileName);
  const bytes = await readFile(filePath);
  await decryptBytes({
    iv: item.source.iv,
    bytes: new Uint8Array(bytes),
  }, aesBytes);
}

async function validateResources(manifest, aesBytes, vaultDir) {
  let validatedItems = 0;
  for (const resource of manifest.resources || []) {
    if (resource.encryptedPhrase) {
      const hiddenPhrase = await decryptJson(resource.encryptedPhrase, aesBytes);
      if (typeof hiddenPhrase?.phrase !== "string" || !hiddenPhrase.phrase.trim()) {
        throw new Error(`Encrypted hidden phrase is invalid for ${resource.title || resource.id || "present"}.`);
      }
      validatedItems += 1;
    }

    for (const item of resource.items || []) {
      await validateResourcePayload(resource, item, aesBytes, vaultDir);
      validatedItems += 1;
    }
  }
  return validatedItems;
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
  const checkResources = args.has("check-resources");
  if (!manifestPath || !password) {
    process.stderr.write(usage());
    process.exitCode = 1;
    return;
  }

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.version !== 2) {
    throw new Error("Only v2 manifests can be validated.");
  }

  const aesBytes = await validateMasterPassword(password, manifest);
  let validatedItems = 0;
  if (checkResources) {
    const vaultDir = args.get("vault-dir") || join(dirname(manifestPath), "resources");
    validatedItems = await validateResources(manifest, aesBytes, vaultDir);
  }

  if (asJson) {
    process.stdout.write(JSON.stringify({
      ok: true,
      manifest: manifestPath,
      resourcesChecked: checkResources,
      validatedItems,
    }) + "\n");
  } else {
    process.stdout.write(checkResources
      ? `Password is valid. ${validatedItems} resource item(s) validated.\n`
      : "Password is valid.\n");
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message || String(error)}\n`);
  process.exitCode = 1;
});
