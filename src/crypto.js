(function () {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  function bytesToBase64(bytes) {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }

  function base64ToBytes(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  function makeSalt(length = 16) {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return bytes;
  }

  function makeId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return bytesToBase64(makeSalt(12)).replace(/[^a-z0-9]/gi, "").slice(0, 18);
  }

  function normalizeSecretPhrase(value) {
    return value.toLocaleLowerCase().replace(/\s+/g, "");
  }

  async function hashSecretPhrase(phrase) {
    const normalized = normalizeSecretPhrase(phrase);
    const bytes = encoder.encode(`hidden-present:${normalized}`);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return bytesToBase64(new Uint8Array(digest));
  }

  function createKdf(iterations) {
    return {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations: Number(iterations),
      salt: bytesToBase64(makeSalt(16)),
    };
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
      if (verifier?.ok !== true) throw new Error("Invalid verifier.");
    }
    return aesBytes;
  }

  window.VaultCrypto = {
    bytesToBase64,
    base64ToBytes,
    createKdf,
    decryptBytes,
    decryptJson,
    deriveMasterKey,
    encryptBytes,
    encryptJson,
    hashSecretPhrase,
    makeId,
    makeSalt,
    normalizeSecretPhrase,
    validateMasterPassword,
  };
})();
