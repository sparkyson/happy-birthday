import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const pageUrl = new URL("../designs/folded-2-trifold.html", import.meta.url).href;
const outputDir = new URL("../tmp/screens/", import.meta.url);

async function startChrome() {
  const chrome = spawn(chromePath, [
    "--headless=new",
    "--disable-gpu",
    "--disable-background-networking",
    "--no-first-run",
    "--no-default-browser-check",
    `--user-data-dir=/private/tmp/lily-folded2-visual-${Date.now()}`,
    "--remote-debugging-port=0",
    "about:blank",
  ], { stdio: ["ignore", "pipe", "pipe"] });

  const wsUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Chrome DevTools did not start.")), 10000);
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
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
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

async function openPage(cdp, width, height) {
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  await cdp.send("Runtime.enable", {}, sessionId);
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 700,
  }, sessionId);
  await cdp.send("Page.navigate", { url: pageUrl }, sessionId);
  await waitFor(cdp, sessionId, "document.readyState === 'complete'");
  return sessionId;
}

async function evaluate(cdp, sessionId, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Evaluation failed.");
  return result.result.value;
}

async function waitFor(cdp, sessionId, expression) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await evaluate(cdp, sessionId, expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${expression}`);
}

async function screenshot(cdp, sessionId, name) {
  const result = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true }, sessionId);
  await mkdir(outputDir, { recursive: true });
  await writeFile(new URL(name, outputDir), Buffer.from(result.data, "base64"));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function verify(cdp, sessionId) {
  const closed = await evaluate(cdp, sessionId, `({
    imageLoaded: getComputedStyle(document.querySelector('.flap-right .flap-art')).backgroundImage.includes('lily-of-the-valley'),
    leftText: document.querySelector('.flap-left .flap-label').textContent,
    labelFits: (() => {
      const label = document.querySelector('.flap-left .flap-label');
      const flap = document.querySelector('.flap-left');
      const a = label.getBoundingClientRect();
      const b = flap.getBoundingClientRect();
      return a.left >= b.left && a.right <= b.right && a.top >= b.top && a.bottom <= b.bottom;
    })()
  })`);
  assert(closed.imageLoaded, "Closed cover image did not load.");
  assert(closed.leftText.includes("Happy") && closed.leftText.includes("birthday"), "Closed cover text is incomplete.");
  assert(closed.labelFits, "Closed cover text is clipped.");

  return async function verifyOpened() {
    await evaluate(cdp, sessionId, "document.querySelector('.gate').click()");
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const opened = await evaluate(cdp, sessionId, `({
      checked: document.querySelector('#tri-toggle').checked,
      backOpacity: getComputedStyle(document.querySelector('.flap-back')).opacity,
      backImageLoaded: getComputedStyle(document.querySelector('.flap-back-image')).backgroundImage.includes('lily-of-the-valley'),
      backLabelText: document.querySelector('.flap-back-text .flap-label').textContent
    })`);
    assert(opened.checked, "Card did not open after click.");
    assert(Number(opened.backOpacity) > 0.8, "Back-side translucent print is not visible.");
    assert(opened.backImageLoaded, "Back-side image did not load.");
    assert(opened.backLabelText.includes("Happy") && opened.backLabelText.includes("birthday"), "Back-side text is incomplete.");
  };
}

const { chrome, wsUrl } = await startChrome();
const cdp = await createCdp(wsUrl);

try {
  const desktop = await openPage(cdp, 1280, 900);
  const openDesktop = await verify(cdp, desktop);
  await screenshot(cdp, desktop, "folded2-desktop-closed.png");
  await openDesktop();
  await screenshot(cdp, desktop, "folded2-desktop-open.png");

  const mobile = await openPage(cdp, 390, 820);
  const openMobile = await verify(cdp, mobile);
  await screenshot(cdp, mobile, "folded2-mobile-closed.png");
  await openMobile();
  await screenshot(cdp, mobile, "folded2-mobile-open.png");

  console.log("Folded option 2 visual checks passed.");
} finally {
  cdp.socket.close();
  chrome.kill();
}
