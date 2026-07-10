const form = document.querySelector("#unlockForm");
const memorySearchForm = document.querySelector("#memorySearchForm");
const memorySearchSlot = document.querySelector("#memorySearchSlot");
const presentHeader = document.querySelector(".present-header");
const foldToggle = document.querySelector("#foldToggle");
const masterPasswordInput = document.querySelector("#masterPassword");
const toggleMasterPasswordButton = document.querySelector("#toggleMasterPassword");
const openPresentsButton = form.querySelector("button[type='submit']");
const searchMemoryButton = document.querySelector("#searchMemory");
const memorySearchPhraseInput = document.querySelector("#memorySearchPhrase");
const title = document.querySelector("#title");
const subtitle = document.querySelector("#subtitle");
const status = document.querySelector("#status");
const result = document.querySelector("#result");
const presentArea = document.querySelector("#presentArea");
const presentGrid = document.querySelector("#presentGrid");
const presentDialog = document.querySelector("#presentDialog");
const presentContent = document.querySelector("#presentContent");
const closePresentButton = document.querySelector("#closePresent");
const songPlayer = document.querySelector("#songPlayer");
const songPlayerTitle = document.querySelector("#songPlayerTitle");
const songPlayerLink = document.querySelector("#songPlayerLink");
const songPlayerFrameSlot = document.querySelector("#songPlayerFrameSlot");
const songPlaybackToggle = document.querySelector("#songPlaybackToggle");
const dismissSongPlayerButton = document.querySelector("#dismissSongPlayer");
const { decryptBytes, decryptJson, hashSecretPhrase, validateMasterPassword } = window.VaultCrypto;
const { randomGreeting, randomEasterTranslation } = window.VaultGreetings;

let manifest = null;
let masterKey = null;
let revealedHidden = new Set();
let activeSongUrl = "";
let songPaused = false;
openPresentsButton.disabled = true;

const historyState = {
  closed: "closed",
  card: "card-open",
  present: "present-open",
};

let lastHistoryState = historyState.closed;

function setStatus(message, kind = "") {
  status.textContent = message;
  status.className = `status ${kind}`.trim();
}

function clearResult() {
  result.replaceChildren();
  result.className = "result";
}

function presentClasses(resource) {
  const present = resource.present || {};
  return [
    "present",
    `present-${present.size || "medium"}`,
    `present-${present.color || "sage"}`,
    `present-${present.style || "ribbon"}`,
  ].join(" ");
}

function iconForType(type) {
  return {
    text: "T",
    image: "IMG",
    video: "▶",
    song: "♪",
  }[type] || "?";
}

function shuffledCopy(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function renderGreeting() {
  const greeting = randomGreeting();
  clearResult();

  const card = document.createElement("article");
  card.className = "greeting-card";

  const label = document.createElement("p");
  label.className = "language-label";
  label.textContent = greeting.language;

  const text = document.createElement("h2");
  if (typeof greeting.value === "string") {
    text.textContent = greeting.value;
    card.append(label, text);
  } else {
    text.textContent = greeting.value.text;
    text.dir = "rtl";
    const subtitleLine = document.createElement("p");
    subtitleLine.className = "subtitle";
    subtitleLine.textContent = greeting.value.subtitle;
    card.append(label, text, subtitleLine);
  }

  result.append(card);
}

function renderPresentButton(resource, number, isHidden = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = presentClasses(resource);
  button.dataset.resourceId = resource.id;

  const numberTag = document.createElement("span");
  numberTag.className = "present-number";
  numberTag.textContent = number;

  const bow = document.createElement("span");
  bow.className = "present-bow";
  bow.setAttribute("aria-hidden", "true");

  const label = document.createElement("span");
  label.className = "present-label";
  label.textContent = resource.title || (isHidden ? "Found memory" : "Memory present");

  const types = document.createElement("span");
  types.className = "present-icons";
  for (const type of [...new Set((resource.items || []).map((item) => item.type))]) {
    const icon = document.createElement("span");
    icon.className = `present-icon present-icon-${type}`;
    icon.textContent = iconForType(type);
    icon.title = type;
    types.append(icon);
  }

  button.append(numberTag, bow, types, label);
  button.addEventListener("click", () => openPresent(resource));
  presentGrid.append(button);
}

function renderVisiblePresents() {
  presentGrid.replaceChildren();
  const resources = shuffledCopy([
    ...(manifest.resources || []).filter((item) => item.visibility !== "hidden"),
    ...(manifest.resources || []).filter((item) => revealedHidden.has(item.id)),
  ]);
  let presentNumber = 1;
  for (const resource of resources) {
    renderPresentButton(resource, presentNumber, true);
    presentNumber += 1;
  }
  presentArea.hidden = false;
}

function showMemorySearchInCard() {
  form.hidden = true;
  memorySearchSlot.hidden = false;
  memorySearchSlot.append(memorySearchForm);
}

function showUnlockForm() {
  form.hidden = false;
  memorySearchSlot.hidden = true;
  presentHeader.append(memorySearchForm);
}

function scrollToPresentArea() {
  const isMobile = window.matchMedia("(max-width: 760px)").matches;
  masterPasswordInput.blur();
  const scroll = () => {
    memorySearchSlot.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  if (isMobile) {
    window.setTimeout(scroll, 260);
    return;
  }
  scroll();
}

function syncHistoryState(nextState, replace = false) {
  if (!window.history?.state || window.history.state.view !== nextState) {
    const method = replace ? "replaceState" : "pushState";
    window.history[method]({ view: nextState }, "");
  }
  lastHistoryState = nextState;
}

function closePresentDialogFromHistory() {
  if (presentDialog.open) {
    presentDialog.close();
  }
}

function closeCardFromHistory() {
  closePresentDialogFromHistory();
  masterKey = null;
  revealedHidden = new Set();
  document.body.classList.remove("presents-open");
  presentArea.hidden = true;
  showUnlockForm();
  if (foldToggle.checked) {
    foldToggle.checked = false;
  }
  openPresentsButton.disabled = false;
}

window.addEventListener("popstate", (event) => {
  const view = event.state?.view || historyState.closed;
  lastHistoryState = view;

  if (view === historyState.present) {
    return;
  }

  if (view === historyState.card) {
    closePresentDialogFromHistory();
    foldToggle.checked = true;
    return;
  }

  closeCardFromHistory();
});

async function decryptItem(item) {
  if (item.source.kind === "inline") {
    return decryptJson(item.source, masterKey);
  }

  if (item.source.kind === "file") {
    const response = await fetch(item.source.path, { cache: "no-store" });
    if (!response.ok) throw new Error(`Could not load ${item.source.path}`);
    const encryptedBytes = new Uint8Array(await response.arrayBuffer());
    const bytes = await decryptBytes({
      iv: item.source.iv,
      bytes: encryptedBytes,
    }, masterKey);
    return {
      blobUrl: URL.createObjectURL(new Blob([bytes], { type: item.source.mimeType })),
      mimeType: item.source.mimeType,
    };
  }

  throw new Error("Unknown resource source.");
}

function youtubeEmbedUrl(url) {
  try {
    const parsed = new URL(url, location.href);
    let videoId = parsed.searchParams.get("v");
    if (!videoId && parsed.hostname.includes("youtu.be")) {
      videoId = parsed.pathname.split("/").filter(Boolean)[0];
    }
    if (!videoId && parsed.pathname.includes("/embed/")) {
      videoId = parsed.pathname.split("/embed/")[1]?.split("/")[0];
    }
    if (!videoId) return "";

    const params = new URLSearchParams({
      autoplay: "1",
      enablejsapi: "1",
      playsinline: "1",
    });
    if (location.origin && location.origin !== "null") {
      params.set("origin", location.origin);
    }
    return `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?${params.toString()}`;
  } catch {
    return "";
  }
}

function commandSongPlayer(command) {
  const frame = songPlayerFrameSlot.querySelector("iframe");
  frame?.contentWindow?.postMessage(JSON.stringify({
    event: "command",
    func: command,
    args: [],
  }), "*");
}

function setSongPaused(paused) {
  songPaused = paused;
  songPlaybackToggle.textContent = paused ? "Resume song" : "Pause song";
  songPlaybackToggle.setAttribute("aria-pressed", String(paused));
}

function playSongHere(url, titleText = "Birthday song") {
  const embedUrl = youtubeEmbedUrl(url);
  if (!embedUrl) {
    window.open(url, "_blank", "noreferrer");
    return;
  }

  songPlayer.hidden = false;
  document.body.classList.add("song-player-open");
  songPlayerTitle.textContent = titleText;
  songPlayerLink.href = url;
  setSongPaused(false);

  if (activeSongUrl === url) {
    commandSongPlayer("playVideo");
    return;
  }

  activeSongUrl = url;
  songPlayerFrameSlot.replaceChildren();
  const frame = document.createElement("iframe");
  frame.src = embedUrl;
  frame.title = titleText;
  frame.allow = "autoplay; encrypted-media; picture-in-picture";
  frame.allowFullscreen = true;
  songPlayerFrameSlot.append(frame);
}

function dismissSongPlayer() {
  songPlayer.hidden = true;
  document.body.classList.remove("song-player-open");
  activeSongUrl = "";
  setSongPaused(false);
  songPlayerFrameSlot.replaceChildren();
}

async function openPresent(resource) {
  setStatus(`Opening ${resource.title || "present"}...`);
  presentContent.replaceChildren();

  try {
    const wrapper = document.createElement("article");
    wrapper.className = "resource-view";

    const heading = document.createElement("h2");
    heading.textContent = resource.title || "Memory present";
    wrapper.append(heading);

    for (const item of resource.items || []) {
      const payload = await decryptItem(item);
      const section = document.createElement("section");
      section.className = `resource-item ${item.meta?.fontStyle || ""}`.trim();

      if (item.type === "text") {
        const text = document.createElement("div");
        text.className = "text-surprise";
        text.textContent = payload.text || "";
        section.append(text);
      }

      if (item.type === "image") {
        const image = document.createElement("img");
        image.src = payload.blobUrl;
        image.alt = resource.title || "Birthday image";
        section.append(image);
      }

      if (item.type === "video") {
        const video = document.createElement("video");
        video.src = payload.blobUrl;
        video.controls = true;
        video.playsInline = true;
        section.append(video);
      }

      if (item.type === "song") {
        const actions = document.createElement("div");
        actions.className = "song-actions";

        const playButton = document.createElement("button");
        playButton.type = "button";
        playButton.className = "song-play";
        playButton.textContent = "Play here";
        playButton.addEventListener("click", () => playSongHere(payload.url, resource.title || "Birthday song"));

        const link = document.createElement("a");
        link.className = "song-link";
        link.href = payload.url;
        link.target = "_blank";
        link.rel = "noreferrer";
        link.textContent = "Open song on YouTube Music";
        actions.append(playButton, link);
        section.append(actions);
      }

      wrapper.append(section);
    }

    presentContent.append(wrapper);
    if (window.history.state?.view !== historyState.present) {
      syncHistoryState(historyState.present);
    }
    presentDialog.showModal();
    setStatus("Present opened.", "success");
  } catch (error) {
    setStatus("That present could not be opened with this password.", "error");
  }
}

async function searchMemory(event) {
  event.preventDefault();
  if (!masterKey) {
    setStatus("Open the presents with the master password first.", "error");
    return;
  }

  const phrase = memorySearchPhraseInput.value;
  if (!phrase.trim()) {
    memorySearchPhraseInput.focus();
    return;
  }

  const hidden = (manifest.resources || []).filter(
    (resource) => resource.visibility === "hidden" && !revealedHidden.has(resource.id)
  );

  if (hidden.length === 0) {
    setStatus("No hidden presents left to find.");
    return;
  }

  const phraseHash = await hashSecretPhrase(phrase);
  const found = hidden.find((resource) => resource.phraseHash === phraseHash);
  if (!found) {
    setStatus("No hidden present matched that memory phrase.");
    return;
  }

  revealedHidden.add(found.id);
  renderVisiblePresents();
  memorySearchPhraseInput.value = "";
  setStatus("You found a hidden memory present.", "success");
  openPresent(found);
}

async function loadManifest() {
  try {
    const response = await fetch("resources.encrypted.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    manifest = await response.json();
    if (manifest.version !== 2) {
      throw new Error("Manifest format needs to be rebuilt with builder.html.");
    }
    openPresentsButton.disabled = false;
    setStatus("");
  } catch (error) {
    const localFileHint = location.protocol === "file:"
      ? " Open this through a local server, for example http://localhost:8000/index.html."
      : "";
    setStatus(`Could not load resources.encrypted.json.${localFileHint}`, "error");
    manifest = { version: 2, resources: [], kdf: null };
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearResult();

  if (!manifest?.kdf) {
    renderGreeting();
    return;
  }

  setStatus("Opening the memory box. This is intentionally slow...");
  openPresentsButton.disabled = true;

  try {
    masterKey = await validateMasterPassword(masterPasswordInput.value, manifest);
    revealedHidden = new Set();
    renderVisiblePresents();
    showMemorySearchInCard();
    document.body.classList.add("presents-open");
    syncHistoryState(historyState.card);
    setStatus("Presents are open.", "success");
    scrollToPresentArea();
  } catch (error) {
    masterKey = null;
    document.body.classList.remove("presents-open");
    showUnlockForm();
    presentArea.hidden = true;
    setStatus("");
    renderGreeting();
  } finally {
    openPresentsButton.disabled = false;
  }
});

foldToggle.addEventListener("change", () => {
  if (foldToggle.checked) {
    window.setTimeout(() => masterPasswordInput.focus(), 180);
    return;
  }

  closePresentDialogFromHistory();
  if (window.history.state?.view === historyState.card) {
    window.history.back();
  }
});

toggleMasterPasswordButton.addEventListener("click", () => {
  const isHidden = masterPasswordInput.type === "password";
  masterPasswordInput.type = isHidden ? "text" : "password";
  toggleMasterPasswordButton.setAttribute("aria-label", isHidden ? "Hide password" : "Show password");
  toggleMasterPasswordButton.title = isHidden ? "Hide password" : "Show password";
  toggleMasterPasswordButton.classList.toggle("is-visible", isHidden);
});

memorySearchForm.addEventListener("submit", searchMemory);
closePresentButton.addEventListener("click", () => {
  presentDialog.close();
  if (window.history.state?.view === historyState.present) {
    window.history.back();
  }
});
presentDialog.addEventListener("click", (event) => {
  if (event.target === presentDialog) {
    presentDialog.close();
    if (window.history.state?.view === historyState.present) {
      window.history.back();
    }
  }
});
songPlaybackToggle.addEventListener("click", () => {
  if (songPaused) {
    commandSongPlayer("playVideo");
    setSongPaused(false);
    return;
  }
  commandSongPlayer("pauseVideo");
  setSongPaused(true);
});
dismissSongPlayerButton.addEventListener("click", dismissSongPlayer);

function showRandomTranslation() {
  const translation = randomEasterTranslation();
  title.textContent = translation.title;
  subtitle.textContent = translation.roman
    ? `${translation.subtitle} ${translation.roman}`
    : translation.subtitle;
  title.dir = translation.language === "Hebrew" ? "rtl" : "auto";
  subtitle.dir = translation.language === "Hebrew" ? "rtl" : "auto";
  setStatus(`Easter egg: ${translation.language}.`);
}

for (const element of [title, subtitle]) {
  element.addEventListener("click", showRandomTranslation);
  element.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      showRandomTranslation();
    }
  });
}

window.history.replaceState({ view: historyState.closed }, "");
loadManifest();
