import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";

const root = new URL("../", import.meta.url);
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const visibleTitle = "Visible TeXt";
const visibleText = "Smoke birthday memory";
const hiddenSong = "https://music.youtube.com/watch?v=test";

function bytesToBase64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

function base64ToBytes(value) {
  return new Uint8Array(Buffer.from(value, "base64"));
}

async function deriveMasterKey(password, kdf) {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: base64ToBytes(kdf.salt), iterations: kdf.iterations },
    baseKey,
    256
  );
  return new Uint8Array(bits);
}

async function encryptJson(payload, keyBytes) {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(payload))
  );
  return {
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
  };
}

async function encryptBytes(bytes, keyBytes) {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes);
  return {
    iv: bytesToBase64(iv),
    bytes: new Uint8Array(encrypted),
  };
}

async function hashSecretPhrase(phrase) {
  const normalized = phrase.toLocaleLowerCase().replace(/\s+/g, "");
  const bytes = new TextEncoder().encode(`hidden-present:${normalized}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return bytesToBase64(new Uint8Array(digest));
}

async function makeTestManifest() {
  const kdf = {
    name: "PBKDF2",
    hash: "SHA-256",
    iterations: 1000,
    salt: bytesToBase64(new Uint8Array(16).fill(7)),
  };
  const keyBytes = await deriveMasterKey("master", kdf);
  return {
    version: 2,
    kdf,
    verifier: await encryptJson({ ok: true }, keyBytes),
    resources: [
      {
        id: "visible-text",
        title: visibleTitle,
        visibility: "visible",
        present: { size: "medium", color: "sage", style: "ribbon" },
        items: [
          {
            type: "text",
            meta: { fontStyle: "garden" },
            source: { kind: "inline", ...(await encryptJson({ text: visibleText }, keyBytes)) },
          },
          {
            type: "song",
            source: { kind: "inline", ...(await encryptJson({ url: hiddenSong }, keyBytes)) },
          },
        ],
      },
      {
        id: "hidden-song",
        title: "Hidden song",
        visibility: "hidden",
        phraseHash: await hashSecretPhrase("green valley"),
        present: { size: "small", color: "gold", style: "dots" },
        items: [
          {
            type: "song",
            source: { kind: "inline", ...(await encryptJson({ url: hiddenSong }, keyBytes)) },
          },
        ],
      },
    ],
  };
}

async function makeResumeManifest(password = "master") {
  const kdf = {
    name: "PBKDF2",
    hash: "SHA-256",
    iterations: 1000,
    salt: bytesToBase64(new Uint8Array(16).fill(13)),
  };
  const keyBytes = await deriveMasterKey(password, kdf);
  const imageBytes = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>");
  const encryptedImage = await encryptBytes(imageBytes, keyBytes);
  return {
    manifest: {
      version: 2,
      kdf,
      verifier: await encryptJson({ ok: true }, keyBytes),
      resources: [
        {
          id: "disk-visible",
          title: "Disk visible",
          visibility: "visible",
          present: { size: "large", color: "mint", style: "botanical" },
          items: [
            {
              type: "text",
              meta: { fontStyle: "handwritten" },
              source: { kind: "inline", ...(await encryptJson({ text: "Loaded from disk" }, keyBytes)) },
            },
            {
              type: "image",
              source: {
                kind: "file",
                path: "resources/disk-visible-image.vault",
                iv: encryptedImage.iv,
                mimeType: "image/svg+xml",
                originalName: "disk-visible.svg",
              },
            },
          ],
        },
        {
          id: "disk-hidden",
          title: "Disk hidden",
          visibility: "hidden",
          phraseHash: await hashSecretPhrase("secret garden"),
          encryptedPhrase: await encryptJson({ phrase: "secret garden" }, keyBytes),
          present: { size: "small", color: "sage", style: "ribbon" },
          items: [
            {
              type: "song",
              source: { kind: "inline", ...(await encryptJson({ url: hiddenSong }, keyBytes)) },
            },
          ],
        },
      ],
    },
    vaultFiles: new Map([
      ["/resources/disk-visible-image.vault", encryptedImage.bytes],
    ]),
  };
}

function contentType(pathname) {
  return {
    ".css": "text/css",
    ".html": "text/html",
    ".js": "text/javascript",
    ".json": "application/json",
    ".png": "image/png",
    ".svg": "image/svg+xml",
  }[extname(pathname)] || "application/octet-stream";
}

async function startServer(manifest, virtualFiles = new Map()) {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");
      let pathname = decodeURIComponent(url.pathname);
      if (pathname === "/") pathname = "/index.html";

      if (pathname === "/resources.encrypted.json") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(manifest));
        return;
      }

      if (virtualFiles.has(pathname)) {
        response.writeHead(200, { "content-type": contentType(pathname) });
        response.end(Buffer.from(virtualFiles.get(pathname)));
        return;
      }

      const body = await readFile(join(root.pathname, pathname));
      response.writeHead(200, { "content-type": contentType(pathname) });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end("Not found");
    }
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
}

async function startChrome() {
  const userDataDir = join(tmpdir(), `lily-vault-smoke-${Date.now()}`);
  const chrome = spawn(chromePath, [
    "--headless=new",
    "--disable-gpu",
    "--disable-background-networking",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`,
    "about:blank",
  ], { stdio: ["ignore", "pipe", "pipe"] });

  const wsUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Chrome did not expose DevTools in time.")), 10000);
    chrome.stderr.on("data", (chunk) => {
      const match = chunk.toString().match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    chrome.on("exit", (code) => reject(new Error(`Chrome exited early with code ${code}`)));
  });

  return { chrome, wsUrl };
}

function createCdp(wsUrl) {
  const socket = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    }
  });

  function send(method, params = {}, sessionId) {
    const id = nextId;
    nextId += 1;
    socket.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  }

  return new Promise((resolve) => {
    socket.addEventListener("open", () => resolve({ socket, send }));
  });
}

async function openPage(cdp, url) {
  const { targetId } = await cdp.send("Target.createTarget", { url });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  await cdp.send("Runtime.enable", {}, sessionId);
  await cdp.send("Page.enable", {}, sessionId);
  return sessionId;
}

async function evaluate(cdp, sessionId, expression) {
  const result = await cdp.send(
    "Runtime.evaluate",
    { expression, awaitPromise: true, returnByValue: true },
    sessionId
  );
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description ||
      result.exceptionDetails.text ||
      "Runtime evaluation failed."
    );
  }
  return result.result.value;
}

async function waitFor(cdp, sessionId, expression, label) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const value = await evaluate(cdp, sessionId, expression);
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function runIndexTests(cdp, baseUrl) {
  const session = await openPage(cdp, `${baseUrl}/index.html`);
  await waitFor(cdp, session, "document.readyState === 'complete' && !!window.VaultCrypto", "index load");

  const initial = await evaluate(cdp, session, `({
    title: document.title,
    h1: document.querySelector('#title').textContent,
    subtitle: document.querySelector('#subtitle').textContent,
    coverImage: getComputedStyle(document.querySelector('.fold-left')).backgroundImage.includes('lily-of-the-valley'),
    flipPrompt: document.body.textContent.includes('Tap to flip the card'),
    clueLabel: document.querySelector('#unlockForm label').childNodes[0].textContent.trim(),
    randomButton: Boolean(document.querySelector('#randomGreeting')),
    removedCopy: document.body.textContent.includes('Memory presents') ||
      document.body.textContent.includes('Choose a present') ||
      document.body.textContent.includes('Secret phrase') ||
      document.body.textContent.includes('Click or tap the folded card to open it.') ||
      document.body.textContent.includes('Tap to unfold')
  })`);
  assert(initial.title === "Happy birthday", "Index title is wrong.");
  assert(initial.h1 === "Happy birthday", "Index h1 is wrong.");
  assert(initial.subtitle === "The best present is the present. Here are some of the past presents that live as memories.", "Subtitle is wrong.");
  assert(initial.coverImage, "Folded cover image was not configured.");
  assert(initial.flipPrompt, "Flip prompt was not rendered.");
  assert(initial.clueLabel === "Clue in", "Password label was not renamed.");
  assert(initial.randomButton === false, "Random greeting button should be removed.");
  assert(initial.removedCopy === false, "Removed public helper copy is still visible.");
  await waitFor(cdp, session, "!document.querySelector('#unlockForm button[type=\"submit\"]').disabled", "manifest-ready unlock button");

  const opened = await evaluate(cdp, session, `
    document.querySelector('.fold-gate').click();
    document.querySelector('#foldToggle').checked;
  `);
  assert(opened, "Folded card did not open.");
  await waitFor(cdp, session, "document.activeElement === document.querySelector('#masterPassword')", "password focus after unfold");

  const passwordVisible = await evaluate(cdp, session, `
    document.querySelector('#toggleMasterPassword').click();
    document.querySelector('#masterPassword').type === 'text';
  `);
  assert(passwordVisible, "Password visibility toggle did not reveal the password.");

  await evaluate(cdp, session, `
    document.querySelector('#masterPassword').value = 'master';
    document.querySelector('#unlockForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  `);
  await waitFor(cdp, session, "document.querySelectorAll('.present').length === 1", "visible present");
  const unlockedFormState = await evaluate(cdp, session, `({
    unlockHidden: document.querySelector('#unlockForm').hidden,
    memorySlotHidden: document.querySelector('#memorySearchSlot').hidden,
    memoryParent: document.querySelector('#memorySearchForm').parentElement.id,
    memoryPlaceholder: document.querySelector('#memorySearchPhrase').placeholder,
    memoryButton: document.querySelector('#searchMemory').textContent
  })`);
  assert(unlockedFormState.unlockHidden === true, "Unlock form should be hidden after presents open.");
  assert(unlockedFormState.memorySlotHidden === false, "Memory search slot should be visible after presents open.");
  assert(unlockedFormState.memoryParent === "memorySearchSlot", "Memory search form did not replace the unlock form.");
  assert(unlockedFormState.memoryPlaceholder === "Search your memory", "Memory search input placeholder is wrong.");
  assert(unlockedFormState.memoryButton === "Check memory", "Memory search button text is wrong.");
  const visibleTitleRendered = await evaluate(cdp, session, "document.querySelector('.present[data-resource-id=\"visible-text\"] .present-label')?.textContent");
  assert(visibleTitleRendered === visibleTitle, "Public present label did not preserve title case.");
  const presentNumber = await evaluate(cdp, session, "document.querySelector('.present .present-number')?.textContent");
  assert(presentNumber === "1", "Present number was not rendered.");

  await evaluate(cdp, session, "document.querySelector('.present[data-resource-id=\"visible-text\"]').click()");
  const textOpened = await waitFor(
    cdp,
    session,
    `document.querySelector('#presentContent .text-surprise')?.textContent === '${visibleText}' &&
      document.querySelector('#presentContent .song-link')?.href === '${hiddenSong}' &&
      document.querySelector('#presentContent .song-play')?.textContent === 'Play here'`,
    "text present"
  );
  assert(textOpened, "Visible text present did not open.");
  const dialogTitle = await evaluate(cdp, session, "document.querySelector('#presentContent .resource-view h2')?.textContent");
  assert(dialogTitle === visibleTitle, "Public present dialog title did not preserve title case.");
  const iconCount = await evaluate(cdp, session, "document.querySelectorAll('.present[data-resource-id=\"visible-text\"] .present-icon').length");
  assert(iconCount === 2, "Multi-media present did not show media icons.");

  const playerOpened = await evaluate(cdp, session, `
    document.querySelector('#presentContent .song-play').click();
    ({
      hidden: document.querySelector('#songPlayer').hidden,
      bodyClass: document.body.classList.contains('song-player-open'),
      pagePaddingBottom: parseFloat(getComputedStyle(document.querySelector('.card-page')).paddingBottom),
      frameSrc: document.querySelector('#songPlayer iframe')?.src || '',
      link: document.querySelector('#songPlayerLink')?.href || '',
      toggleText: document.querySelector('#songPlaybackToggle')?.textContent || ''
    })
  `);
  assert(playerOpened.hidden === false, "Song player did not become visible.");
  assert(playerOpened.bodyClass === true, "Song player did not reserve page space.");
  assert(playerOpened.pagePaddingBottom >= 300, "Song player reserved page space is too small.");
  assert(playerOpened.frameSrc.includes("youtube.com/embed/test"), "Song player did not use an embedded YouTube player.");
  assert(playerOpened.frameSrc.includes("autoplay=1"), "Song player did not request autoplay after the play click.");
  assert(playerOpened.link === hiddenSong, "Song player link does not point to the song.");
  assert(playerOpened.toggleText === "Pause song", "Song player pause button was not shown.");

  const playerAfterBackdropClose = await evaluate(cdp, session, `
    document.querySelector('#presentDialog').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    ({
      dialogOpen: document.querySelector('#presentDialog').open,
      playerHidden: document.querySelector('#songPlayer').hidden,
      frameStillPresent: Boolean(document.querySelector('#songPlayer iframe'))
    })
  `);
  assert(playerAfterBackdropClose.dialogOpen === false, "Clicking outside the present did not close the dialog.");
  assert(playerAfterBackdropClose.playerHidden === false, "Song player should stay visible after closing the present.");
  assert(playerAfterBackdropClose.frameStillPresent === true, "Song player iframe should remain after closing the present.");

  const playerPaused = await evaluate(cdp, session, `
    document.querySelector('#songPlaybackToggle').click();
    document.querySelector('#songPlaybackToggle').textContent;
  `);
  assert(playerPaused === "Resume song", "Song player pause button did not toggle to resume.");

  const playerDismissed = await evaluate(cdp, session, `
    document.querySelector('#dismissSongPlayer').click();
    ({
      hidden: document.querySelector('#songPlayer').hidden,
      bodyClass: document.body.classList.contains('song-player-open'),
      pagePaddingBottom: parseFloat(getComputedStyle(document.querySelector('.card-page')).paddingBottom),
      frameStillPresent: Boolean(document.querySelector('#songPlayer iframe')),
      toggleText: document.querySelector('#songPlaybackToggle').textContent
    })
  `);
  assert(playerDismissed.hidden === true, "Song player dismiss button did not hide the player.");
  assert(playerDismissed.bodyClass === false, "Song player dismiss button did not remove reserved page space.");
  assert(playerDismissed.pagePaddingBottom < 300, "Song player dismiss button left extra page padding behind.");
  assert(playerDismissed.frameStillPresent === false, "Song player dismiss button did not stop/remove the player iframe.");
  assert(playerDismissed.toggleText === "Pause song", "Song player dismiss button did not reset playback state.");

  await evaluate(cdp, session, `
    document.querySelector('#memorySearchPhrase').value = '  Green   VaLLeY ';
    document.querySelector('#memorySearchForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  `);
  const hiddenOpened = await waitFor(
    cdp,
    session,
    `document.querySelector('#presentDialog').open &&
      document.querySelector('#presentContent .song-link')?.href === '${hiddenSong}'`,
    "hidden song"
  );
  assert(hiddenOpened, "Hidden song present did not open.");

  await evaluate(cdp, session, `
    if (document.querySelector('#presentDialog').open) document.querySelector('#closePresent').click();
    document.querySelector('#masterPassword').value = 'wrong';
    document.querySelector('#unlockForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  `);
  const errorGreeting = await waitFor(
    cdp,
    session,
    "document.querySelector('.greeting-card h2')?.textContent",
    "unlock error greeting"
  );
  assert(errorGreeting.length > 0, "Unlock error did not render a greeting.");
}

async function runMobileIndexTests(cdp, baseUrl) {
  const session = await openPage(cdp, `${baseUrl}/index.html`);
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  }, session);
  await waitFor(cdp, session, "document.readyState === 'complete' && !!window.VaultCrypto", "mobile index load");
  await waitFor(cdp, session, "!document.querySelector('#unlockForm button[type=\"submit\"]').disabled", "mobile manifest-ready unlock button");

  await evaluate(cdp, session, `
    document.querySelector('.fold-gate').click();
    document.querySelector('#masterPassword').value = 'master';
    document.querySelector('#unlockForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  `);
  await waitFor(
    cdp,
    session,
    "document.body.classList.contains('presents-open') && document.querySelector('#presentArea:not([hidden])') && document.querySelectorAll('.present').length === 1",
    "mobile visible present"
  );

  const searchLayout = await waitFor(cdp, session, `
    (() => {
      const tray = document.querySelector('.present-header');
      const input = document.querySelector('#memorySearchPhrase');
      const button = document.querySelector('#searchMemory');
      const slot = document.querySelector('#memorySearchSlot');
      const slotRect = slot.getBoundingClientRect();
      const inputRect = input.getBoundingClientRect();
      const buttonRect = button.getBoundingClientRect();
      const replacedUnlockForm = document.querySelector('#unlockForm').hidden &&
        !slot.hidden &&
        document.querySelector('#memorySearchForm').parentElement === slot;
      const slotVisible = slotRect.left >= 0 &&
        slotRect.right <= window.innerWidth &&
        slotRect.top >= 0 &&
        slotRect.bottom <= window.innerHeight;
      const inputVisible = inputRect.width > 260 &&
        inputRect.left >= 0 &&
        inputRect.right <= window.innerWidth &&
        inputRect.top >= 0 &&
        inputRect.bottom <= window.innerHeight;
      const buttonVisible = buttonRect.width > 260 &&
        buttonRect.left >= 0 &&
        buttonRect.right <= window.innerWidth &&
        buttonRect.top >= 0 &&
        buttonRect.bottom <= window.innerHeight;
      return replacedUnlockForm && slotVisible && inputVisible && buttonVisible ? {
        slotBottom: slotRect.bottom,
        inputWidth: inputRect.width,
        buttonWidth: buttonRect.width,
        viewportWidth: window.innerWidth
      } : false;
    })()
  `, "mobile memory search visibility");
  assert(searchLayout.inputWidth <= searchLayout.viewportWidth, "Mobile memory search input overflows the viewport.");
  assert(searchLayout.buttonWidth <= searchLayout.viewportWidth, "Mobile memory search button overflows the viewport.");
}

async function runBuilderTests(cdp, baseUrl) {
  const session = await openPage(cdp, `${baseUrl}/builder.html`);
  await waitFor(cdp, session, "document.readyState === 'complete' && !!window.VaultCrypto", "builder load");

  const modalOpened = await evaluate(cdp, session, `
    document.querySelector('.open-password-modal').click();
    const opened = document.querySelector('#passwordModal').open;
    document.querySelector('#closePasswordModal').click();
    opened;
  `);
  assert(modalOpened, "Change master password modal did not open.");

  await evaluate(cdp, session, `
    const first = document.querySelector('.resource-editor');
    document.querySelector('#masterPassword').value = 'master';
    document.querySelector('#iterations').value = '1000';
    first.querySelector('.resource-name').value = 'Builder MiXeD';
    first.querySelector('.resource-text').value = 'Builder memory';
    first.querySelector('.resource-hidden').checked = false;
    first.querySelector('.resource-song').value = '${hiddenSong}';
    const file = new File(['<svg xmlns="http://www.w3.org/2000/svg"></svg>'], 'tiny.svg', { type: 'image/svg+xml' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    first.querySelector('.resource-image').files = transfer.files;
    document.querySelector('#addPresent').click();
    const hidden = [...document.querySelectorAll('.resource-editor')].at(0);
    hidden.querySelector('.resource-name').value = 'Builder HiDdEn';
    hidden.querySelector('.resource-hidden').checked = true;
    hidden.querySelector('.resource-hidden').dispatchEvent(new Event('change', { bubbles: true }));
    hidden.querySelector('.resource-phrase').value = 'Secret Memory';
    hidden.querySelector('.resource-song').value = '${hiddenSong}';
    document.querySelector('#builderForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  `);

  await waitFor(cdp, session, "document.querySelectorAll('.download-link').length === 2", "builder downloads");
  const output = await evaluate(cdp, session, `
    fetch(document.querySelector('.download-link[download="resources.encrypted.json"]').href).then(async (response) => {
      const manifest = await response.json();
      return {
        version: manifest.version,
        count: manifest.resources.length,
        titles: manifest.resources.map((resource) => resource.title),
        titleTransform: getComputedStyle(document.querySelector('.resource-name')).textTransform,
        itemCounts: manifest.resources.map((resource) => resource.items.length),
        filePaths: manifest.resources.flatMap((resource) => resource.items).filter((item) => item.source.kind === 'file').map((item) => item.source.path),
        hidden: manifest.resources.filter((item) => item.visibility === 'hidden').length,
        phraseHashes: manifest.resources.filter((item) => item.visibility === 'hidden').map((item) => item.phraseHash),
        encryptedPhrases: manifest.resources.filter((item) => item.visibility === 'hidden').map((item) => item.encryptedPhrase?.ciphertext || '')
      };
    })
  `);
  assert(output.version === 2, "Builder did not create a v2 manifest.");
  assert(output.count === 2, "Builder manifest resource count is wrong.");
  assert(output.titles.includes("Builder MiXeD"), "Builder did not preserve visible title case.");
  assert(output.titles.includes("Builder HiDdEn"), "Builder did not preserve hidden title case.");
  assert(output.titleTransform === "none", "Builder present title input should not force uppercase.");
  assert(output.itemCounts.includes(3), "Builder mixed present item count is wrong.");
  assert(output.hidden === 1, "Builder hidden resource count is wrong.");
  assert(output.phraseHashes[0]?.length > 20, "Builder did not store hidden phrase hash.");
  assert(output.encryptedPhrases[0]?.length > 20, "Builder did not store encrypted hidden phrase.");
  assert(output.filePaths[0]?.startsWith("resources/"), "Builder media resource does not point to resources/.");
}

async function runDiskResumeTests(cdp, baseUrl) {
  const session = await openPage(cdp, `${baseUrl}/builder.html`);
  await waitFor(cdp, session, "document.readyState === 'complete' && !!window.VaultCrypto", "builder resume load");

  const before = await evaluate(cdp, session, "document.querySelector('#saveResumedToFolder').disabled");
  assert(before === true, "Resume save button should start disabled before a resume.");

  await evaluate(cdp, session, `
    document.querySelector('#resumeMasterPassword').value = 'master';
    document.querySelector('#resumeForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  `);

  await waitFor(cdp, session, "document.querySelector('#builderStatus').textContent.startsWith('Resumed 2 present')", "disk resume");

  const resumed = await evaluate(cdp, session, `
    (() => {
      const editors = [...document.querySelectorAll('.resource-editor')];
      return {
        count: editors.length,
        resumeActive: document.body.classList.contains('resume-active'),
        buildHidden: getComputedStyle(document.querySelector('#builderForm > .builder-toolbar > button[type="submit"]')).display === 'none',
        saveHidden: getComputedStyle(document.querySelector('#saveToFolder')).display === 'none',
        masterPassword: document.querySelector('#masterPassword').value,
        iterations: document.querySelector('#iterations').value,
        firstTitle: editors[0].querySelector('.resource-name').value,
        firstText: editors[0].querySelector('.resource-text').value,
        imagePreview: editors[0].querySelector('.media-preview-button')?.textContent || '',
        hiddenPlaceholder: editors[1].querySelector('.resource-phrase').placeholder,
        hiddenPhrase: editors[1].querySelector('.resource-phrase').value,
        hiddenSongLink: editors[1].querySelector('.song-link-preview')?.href || '',
        hiddenSongState: editors[1].querySelector('.song-state')?.textContent || '',
        masterPanelHidden: document.querySelector('#masterEncryptionPanel').hidden,
        masterPanelDisplay: getComputedStyle(document.querySelector('#masterEncryptionPanel')).display
      };
  })()
  `);
  assert(resumed.count === 2, "Disk resume did not recreate both editors.");
  assert(resumed.resumeActive === true, "Disk resume did not mark the builder as resumed.");
  assert(resumed.buildHidden === true, "Build encrypted downloads should be hidden after resume.");
  assert(resumed.saveHidden === true, "Save directly to folder should be hidden after resume.");
  assert(resumed.masterPassword === "master", "Disk resume did not copy the master password into the build form.");
  assert(resumed.iterations === "1000", "Disk resume did not restore the manifest iteration count.");
  assert(resumed.firstTitle === "Disk visible", "Disk resume did not restore the visible present title.");
  assert(resumed.firstText === "Loaded from disk", "Disk resume did not restore the visible text.");
  assert(resumed.imagePreview === "Preview image", "Disk resume did not show a loaded image preview button.");
  assert(resumed.hiddenPlaceholder.includes("keep existing hidden phrase"), "Disk resume did not preserve the hidden phrase hash.");
  assert(resumed.hiddenPhrase === "secret garden", "Disk resume did not decrypt the hidden phrase back into the builder.");
  assert(resumed.hiddenSongLink === hiddenSong, "Disk resume did not show a clickable song link.");
  assert(resumed.hiddenSongState === "Song link added", "Disk resume did not show an active song state.");
  assert(resumed.masterPanelHidden === true, "Resume did not hide the master encryption panel.");
  assert(resumed.masterPanelDisplay === "none", "Hidden master encryption panel is still visible in layout.");

  const after = await evaluate(cdp, session, "document.querySelector('#saveResumedToFolder').disabled");
  assert(after === false, "Resume save button should enable after a successful resume.");
  const previewOpened = await evaluate(cdp, session, `
    document.querySelector('.media-preview-button').click();
    document.querySelector('#mediaPreviewDialog').open &&
      document.querySelector('#mediaPreviewContent img')?.src.startsWith('blob:')
  `);
  assert(previewOpened, "Image preview button did not open a blob preview.");
}

async function runManifestOnlyResumeTests(cdp, baseUrl) {
  const session = await openPage(cdp, `${baseUrl}/builder.html`);
  await waitFor(cdp, session, "document.readyState === 'complete' && !!window.VaultCrypto", "manifest-only resume load");

  await evaluate(cdp, session, `
    document.querySelector('#resumeMasterPassword').value = 'master';
    document.querySelector('#resumeForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  `);

  await waitFor(cdp, session, "document.querySelector('#builderStatus').textContent.startsWith('Resumed')", "manifest-only resume");
  const enabled = await evaluate(cdp, session, "document.querySelector('#saveResumedToFolder').disabled === false");
  assert(enabled, "Resume save button should enable even when there are no vault files.");
}

async function runResumeAddPhotoSaveTests(cdp, baseUrl) {
  const session = await openPage(cdp, `${baseUrl}/builder.html`);
  await waitFor(cdp, session, "document.readyState === 'complete' && !!window.VaultCrypto", "resume add photo load");

  await evaluate(cdp, session, `
    window.__savedFiles = new Map();
    function makeHandle(prefix = '') {
      return {
        async getFileHandle(name) {
          const path = prefix ? prefix + '/' + name : name;
          return {
            async createWritable() {
              return {
                async write(blob) {
                  window.__savedFiles.set(path, blob);
                },
                async close() {}
              };
            }
          };
        },
        async getDirectoryHandle(name) {
          return makeHandle(prefix ? prefix + '/' + name : name);
        }
      };
    }
    Object.defineProperty(window, 'showDirectoryPicker', {
      value: async () => makeHandle(),
      configurable: true
    });
    document.querySelector('#resumeMasterPassword').value = 'xcc';
    document.querySelector('#resumeForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  `);
  await waitFor(cdp, session, "document.querySelector('#builderStatus').textContent.startsWith('Resumed 2 present')", "xcc resume");

  await evaluate(cdp, session, `
    (async () => {
      const response = await fetch('/internet-photo.svg');
      const photoBlob = await response.blob();
      const transfer = new DataTransfer();
      transfer.items.add(new File([photoBlob], 'internet-photo.svg', { type: 'image/svg+xml' }));
      const editor = document.querySelector('.resource-editor');
      editor.querySelector('.resource-name').value = 'Edited saved present';
      editor.querySelector('.resource-phrase').value = 'Edited Secret';
      editor.querySelector('.resource-phrase').dispatchEvent(new Event('input', { bubbles: true }));
      editor.querySelector('.present-size').value = 'tall';
      editor.querySelector('.present-color').value = 'emerald';
      editor.querySelector('.present-style').value = 'stripe';
      editor.querySelector('.resource-text').value = 'Edited text payload';
      editor.querySelector('.resource-style').value = 'cinematic';
      editor.querySelector('.resource-song').value = '${hiddenSong}';
      editor.querySelector('.resource-image').files = transfer.files;
      await document.querySelector('#saveResumedToFolder').click();
    })()
  `);
  await waitFor(cdp, session, "document.querySelector('#builderStatus').textContent.startsWith('Saved the rebuilt manifest')", "save rebuilt resume");

  const saved = await evaluate(cdp, session, `
    (async () => {
      const manifestBlob = window.__savedFiles.get('resources.encrypted.json');
      const manifest = JSON.parse(await manifestBlob.text());
      const edited = manifest.resources.find((resource) => resource.title === 'Edited saved present');
      const vaultNames = [...window.__savedFiles.keys()].filter((key) => key.startsWith('resources/') && key.endsWith('.vault'));
      return {
        resourceCount: manifest.resources.length,
        imageItems: manifest.resources.flatMap((resource) => resource.items).filter((item) => item.type === 'image').length,
        vaultCount: vaultNames.length,
        originalName: manifest.resources.flatMap((resource) => resource.items).find((item) => item.type === 'image')?.source.originalName || '',
        editedVisibility: edited?.visibility,
        editedPhraseHash: edited?.phraseHash || '',
        editedEncryptedPhrase: edited?.encryptedPhrase?.ciphertext || '',
        expectedPhraseHash: await window.VaultCrypto.hashSecretPhrase('Edited Secret'),
        editedSize: edited?.present?.size,
        editedColor: edited?.present?.color,
        editedStyle: edited?.present?.style,
        editedFont: edited?.items?.find((item) => item.type === 'text')?.meta?.fontStyle,
        editedTypes: edited?.items?.map((item) => item.type).sort().join(',')
      };
    })()
  `);
  assert(saved.resourceCount === 2, "Resumed save changed the resource count.");
  assert(saved.imageItems >= 1, "Resumed save did not include the added image in the manifest.");
  assert(saved.vaultCount >= 1, "Resumed save did not write an encrypted image vault file.");
  assert(saved.originalName === "internet-photo.svg", "Resumed save did not use the added internet photo.");
  assert(saved.editedVisibility === "hidden", "Resumed save did not persist edited visibility.");
  assert(saved.editedPhraseHash === saved.expectedPhraseHash, "Resumed save did not persist the edited hidden phrase.");
  assert(saved.editedEncryptedPhrase.length > 20, "Resumed save did not persist the encrypted hidden phrase.");
  assert(saved.editedSize === "tall", "Resumed save did not persist edited present size.");
  assert(saved.editedColor === "emerald", "Resumed save did not persist edited present color.");
  assert(saved.editedStyle === "stripe", "Resumed save did not persist edited present style.");
  assert(saved.editedFont === "cinematic", "Resumed save did not persist edited text font.");
  assert(saved.editedTypes === "image,song,text", "Resumed save did not persist all edited media fields.");
}

const manifest = await makeTestManifest();
const server = await startServer(manifest);
const resumeData = await makeResumeManifest();
const resumeServer = await startServer(resumeData.manifest, resumeData.vaultFiles);
const xccResumeData = await makeResumeManifest("xcc");
xccResumeData.vaultFiles.set(
  "/internet-photo.svg",
  new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'><rect width='12' height='12' fill='green'/></svg>")
);
const xccResumeServer = await startServer(xccResumeData.manifest, xccResumeData.vaultFiles);
const manifestOnly = await makeTestManifest();
manifestOnly.resources = manifestOnly.resources.map((resource) => ({
  ...resource,
  items: (resource.items || []).filter((item) => item.source.kind !== "file"),
}));
const manifestOnlyServer = await startServer(manifestOnly);
const address = server.address();
const baseUrl = `http://${address.address}:${address.port}`;
const resumeAddress = resumeServer.address();
const resumeBaseUrl = `http://${resumeAddress.address}:${resumeAddress.port}`;
const xccResumeAddress = xccResumeServer.address();
const xccResumeBaseUrl = `http://${xccResumeAddress.address}:${xccResumeAddress.port}`;
const manifestOnlyAddress = manifestOnlyServer.address();
const manifestOnlyBaseUrl = `http://${manifestOnlyAddress.address}:${manifestOnlyAddress.port}`;
const { chrome, wsUrl } = await startChrome();
const cdp = await createCdp(wsUrl);

try {
  await runIndexTests(cdp, baseUrl);
  await runMobileIndexTests(cdp, baseUrl);
  await runBuilderTests(cdp, baseUrl);
  await runDiskResumeTests(cdp, resumeBaseUrl);
  await runManifestOnlyResumeTests(cdp, manifestOnlyBaseUrl);
  await runResumeAddPhotoSaveTests(cdp, xccResumeBaseUrl);
  console.log("Smoke tests passed.");
} finally {
  cdp.socket.close();
  chrome.kill();
  server.close();
  resumeServer.close();
  xccResumeServer.close();
  manifestOnlyServer.close();
}
