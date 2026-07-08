const form = document.querySelector("#builderForm");
const resumeForm = document.querySelector("#resumeForm");
const rotatePasswordForm = document.querySelector("#rotatePasswordForm");
const passwordModal = document.querySelector("#passwordModal");
const closePasswordModalButton = document.querySelector("#closePasswordModal");
const masterEncryptionPanel = document.querySelector("#masterEncryptionPanel");
const masterPasswordInput = document.querySelector("#masterPassword");
const iterationsInput = document.querySelector("#iterations");
const resumeManifestInput = document.querySelector("#resumeManifest");
const resumeManifestPreview = document.querySelector("#resumeManifestPreview");
const resumeVaultFilesInput = document.querySelector("#resumeVaultFiles");
const resumeVaultFilesPreview = document.querySelector("#resumeVaultFilesPreview");
const resumeMasterPasswordInput = document.querySelector("#resumeMasterPassword");
const resumeSaveToFolderButton = document.querySelector("#saveResumedToFolder");
const existingManifestInput = document.querySelector("#existingManifest");
const existingVaultFilesInput = document.querySelector("#existingVaultFiles");
const currentMasterPasswordInput = document.querySelector("#currentMasterPassword");
const newMasterPasswordInput = document.querySelector("#newMasterPassword");
const addPresentButton = document.querySelector("#addPresent");
const saveToFolderButton = document.querySelector("#saveToFolder");
const resourceList = document.querySelector("#resourceList");
const template = document.querySelector("#resourceTemplate");
const status = document.querySelector("#builderStatus");
const downloadArea = document.querySelector("#downloadArea");
const mediaPreviewDialog = document.querySelector("#mediaPreviewDialog");
const mediaPreviewContent = document.querySelector("#mediaPreviewContent");
const closeMediaPreviewButton = document.querySelector("#closeMediaPreview");
const {
  createKdf,
  decryptBytes,
  decryptJson,
  deriveMasterKey,
  encryptBytes,
  encryptJson,
  hashSecretPhrase,
  makeId,
  validateMasterPassword,
} = window.VaultCrypto;

let nextId = 1;
let lastBuild = null;
let lastResumed = null;
const editorState = new WeakMap();

const randomOptions = {
  size: ["small", "medium", "large", "tall"],
  color: ["sage", "white", "mint", "emerald", "gold"],
  style: ["ribbon", "dots", "stripe", "botanical"],
  font: ["elegant", "handwritten", "playful", "cinematic", "garden"],
};

function pick(values) {
  return values[Math.floor(Math.random() * values.length)];
}

function setStatus(message, kind = "") {
  status.textContent = message;
  status.className = `status ${kind}`.trim();
}

function nextPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function fileNames(fileList) {
  return [...(fileList || [])].map((file) => file.name);
}

function renderLoadedFilePreview(container, names, detail) {
  if (!container) return;
  container.replaceChildren();

  const card = document.createElement("div");
  card.className = "loaded-file-card";

  const icon = document.createElement("span");
  icon.className = "loaded-file-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "✓";

  const body = document.createElement("div");
  body.className = "loaded-file-body";

  const title = document.createElement("strong");
  title.className = "loaded-file-title";
  title.textContent = names.length === 1 ? names[0] : `${names.length} files`;

  const subtitle = document.createElement("span");
  subtitle.className = "loaded-file-detail";
  subtitle.textContent = detail;

  body.append(title, subtitle);
  card.append(icon, body);
  container.append(card);
}

function updateResumeSourceNotes() {
  if (resumeManifestInput.files?.length) {
    renderLoadedFilePreview(
      resumeManifestPreview,
      [resumeManifestInput.files[0].name],
      "Selected manually. Replaces the auto-loaded manifest."
    );
  } else {
    renderLoadedFilePreview(
      resumeManifestPreview,
      ["resources.encrypted.json"],
      "Loaded from disk when available."
    );
  }

  if (resumeVaultFilesInput.files?.length) {
    renderLoadedFilePreview(
      resumeVaultFilesPreview,
      fileNames(resumeVaultFilesInput.files),
      fileNames(resumeVaultFilesInput.files).length === 1
        ? "Selected manually. Replaces the auto-loaded vault file."
        : "Selected manually. Replaces the auto-loaded vault files."
    );
  } else {
    renderLoadedFilePreview(
      resumeVaultFilesPreview,
      ["resources/*.vault"],
      "Matching encrypted media files load from disk when available."
    );
  }
}

function setupPasswordToggles() {
  for (const button of document.querySelectorAll("[data-toggle-password]")) {
    const input = document.querySelector(button.dataset.togglePassword);
    if (!input) continue;
    button.addEventListener("click", () => {
      const isHidden = input.type === "password";
      input.type = isHidden ? "text" : "password";
      button.setAttribute("aria-label", isHidden ? "Hide password" : "Show password");
      button.title = isHidden ? "Hide password" : "Show password";
      button.classList.toggle("is-visible", isHidden);
    });
  }
}

function setupStylePreview(container) {
  const select = container.querySelector(".resource-style");
  const preview = container.querySelector(".font-preview");
  if (!select || !preview) return;

  function updatePreview() {
    preview.className = `font-preview ${select.value}`;
  }

  select.addEventListener("change", updatePreview);
  updatePreview();
}

function setupVisibilityHint(container) {
  const visibility = container.querySelector(".resource-hidden");
  const phrase = container.querySelector(".resource-phrase");
  const phraseField = container.querySelector(".secret-phrase-field");
  const hint = container.querySelector(".field-hint");
  if (!visibility || !phrase || !phraseField || !hint) return;

  function updateHint() {
    const hidden = visibility.checked;
    phraseField.classList.toggle("is-active", hidden);
    hint.textContent = hidden
      ? "Phrase matching ignores case and spaces."
      : "Leave blank after resume to keep existing phrase.";
  }

  visibility.addEventListener("change", updateHint);
  phrase.addEventListener("input", () => {
    if (phrase.value.trim() && !visibility.checked) {
      visibility.checked = true;
    }
    updateHint();
  });
  updateHint();
}

function setupAdvancedDialog(container) {
  const button = container.querySelector(".advanced-toggle");
  const dialog = container.querySelector(".advanced-dialog");
  if (!button || !dialog) return;

  button.addEventListener("click", () => dialog.showModal());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
}

function openMediaPreview({ type, bytes, mimeType, title }) {
  mediaPreviewContent.replaceChildren();
  const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  const media = type === "video" ? document.createElement("video") : document.createElement("img");
  media.src = url;
  if (type === "video") {
    media.controls = true;
    media.playsInline = true;
  } else {
    media.alt = title || "Loaded image preview";
  }
  media.addEventListener("load", () => URL.revokeObjectURL(url), { once: true });
  media.addEventListener("loadeddata", () => URL.revokeObjectURL(url), { once: true });
  mediaPreviewContent.append(media);
  mediaPreviewDialog.showModal();
}

function removeExistingPreviewButton(box) {
  box.querySelector(".media-preview-button")?.remove();
}

function addPreviewButton(box, type, preview) {
  removeExistingPreviewButton(box);
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ghost media-preview-button";
  button.textContent = `Preview ${type}`;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openMediaPreview({ type, ...preview });
  });
  box.append(button);
}

async function filePreviewPayload(file) {
  return {
    bytes: await readFileAsBytes(file),
    mimeType: file.type,
    title: file.name,
  };
}

function setMediaBoxState(input, type, label, preview = null) {
  const box = input.closest(".media-box");
  const placeholder = box?.querySelector(".media-placeholder");
  const state = box?.querySelector(".media-state");
  if (!box || !placeholder || !state) return;

  box.classList.toggle("has-media", Boolean(preview));
  placeholder.textContent = label;
  state.textContent = preview ? "Loaded. Choose another file to replace." : `No ${type} yet`;
  removeExistingPreviewButton(box);
  if (preview) addPreviewButton(box, type, preview);
}

function addLoadedMediaControl(input, type, media, title) {
  const note = document.createElement("span");
  if (media.bytes) {
    setMediaBoxState(input, type, `Loaded ${type}`, { title, ...media });
    return;
  }

  note.className = "stored-file-note";
  note.textContent = `Existing ${type} was not loaded. Choose a replacement file before rebuilding.`;
  input.closest(".media-box")?.append(note);
}

function setupMediaBox(input, type) {
  if (!input) return;
  input.addEventListener("change", async () => {
    const file = input.files[0];
    if (!file) {
      setMediaBoxState(input, type, `Add ${type}`, null);
      return;
    }
    setMediaBoxState(input, type, file.name, await filePreviewPayload(file));
  });
}

function setupSongState(container) {
  const song = container.querySelector(".resource-song");
  const box = container.querySelector(".song-box");
  const state = container.querySelector(".song-state");
  const link = container.querySelector(".song-link-preview");
  if (!song || !box || !state || !link) return;

  function updateSongState() {
    const url = song.value.trim();
    const hasSong = Boolean(url);
    box.classList.toggle("has-song", hasSong);
    state.textContent = hasSong ? "Song link added" : "No song link yet";
    link.hidden = !hasSong;
    if (hasSong) link.href = url;
  }

  song.addEventListener("input", updateSongState);
  updateSongState();
}

function addPresent(existing = null, { prepend = false } = {}) {
  const fragment = template.content.cloneNode(true);
  const editor = fragment.querySelector(".resource-editor");
  const fallbackTitle = existing?.title || `Present ${nextId}`;
  nextId += 1;

  fragment.querySelector(".resource-name").value = existing?.title || fallbackTitle;
  fragment.querySelector(".resource-hidden").checked = existing?.visibility === "hidden";
  fragment.querySelector(".present-size").value = existing?.present?.size || pick(randomOptions.size);
  fragment.querySelector(".present-color").value = existing?.present?.color || pick(randomOptions.color);
  fragment.querySelector(".present-style").value = existing?.present?.style || pick(randomOptions.style);
  fragment.querySelector(".resource-style").value = existing?.fontStyle || pick(randomOptions.font);
  fragment.querySelector(".resource-text").value = existing?.text || "";
  fragment.querySelector(".resource-song").value = existing?.song || "";
  fragment.querySelector(".resource-phrase").value = existing?.phrase || "";

  const phrase = fragment.querySelector(".resource-phrase");
  if (existing?.phraseHash) {
    phrase.placeholder = "Leave blank to keep existing hidden phrase";
  }

  fragment.querySelector(".remove-resource").addEventListener("click", () => editor.remove());
  setupStylePreview(fragment);
  setupVisibilityHint(fragment);
  setupAdvancedDialog(fragment);
  setupMediaBox(fragment.querySelector(".resource-image"), "image");
  setupMediaBox(fragment.querySelector(".resource-video"), "video");
  setupSongState(fragment);
  editorState.set(editor, {
    id: existing?.id || null,
    phraseHash: existing?.phraseHash || null,
    encryptedPhrase: existing?.encryptedPhrase || null,
    image: existing?.image || null,
    video: existing?.video || null,
  });

  for (const type of ["image", "video"]) {
    const input = fragment.querySelector(`.resource-${type}`);
    if (!input || !existing?.[type]) continue;
    addLoadedMediaControl(input, type, existing[type], fallbackTitle);
  }

  if (prepend && resourceList.firstChild) {
    resourceList.prepend(fragment);
    editor.scrollIntoView({ behavior: "smooth", block: "start" });
  } else {
    resourceList.append(fragment);
  }
  return editor;
}

function readFileAsBytes(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(new Uint8Array(reader.result)));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsArrayBuffer(file);
  });
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsText(file);
  });
}

async function readUrlAsText(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Could not load ${url}.`);
  }
  return response.text();
}

async function readUrlAsBytes(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Could not load ${url}.`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

function safeFileName(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "present";
}

async function publicResourceFromEditor(editor, id, aesBytes) {
  const state = editorState.get(editor) || {};
  const visibility = editor.querySelector(".resource-hidden").checked ? "hidden" : "visible";
  const phrase = editor.querySelector(".resource-phrase").value.trim();
  if (visibility === "hidden" && !phrase.trim() && !state.phraseHash) {
    throw new Error("Hidden presents need a secret phrase.");
  }

  return {
    id,
    title: editor.querySelector(".resource-name").value.trim() || "Memory present",
    visibility,
    phraseHash: visibility === "hidden"
      ? (phrase ? await hashSecretPhrase(phrase) : state.phraseHash)
      : null,
    encryptedPhrase: visibility === "hidden"
      ? (phrase ? await encryptJson({ phrase }, aesBytes) : state.encryptedPhrase)
      : null,
    present: {
      size: editor.querySelector(".present-size").value,
      color: editor.querySelector(".present-color").value,
      style: editor.querySelector(".present-style").value,
    },
    items: [],
  };
}

async function encryptedFileItem({ file, type, title, id, aesBytes }) {
  return encryptedBytesItem({
    bytes: await readFileAsBytes(file),
    type,
    title,
    id,
    aesBytes,
    mimeType: file.type,
    originalName: file.name,
  });
}

async function encryptedBytesItem({ bytes, type, title, id, aesBytes, mimeType, originalName, path = null }) {
  const encrypted = await encryptBytes(bytes, aesBytes);
  const fileName = path ? path.split("/").pop() : `${safeFileName(title)}-${type}-${id}.vault`;
  return {
    item: {
      type,
      source: {
        kind: "file",
        path: path || `resources/${fileName}`,
        iv: encrypted.iv,
        mimeType,
        originalName,
      },
    },
    fileDownload: {
      path: `resources/${fileName}`,
      name: fileName,
      blob: new Blob([encrypted.bytes], { type: "application/octet-stream" }),
    },
  };
}

async function buildResource(editor, aesBytes, reportProgress = () => {}) {
  const state = editorState.get(editor) || {};
  const id = state.id || makeId();
  const resource = await publicResourceFromEditor(editor, id, aesBytes);
  const files = [];

  const text = editor.querySelector(".resource-text").value.trim();
  if (text) {
    reportProgress(`Encrypting text for ${resource.title}...`);
    await nextPaint();
    resource.items.push({
      type: "text",
      meta: { fontStyle: editor.querySelector(".resource-style").value },
      source: {
        kind: "inline",
        ...(await encryptJson({ text }, aesBytes)),
      },
    });
  }

  const image = editor.querySelector(".resource-image").files[0];
  if (image) {
    reportProgress(`Encrypting image for ${resource.title}...`);
    await nextPaint();
    const output = await encryptedFileItem({ file: image, type: "image", title: resource.title, id, aesBytes });
    resource.items.push(output.item);
    files.push(output.fileDownload);
  } else if (state.image?.bytes) {
    reportProgress(`Re-encrypting image for ${resource.title}...`);
    await nextPaint();
    const output = await encryptedBytesItem({
      ...state.image,
      type: "image",
      title: resource.title,
      id,
      aesBytes,
    });
    resource.items.push(output.item);
    files.push(output.fileDownload);
  } else if (state.image) {
    throw new Error(`${resource.title} has an existing image that was not loaded. Select the .vault file or choose a replacement image.`);
  }

  const video = editor.querySelector(".resource-video").files[0];
  if (video) {
    reportProgress(`Encrypting video for ${resource.title}...`);
    await nextPaint();
    const output = await encryptedFileItem({ file: video, type: "video", title: resource.title, id, aesBytes });
    resource.items.push(output.item);
    files.push(output.fileDownload);
  } else if (state.video?.bytes) {
    reportProgress(`Re-encrypting video for ${resource.title}...`);
    await nextPaint();
    const output = await encryptedBytesItem({
      ...state.video,
      type: "video",
      title: resource.title,
      id,
      aesBytes,
    });
    resource.items.push(output.item);
    files.push(output.fileDownload);
  } else if (state.video) {
    throw new Error(`${resource.title} has an existing video that was not loaded. Select the .vault file or choose a replacement video.`);
  }

  const url = editor.querySelector(".resource-song").value.trim();
  if (url) {
    if (!url.startsWith("https://music.youtube.com/")) {
      throw new Error(`${resource.title} must use a https://music.youtube.com/ song link.`);
    }
    reportProgress(`Encrypting song link for ${resource.title}...`);
    await nextPaint();
    resource.items.push({
      type: "song",
      source: {
        kind: "inline",
        ...(await encryptJson({ url }, aesBytes)),
      },
    });
  }

  if (resource.items.length === 0) {
    throw new Error(`${resource.title} needs at least one text, image, video, or song item.`);
  }

  return { resource, files };
}

function addDownloadLink({ href, download, text }) {
  const link = document.createElement("a");
  link.href = href;
  link.download = download;
  link.textContent = text;
  link.className = "download-link";
  downloadArea.append(link);
}

function renderDownloads(manifest, files) {
  downloadArea.replaceChildren();

  const manifestBlob = new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" });
  addDownloadLink({
    href: URL.createObjectURL(manifestBlob),
    download: "resources.encrypted.json",
    text: "Download resources.encrypted.json",
  });

  for (const file of files) {
    addDownloadLink({
      href: URL.createObjectURL(file.blob),
      download: file.name,
      text: `Download ${file.path}`,
    });
  }

  if ("showDirectoryPicker" in window) {
    saveToFolderButton.disabled = false;
    saveToFolderButton.title = "Choose the folder that contains index.html. Media files will be written under resources/.";
  } else {
    saveToFolderButton.disabled = true;
    saveToFolderButton.title = "Direct folder save is not supported by this browser. Use the download links.";
  }
}

function filesByName(fileList) {
  const files = new Map();
  for (const file of fileList || []) {
    files.set(file.name, file);
  }
  return files;
}

function selectedVaultFilesByName() {
  return filesByName(existingVaultFilesInput.files);
}

async function decryptFileItemForResume(item, aesBytes, vaultFiles) {
  const fileName = item.source.path?.split("/").pop();
  let bytes = null;
  const base = {
    mimeType: item.source.mimeType,
    originalName: item.source.originalName,
    path: item.source.path,
  };

  try {
    bytes = await readUrlAsBytes(item.source.path);
  } catch {
    const file = fileName ? vaultFiles.get(fileName) : null;
    if (file) {
      bytes = await readFileAsBytes(file);
    }
  }

  if (!bytes) {
    return { ...base, missing: true };
  }

  return {
    ...base,
    bytes: await decryptBytes({
      iv: item.source.iv,
      bytes,
    }, aesBytes),
  };
}

async function draftResourceForResume(resource, aesBytes, vaultFiles) {
  const draft = {
    id: resource.id,
    title: resource.title || "",
    visibility: resource.visibility || "visible",
    phraseHash: resource.phraseHash || null,
    encryptedPhrase: resource.encryptedPhrase || null,
    phrase: "",
    present: resource.present || {},
    fontStyle: "elegant",
    text: "",
    song: "",
    image: null,
    video: null,
  };

  if (resource.encryptedPhrase) {
    const payload = await decryptJson(resource.encryptedPhrase, aesBytes);
    draft.phrase = payload.phrase || "";
  }

  for (const item of resource.items || []) {
    if (item.source.kind === "inline") {
      const payload = await decryptJson(item.source, aesBytes);
      if (item.type === "text") {
        draft.text = payload.text || "";
        draft.fontStyle = item.meta?.fontStyle || draft.fontStyle;
      } else if (item.type === "song") {
        draft.song = payload.url || "";
      }
    } else if (item.source.kind === "file" && (item.type === "image" || item.type === "video")) {
      draft[item.type] = await decryptFileItemForResume(item, aesBytes, vaultFiles);
    }
  }

  return draft;
}

async function resumeBuild(event) {
  event.preventDefault();
  downloadArea.replaceChildren();
  saveToFolderButton.disabled = true;
  lastBuild = null;
  lastResumed = null;
  resumeSaveToFolderButton.disabled = true;
  document.body.classList.remove("resume-active");

  const submit = resumeForm.querySelector("button[type='submit']");
  submit.disabled = true;
  setStatus("Opening the previous encrypted build...");
  await nextPaint();

  try {
    const manifestFile = resumeManifestInput.files[0];
    const manifestText = manifestFile
      ? await readFileAsText(resumeManifestInput.files[0])
      : await readUrlAsText("resources.encrypted.json");
    const manifest = JSON.parse(manifestText);
    if (manifest.version !== 2) {
      throw new Error("Only v2 manifests can be resumed here.");
    }

    const aesBytes = await validateMasterPassword(resumeMasterPasswordInput.value, manifest);
    const vaultFiles = filesByName(resumeVaultFilesInput.files);
    const drafts = [];
    const resumedFilesByPath = new Map();

    for (const resource of manifest.resources || []) {
      setStatus(`Loading ${resource.title || "present"}...`);
      await nextPaint();
      drafts.push(await draftResourceForResume(resource, aesBytes, vaultFiles));
      for (const item of resource.items || []) {
        if (item.source.kind !== "file") continue;
        const fileName = item.source.path.split("/").pop();
        if (resumedFilesByPath.has(item.source.path)) continue;

        const uploaded = vaultFiles.get(fileName);
        if (uploaded) {
          resumedFilesByPath.set(item.source.path, {
            name: fileName,
            blob: new Blob([await readFileAsBytes(uploaded)], { type: "application/octet-stream" }),
          });
          continue;
        }

        const response = await fetch(item.source.path, { cache: "no-store" });
        if (!response.ok) continue;
        resumedFilesByPath.set(item.source.path, {
          name: fileName,
          blob: await response.blob(),
        });
      }
    }

    resourceList.replaceChildren();
    nextId = 1;
    for (const draft of drafts) addPresent(draft);

    renderLoadedFilePreview(
      resumeManifestPreview,
      [resumeManifestInput.files[0]?.name || "resources.encrypted.json"],
      resumeManifestInput.files[0]
        ? "Selected manually. Replaces the auto-loaded manifest."
        : "Loaded from disk."
    );
    renderLoadedFilePreview(
      resumeVaultFilesPreview,
      resumeVaultFilesInput.files?.length ? fileNames(resumeVaultFilesInput.files) : ["resources/*.vault"],
      resumeVaultFilesInput.files?.length
        ? (resumeVaultFilesInput.files.length === 1
          ? "Selected manually. Replaces the auto-loaded vault file."
          : "Selected manually. Replaces the auto-loaded vault files.")
        : "Loaded from disk."
    );

    masterPasswordInput.value = resumeMasterPasswordInput.value;
    iterationsInput.value = manifest.kdf?.iterations || iterationsInput.value;
    masterEncryptionPanel.hidden = true;
    document.body.classList.add("resume-active");
    lastResumed = {
      manifestText,
      manifest,
      files: [...resumedFilesByPath.values()],
    };
    resumeSaveToFolderButton.disabled = false;

    const missingMedia = drafts.filter((draft) => draft.image?.missing || draft.video?.missing).length;
    const missingMessage = missingMedia
      ? ` ${missingMedia} present(s) have media that was not selected; choose the .vault file or a replacement before rebuilding.`
      : "";
    setStatus(`Resumed ${drafts.length} present(s).${missingMessage}`, "success");
  } catch (error) {
    document.body.classList.remove("resume-active");
    setStatus(error.message || "Could not resume that encrypted build.", "error");
  } finally {
    submit.disabled = false;
  }
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

async function rotateFileItem(item, oldKey, newKey, vaultFiles, files) {
  const fileName = item.source.path.split("/").pop();
  const file = vaultFiles.get(fileName);
  if (!file) {
    throw new Error(`Select existing encrypted media file ${fileName}.`);
  }

  const decryptedBytes = await decryptBytes({
    iv: item.source.iv,
    bytes: await readFileAsBytes(file),
  }, oldKey);
  const encrypted = await encryptBytes(decryptedBytes, newKey);
  files.push({
    path: item.source.path,
    name: fileName,
    blob: new Blob([encrypted.bytes], { type: "application/octet-stream" }),
  });

  return {
    ...item,
    source: {
      ...item.source,
      iv: encrypted.iv,
    },
  };
}

async function rotateResource(resource, oldKey, newKey, vaultFiles, files) {
  const rotated = {
    ...resource,
    items: [],
  };

  for (const item of resource.items || []) {
    if (item.source.kind === "inline") {
      rotated.items.push(await rotateInlineItem(item, oldKey, newKey));
    } else if (item.source.kind === "file") {
      rotated.items.push(await rotateFileItem(item, oldKey, newKey, vaultFiles, files));
    } else {
      throw new Error(`Unknown source kind for ${resource.title}.`);
    }
  }

  return rotated;
}

async function rotateMasterPassword(event) {
  event.preventDefault();
  downloadArea.replaceChildren();
  saveToFolderButton.disabled = true;
  lastBuild = null;

  const submit = rotatePasswordForm.querySelector("button[type='submit']");
  submit.disabled = true;
  setStatus("Changing master password. This may take a while...");

  try {
    const existingManifest = JSON.parse(await readFileAsText(existingManifestInput.files[0]));
    if (existingManifest.version !== 2) {
      throw new Error("Only v2 manifests can have their master password changed here.");
    }

    const oldKey = await validateMasterPassword(currentMasterPasswordInput.value, existingManifest);
    const newKdf = createKdf(iterationsInput.value);
    const newKey = await deriveMasterKey(newMasterPasswordInput.value, newKdf);
    const vaultFiles = selectedVaultFilesByName();
    const files = [];
    const manifest = {
      ...existingManifest,
      createdAt: new Date().toISOString(),
      rotatedAt: new Date().toISOString(),
      kdf: newKdf,
      verifier: await encryptJson({ ok: true }, newKey),
      resources: [],
    };

    for (const resource of existingManifest.resources || []) {
      manifest.resources.push(await rotateResource(resource, oldKey, newKey, vaultFiles, files));
    }

    lastBuild = { manifest, files };
    renderDownloads(manifest, files);
    setStatus(`Master password changed for ${manifest.resources.length} present(s).`, "success");
  } catch (error) {
    setStatus(error.message || "Could not change the master password.", "error");
  } finally {
    submit.disabled = false;
  }
}

async function writeFile(handle, name, blob) {
  const fileHandle = await handle.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}

async function saveBuildToFolder() {
  if (!lastBuild) {
    setStatus("Build encrypted downloads first.", "error");
    return;
  }
  if (!("showDirectoryPicker" in window)) {
    setStatus("This browser cannot save directly to a chosen folder. Use the download links instead.", "error");
    return;
  }

  try {
    const rootHandle = await window.showDirectoryPicker({ mode: "readwrite" });
    await writeFile(
      rootHandle,
      "resources.encrypted.json",
      new Blob([JSON.stringify(lastBuild.manifest, null, 2)], { type: "application/json" })
    );
    const resourcesHandle = await rootHandle.getDirectoryHandle("resources", { create: true });
    for (const file of lastBuild.files) {
      await writeFile(resourcesHandle, file.name, file.blob);
    }
    setStatus("Saved manifest and encrypted media files into the chosen folder.", "success");
  } catch (error) {
    setStatus(error.name === "AbortError" ? "Folder save cancelled." : "Could not save to that folder.", "error");
  }
}

async function buildCurrentResources() {
  const editors = [...resourceList.querySelectorAll(".resource-editor")];
  if (editors.length === 0) {
    throw new Error("Add at least one present before building.");
  }

  const kdf = createKdf(iterationsInput.value);
  setStatus("Deriving the master key...");
  await nextPaint();
  const aesBytes = await deriveMasterKey(masterPasswordInput.value, kdf);
  const manifest = {
    version: 2,
    createdAt: new Date().toISOString(),
    kdf,
    verifier: await encryptJson({ ok: true }, aesBytes),
    resources: [],
  };
  const files = [];

  for (const editor of editors) {
    const output = await buildResource(editor, aesBytes, (message) => setStatus(message));
    manifest.resources.push(output.resource);
    files.push(...output.files);
  }

  return { manifest, files };
}

async function saveResumedToFolder() {
  if (!lastResumed) {
    setStatus("Resume a build first.", "error");
    return;
  }

  resumeSaveToFolderButton.disabled = true;
  try {
    const build = await buildCurrentResources();
    lastBuild = build;
    lastResumed = {
      manifestText: JSON.stringify(build.manifest, null, 2),
      manifest: build.manifest,
      files: build.files,
    };

    if (!("showDirectoryPicker" in window)) {
      renderDownloads(build.manifest, build.files);
      setStatus("Direct folder save is not supported here. Use the download links below.", "success");
      return;
    }

    const rootHandle = await window.showDirectoryPicker({ mode: "readwrite" });
    await writeFile(
      rootHandle,
      "resources.encrypted.json",
      new Blob([lastResumed.manifestText], { type: "application/json" })
    );
    const resourcesHandle = await rootHandle.getDirectoryHandle("resources", { create: true });
    for (const file of lastResumed.files) {
      await writeFile(resourcesHandle, file.name, file.blob);
    }
    setStatus("Saved the rebuilt manifest and encrypted media files into the chosen folder.", "success");
  } catch (error) {
    setStatus(error.name === "AbortError" ? "Folder save cancelled." : "Could not save to that folder.", "error");
  } finally {
    resumeSaveToFolderButton.disabled = false;
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  downloadArea.replaceChildren();
  saveToFolderButton.disabled = true;
  lastBuild = null;

  const submit = form.querySelector("button[type='submit']");
  submit.disabled = true;
  setStatus("Encrypting presents. This may take a while...");

  try {
    lastBuild = await buildCurrentResources();
    renderDownloads(lastBuild.manifest, lastBuild.files);
    const saveHint = "showDirectoryPicker" in window
      ? " You can also use Save directly to folder."
      : " Direct folder save is not supported here; use the download links.";
    setStatus(`Encrypted ${lastBuild.manifest.resources.length} present(s).${saveHint}`, "success");
  } catch (error) {
    setStatus(error.message || "Could not build encrypted resources.", "error");
  } finally {
    submit.disabled = false;
  }
});

addPresentButton.addEventListener("click", () => addPresent(null, { prepend: true }));
saveToFolderButton.addEventListener("click", saveBuildToFolder);
resumeSaveToFolderButton.addEventListener("click", saveResumedToFolder);
closeMediaPreviewButton.addEventListener("click", () => mediaPreviewDialog.close());
mediaPreviewDialog.addEventListener("click", (event) => {
  if (event.target === mediaPreviewDialog) mediaPreviewDialog.close();
});
for (const button of document.querySelectorAll(".open-password-modal")) {
  button.addEventListener("click", () => passwordModal.showModal());
}
closePasswordModalButton.addEventListener("click", () => passwordModal.close());
passwordModal.addEventListener("click", (event) => {
  if (event.target === passwordModal) passwordModal.close();
});
resumeForm.addEventListener("submit", resumeBuild);
rotatePasswordForm.addEventListener("submit", rotateMasterPassword);
resumeManifestInput.addEventListener("change", updateResumeSourceNotes);
resumeVaultFilesInput.addEventListener("change", updateResumeSourceNotes);
setupPasswordToggles();
updateResumeSourceNotes();

addPresent();
