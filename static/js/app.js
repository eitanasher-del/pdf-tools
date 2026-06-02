/**
 * PDF Tools — Frontend Application
 * Vanilla JS, no build step required.
 */

"use strict";

// ============================================================
//  Tool Configurations
// ============================================================

const TOOLS = {
  "merge": {
    title: "Merge PDFs",
    description: "Combine multiple PDF files into one document. Add your files below and arrange them in the order you want.",
    endpoint: "/api/merge",
    acceptedTypes: [".pdf"],
    acceptAttr: ".pdf",
    hint: "Accepts: PDF files  •  Drag to reorder",
    minFiles: 2,
    multiFile: true,
    submitLabel: "Merge PDFs",
  },
  "slice": {
    title: "Slice PDF",
    description: "Extract specific pages into one PDF, or split the document into multiple files.",
    endpoint: "/api/slice",
    acceptedTypes: [".pdf"],
    acceptAttr: ".pdf",
    hint: "Accepts: PDF files",
    minFiles: 1,
    multiFile: false,
    submitLabel: "Slice PDF",
  },
  "rotate": {
    title: "Rotate Pages",
    description: "Rotate all or specific pages of a PDF by 90°, 180°, or 270°.",
    endpoint: "/api/rotate",
    acceptedTypes: [".pdf"],
    acceptAttr: ".pdf",
    hint: "Accepts: PDF files",
    minFiles: 1,
    multiFile: false,
    submitLabel: "Rotate & Save",
  },
  "compress": {
    title: "Compress PDF",
    description: "Reduce the file size of a PDF by compressing streams and re-encoding embedded images.",
    endpoint: "/api/compress",
    acceptedTypes: [".pdf"],
    acceptAttr: ".pdf",
    hint: "Accepts: PDF files",
    minFiles: 1,
    multiFile: false,
    submitLabel: "Compress PDF",
  },
  "convert": {
    title: "Convert",
    description: "Convert any file to a different format — images to PDF, PDF to images, or any image format to another.",
    endpoint: "/api/convert",
    acceptedTypes: [".pdf"],        // updated dynamically when From changes
    acceptAttr: ".pdf",             // updated dynamically
    hint: "Select a format above, then drop your file(s) here",
    minFiles: 1,
    multiFile: true,                // depends on direction; enforced by route
    submitLabel: "Convert",
  },
  "merge-images": {
    title: "Merge Images",
    description: "Stitch multiple images into one single JPEG — stack them vertically (top to bottom) or horizontally (side by side).",
    endpoint: "/api/merge-images",
    acceptedTypes: [".jpg", ".jpeg", ".png", ".bmp", ".gif", ".tiff", ".tif", ".webp"],
    acceptAttr: ".jpg,.jpeg,.png,.bmp,.gif,.tiff,.tif,.webp",
    hint: "Accepts: JPG, PNG, BMP, GIF, TIFF  •  Drag to reorder",
    minFiles: 2,
    multiFile: true,
    submitLabel: "Merge Images",
  },
};

// ============================================================
//  Convert Tool — Format Matrix
// ============================================================

const CONVERT_TARGETS = {
  "pdf":  ["jpg", "png"],
  "jpg":  ["png", "bmp", "tiff", "webp", "gif", "pdf"],
  "png":  ["jpg", "bmp", "tiff", "webp", "gif", "pdf"],
  "bmp":  ["jpg", "png", "tiff", "webp", "pdf"],
  "tiff": ["jpg", "png", "bmp", "webp", "pdf"],
  "webp": ["jpg", "png", "bmp", "tiff", "pdf"],
  "gif":  ["jpg", "png", "bmp", "pdf"],
};

const FORMAT_LABELS = {
  pdf:  "PDF Document",
  jpg:  "JPG Image",
  png:  "PNG Image",
  bmp:  "BMP Image",
  tiff: "TIFF Image",
  webp: "WebP Image",
  gif:  "GIF Image",
};

const IMAGE_ACCEPT = ".jpg,.jpeg,.png,.bmp,.gif,.tiff,.tif,.webp";

// ============================================================
//  Application State
// ============================================================

const state = {
  activeTool: "merge",
  files: [],       // Array of File objects in display order
  processing: false,
  dragOverIdx: -1,
  dragSrcIdx: -1,
};

// ============================================================
//  DOM References
// ============================================================

const $ = id => document.getElementById(id);

const els = {
  navItems:       document.querySelectorAll(".nav-item"),
  toolTitle:      $("tool-title"),
  toolDesc:       $("tool-description"),
  dropZone:       $("drop-zone"),
  dropZoneEmpty:  $("drop-zone-empty"),
  dropZoneProc:   $("drop-zone-processing"),
  dropHint:       $("drop-hint"),
  fileInput:      $("file-input"),
  browseBtn:      $("browse-btn"),
  fileListCont:   $("file-list-container"),
  fileCountLabel: $("file-count-label"),
  fileList:       $("file-list"),
  clearAllBtn:    $("clear-all-btn"),
  addMoreBtn:     $("add-more-btn"),
  optionsPanel:   $("options-panel"),
  actionRow:      $("action-row"),
  submitBtn:      $("submit-btn"),
  submitBtnText:  $("submit-btn-text"),
  resultPanel:    $("result-panel"),
  resultFilename: $("result-filename"),
  downloadLink:   $("download-link"),
  processAnotherBtn: $("process-another-btn"),
  toastContainer: $("toast-container"),
  filenameRow:    $("filename-row"),
  filenameInput:  $("output-filename"),
};

// ============================================================
//  Tool Switching
// ============================================================

function setActiveTool(toolName) {
  if (!TOOLS[toolName]) return;
  state.activeTool = toolName;
  state.files = [];

  const tool = TOOLS[toolName];

  // Update sidebar
  els.navItems.forEach(item => {
    item.classList.toggle("active", item.dataset.tool === toolName);
    item.setAttribute("aria-current", item.dataset.tool === toolName ? "page" : "false");
  });

  // Update header
  els.toolTitle.textContent = tool.title;
  els.toolDesc.textContent = tool.description;
  els.dropHint.textContent = tool.hint;

  // Update file input accept
  els.fileInput.accept = tool.acceptAttr;
  els.fileInput.multiple = tool.multiFile;

  // Reset UI areas
  renderFileList();
  renderOptions(toolName);
  hideResult();
  resetDropZone();
  updateSubmitButton();
}

// ============================================================
//  Drop Zone
// ============================================================

function resetDropZone() {
  els.dropZone.classList.remove("drag-over", "has-files");
  els.dropZoneEmpty.hidden = false;
  els.dropZoneProc.hidden = true;
}

function setProcessingState(on) {
  state.processing = on;
  els.dropZone.classList.toggle("has-files", state.files.length > 0 && !on);
  if (on) {
    els.dropZoneEmpty.hidden = true;
    els.dropZoneProc.hidden = false;
    els.fileListCont.hidden = true;
    els.actionRow.hidden = true;
    els.filenameRow.hidden = true;
    els.optionsPanel.style.opacity = "0.4";
    els.optionsPanel.style.pointerEvents = "none";
  } else {
    els.dropZoneProc.hidden = true;
    els.dropZoneEmpty.hidden = state.files.length > 0;
    els.dropZone.classList.toggle("has-files", state.files.length > 0);
    els.optionsPanel.style.opacity = "";
    els.optionsPanel.style.pointerEvents = "";
  }
  updateSubmitButton();
}

// Drag-and-drop onto drop zone
els.dropZone.addEventListener("dragenter", e => {
  e.preventDefault();
  if (!state.processing) els.dropZone.classList.add("drag-over");
});

els.dropZone.addEventListener("dragleave", e => {
  if (!els.dropZone.contains(e.relatedTarget)) {
    els.dropZone.classList.remove("drag-over");
  }
});

els.dropZone.addEventListener("dragover", e => {
  e.preventDefault();
  e.dataTransfer.dropEffect = "copy";
});

els.dropZone.addEventListener("drop", e => {
  e.preventDefault();
  els.dropZone.classList.remove("drag-over");
  if (state.processing) return;
  const files = Array.from(e.dataTransfer.files);
  addFiles(files);
});

// Click drop zone to browse
els.dropZone.addEventListener("click", e => {
  if (state.processing) return;
  // Don't trigger if clicking file list items or buttons inside
  if (e.target.closest(".file-item") || e.target.closest("button")) return;
  if (state.files.length === 0) {
    els.fileInput.click();
  }
});

els.dropZone.addEventListener("keydown", e => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    if (state.files.length === 0 && !state.processing) els.fileInput.click();
  }
});

els.browseBtn.addEventListener("click", e => {
  e.stopPropagation();
  els.fileInput.click();
});

els.fileInput.addEventListener("change", () => {
  addFiles(Array.from(els.fileInput.files));
  els.fileInput.value = ""; // allow re-selecting same files
});

els.addMoreBtn.addEventListener("click", () => els.fileInput.click());
els.clearAllBtn.addEventListener("click", () => {
  state.files = [];
  renderFileList();
  resetDropZone();
  updateSubmitButton();
  hideResult();
});

// ============================================================
//  File Management
// ============================================================

function addFiles(newFiles) {
  const tool = TOOLS[state.activeTool];
  const accepted = tool.acceptedTypes;

  const valid = [];
  const rejected = [];

  for (const f of newFiles) {
    const ext = "." + f.name.split(".").pop().toLowerCase();
    if (accepted.includes(ext)) {
      valid.push(f);
    } else {
      rejected.push(f.name);
    }
  }

  if (rejected.length > 0) {
    showToast(
      "Unsupported file type",
      `${rejected.join(", ")} — this tool accepts: ${accepted.join(", ")}`,
      "error"
    );
  }

  if (valid.length === 0) return;

  if (!tool.multiFile) {
    // Single file tools: replace existing
    state.files = [valid[0]];
    if (valid.length > 1) {
      showToast("Single file mode", "Only one file is used for this tool. Only the first file was added.", "info");
    }
  } else {
    state.files.push(...valid);
  }

  renderFileList();
  updateSubmitButton();
  hideResult();
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(2) + " MB";
}

function renderFileList() {
  const hasFiles = state.files.length > 0;
  els.fileListCont.hidden = !hasFiles || state.processing;
  els.dropZone.classList.toggle("has-files", hasFiles);
  els.dropZoneEmpty.hidden = hasFiles;

  if (!hasFiles) return;

  const tool = TOOLS[state.activeTool];
  const showDrag = tool.multiFile && state.files.length > 1;

  els.fileCountLabel.textContent =
    state.files.length === 1 ? "1 file selected" : `${state.files.length} files selected`;

  const pdfIconSVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14,2 14,8 20,8"/>
  </svg>`;

  const imgIconSVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2"/>
    <circle cx="8.5" cy="8.5" r="1.5"/>
    <polyline points="21,15 16,10 5,21"/>
  </svg>`;

  const dragHandleSVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/>
    <line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/>
    <line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
  </svg>`;

  const removeIconSVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>`;

  const isPdf = state.activeTool !== "images-to-pdf";

  els.fileList.innerHTML = state.files.map((f, i) => `
    <li class="file-item" draggable="${showDrag}" data-index="${i}">
      ${showDrag ? `<span class="file-drag-handle" aria-hidden="true">${dragHandleSVG}</span>` : ""}
      <span class="file-icon">${isPdf ? pdfIconSVG : imgIconSVG}</span>
      <span class="file-info">
        <span class="file-name" title="${escHtml(f.name)}">${escHtml(f.name)}</span>
        <span class="file-size">${formatBytes(f.size)}</span>
      </span>
      <button class="file-remove-btn" data-index="${i}" aria-label="Remove ${escHtml(f.name)}">
        ${removeIconSVG}
      </button>
    </li>
  `).join("");

  // Remove buttons
  els.fileList.querySelectorAll(".file-remove-btn").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.index);
      state.files.splice(idx, 1);
      renderFileList();
      updateSubmitButton();
      if (state.files.length === 0) resetDropZone();
    });
  });

  // Drag-to-reorder within list
  if (showDrag) {
    setupListReorder();
  }
}

function setupListReorder() {
  const items = els.fileList.querySelectorAll(".file-item[draggable='true']");

  items.forEach(item => {
    item.addEventListener("dragstart", e => {
      state.dragSrcIdx = parseInt(item.dataset.index);
      e.dataTransfer.effectAllowed = "move";
      setTimeout(() => item.classList.add("dragging"), 0);
    });

    item.addEventListener("dragend", () => {
      item.classList.remove("dragging");
      els.fileList.querySelectorAll(".file-item").forEach(el => el.classList.remove("drag-target"));
    });

    item.addEventListener("dragover", e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const targetIdx = parseInt(item.dataset.index);
      if (targetIdx !== state.dragSrcIdx) {
        els.fileList.querySelectorAll(".file-item").forEach(el => el.classList.remove("drag-target"));
        item.classList.add("drag-target");
        state.dragOverIdx = targetIdx;
      }
    });

    item.addEventListener("drop", e => {
      e.preventDefault();
      e.stopPropagation(); // prevent outer drop zone from firing
      const from = state.dragSrcIdx;
      const to = parseInt(item.dataset.index);
      if (from !== to && from >= 0) {
        const moved = state.files.splice(from, 1)[0];
        state.files.splice(to, 0, moved);
        renderFileList();
      }
    });
  });
}

// ============================================================
//  Options Panel Rendering
// ============================================================

function renderOptions(toolName) {
  let html = "";

  switch (toolName) {
    case "merge":
      html = `<div class="options-card">
        <p class="options-card-title">Options</p>
        <p style="font-size:0.88rem;color:var(--color-text-muted);">
          Files will be merged in the order shown above. Drag them to rearrange.
        </p>
      </div>`;
      break;

    case "slice":
      html = `<div class="options-card">
        <p class="options-card-title">What do you want?</p>
        <div class="radio-group">
          <label class="radio-label">
            <input type="radio" name="slice-mode" value="extract" checked />
            <div>
              <strong>Extract pages → one PDF</strong>
              <div style="font-size:0.82rem;color:var(--color-text-muted)">e.g. pick pages 1-3, 5, 7 into a single file</div>
            </div>
          </label>
          <label class="radio-label">
            <input type="radio" name="slice-mode" value="pages" />
            <div>
              <strong>Split every page → ZIP</strong>
              <div style="font-size:0.82rem;color:var(--color-text-muted)">each page becomes its own PDF file</div>
            </div>
          </label>
          <label class="radio-label">
            <input type="radio" name="slice-mode" value="ranges" />
            <div>
              <strong>Split by ranges → ZIP</strong>
              <div style="font-size:0.82rem;color:var(--color-text-muted)">divide into chunks, e.g. 1-3, 4-6, 7-10</div>
            </div>
          </label>
        </div>
        <div id="slice-page-spec-group" class="form-group" style="margin-top:4px;">
          <label class="form-label" for="slice-page-spec">Pages to extract</label>
          <input type="text" id="slice-page-spec" class="form-input"
            placeholder="e.g. 1-3, 5, 7-9" autocomplete="off" />
          <span class="form-help">Use commas and ranges, e.g. 1-3, 5, 7-9</span>
        </div>
        <div id="slice-ranges-group" class="form-group" style="display:none;margin-top:4px;">
          <label class="form-label" for="slice-ranges">Page ranges</label>
          <input type="text" id="slice-ranges" class="form-input"
            placeholder="e.g. 1-3, 4-6, 7-10" autocomplete="off" />
          <span class="form-help">Each range becomes one PDF in the ZIP.</span>
        </div>
      </div>`;
      break;

    case "rotate":
      html = `<div class="options-card">
        <p class="options-card-title">Rotation</p>
        <div class="segment-control">
          <input type="radio" name="angle" id="angle-90" value="90" checked />
          <label for="angle-90">90°</label>
          <input type="radio" name="angle" id="angle-180" value="180" />
          <label for="angle-180">180°</label>
          <input type="radio" name="angle" id="angle-270" value="270" />
          <label for="angle-270">270°</label>
        </div>
      </div>
      <div class="options-card">
        <p class="options-card-title">Which Pages</p>
        <div class="radio-group">
          <label class="radio-label">
            <input type="radio" name="rotate-scope" value="all" checked />
            All pages
          </label>
          <label class="radio-label">
            <input type="radio" name="rotate-scope" value="specific" />
            Specific pages
          </label>
        </div>
        <div id="rotate-pages-group" style="display:none;" class="form-group">
          <label class="form-label" for="rotate-pages">Page numbers</label>
          <input type="text" id="rotate-pages" class="form-input"
            placeholder="e.g. 1, 3, 5-7" autocomplete="off" />
          <span class="form-help">Use commas and ranges, e.g. 1, 3-5, 8</span>
        </div>
      </div>`;
      break;


    case "compress":
      html = `<div class="options-card">
        <p class="options-card-title">Compression Settings</p>
        <div class="slider-group">
          <label class="form-label" for="compress-quality">Image quality: <strong id="quality-display">60</strong></label>
          <div class="slider-row">
            <span style="font-size:0.78rem;color:var(--color-text-faint)">Smaller</span>
            <input type="range" id="compress-quality" min="1" max="100" value="60" />
            <span style="font-size:0.78rem;color:var(--color-text-faint)">Better</span>
          </div>
          <span class="form-help">Lower values reduce file size more but may affect image clarity. Recommended: 50–70.</span>
        </div>
      </div>`;
      break;

    case "pdf-to-images":
      html = `<div class="options-card">
        <p class="options-card-title">Output Format</p>
        <div class="form-group">
          <label class="form-label" for="img-format">Format</label>
          <select id="img-format" class="form-select">
            <option value="jpg">JPG — smaller file size</option>
            <option value="png">PNG — lossless quality</option>
          </select>
        </div>
      </div>
      <div class="options-card">
        <p class="options-card-title">Resolution (DPI)</p>
        <div class="dpi-presets">
          <button class="dpi-preset-btn" data-dpi="72">72 — Screen</button>
          <button class="dpi-preset-btn" data-dpi="96">96 — Web</button>
          <button class="dpi-preset-btn active" data-dpi="150">150 — Standard ✓</button>
          <button class="dpi-preset-btn" data-dpi="300">300 — Print</button>
        </div>
        <input type="hidden" id="img-dpi" value="150" />
        <span class="form-help" style="margin-top:8px;display:block;">Higher DPI = sharper images but larger file sizes.</span>
      </div>`;
      break;

    case "convert": {
      // Build "From" options (all formats)
      const fromOpts = Object.keys(CONVERT_TARGETS)
        .map(f => `<option value="${f}">${FORMAT_LABELS[f]}</option>`).join("");
      // Default "To" options for PDF (first entry)
      const defaultTargets = CONVERT_TARGETS["pdf"];
      const toOpts = defaultTargets
        .map(f => `<option value="${f}">${FORMAT_LABELS[f]}</option>`).join("");
      html = `<div class="options-card">
        <p class="options-card-title">Conversion</p>
        <div class="convert-from-to">
          <div class="form-group">
            <label class="form-label" for="convert-from">From</label>
            <select id="convert-from" class="form-select" style="max-width:100%">${fromOpts}</select>
          </div>
          <div class="convert-arrow">→</div>
          <div class="form-group">
            <label class="form-label" for="convert-to">To</label>
            <select id="convert-to" class="form-select" style="max-width:100%">${toOpts}</select>
          </div>
        </div>
        <div id="convert-extra-options"></div>
      </div>`;
      break;
    }

    case "merge-images":
      html = `<div class="options-card">
        <p class="options-card-title">Layout</p>
        <div class="segment-control">
          <input type="radio" name="merge-layout" id="layout-vertical" value="vertical" checked />
          <label for="layout-vertical">⬇&nbsp; Vertical</label>
          <input type="radio" name="merge-layout" id="layout-horizontal" value="horizontal" />
          <label for="layout-horizontal">➡&nbsp; Horizontal</label>
        </div>
        <p style="font-size:0.84rem;color:var(--color-text-muted);margin-top:12px;line-height:1.55;">
          <strong>Vertical</strong> — stacks images top to bottom, all scaled to the same width.<br>
          <strong>Horizontal</strong> — places images side by side, all scaled to the same height.
        </p>
      </div>`;
      break;

    case "images-to-pdf":
      html = `<div class="options-card">
        <p class="options-card-title">Page Size</p>
        <div class="form-group">
          <label class="form-label" for="page-size">Output page size</label>
          <select id="page-size" class="form-select">
            <option value="auto">Auto — match each image's dimensions</option>
            <option value="a4">A4 (210 × 297 mm)</option>
            <option value="letter">Letter (8.5 × 11 in)</option>
          </select>
          <span class="form-help">Images will be scaled to fit the page while preserving their aspect ratio.</span>
        </div>
      </div>`;
      break;
  }

  els.optionsPanel.innerHTML = html;
  bindOptionEvents(toolName);
}

function bindOptionEvents(toolName) {
  if (toolName === "convert") {
    const fromSel = $("convert-from");
    const toSel   = $("convert-to");

    function updateConvertTo() {
      const fromVal = fromSel.value;
      const targets = CONVERT_TARGETS[fromVal] || [];
      toSel.innerHTML = targets
        .map(f => `<option value="${f}">${FORMAT_LABELS[f]}</option>`).join("");
      // Update accepted file types on the hidden input
      els.fileInput.accept = fromVal === "pdf" ? ".pdf" : IMAGE_ACCEPT;
      TOOLS["convert"].acceptedTypes = fromVal === "pdf"
        ? [".pdf"]
        : IMAGE_ACCEPT.split(",");
      // Clear files — old ones may be the wrong type
      if (state.files.length > 0) {
        state.files = [];
        renderFileList();
        updateSubmitButton();
      }
      renderConvertExtra();
    }

    function renderConvertExtra() {
      const fromVal = fromSel.value;
      const toVal   = toSel.value;
      const extra   = $("convert-extra-options");
      if (!extra) return;

      if (fromVal === "pdf") {
        extra.innerHTML = `<div style="margin-top:14px;">
          <p class="options-card-title" style="margin-bottom:8px;">Resolution (DPI)</p>
          <div class="dpi-presets">
            <button class="dpi-preset-btn" data-dpi="72">72 — Screen</button>
            <button class="dpi-preset-btn" data-dpi="96">96 — Web</button>
            <button class="dpi-preset-btn active" data-dpi="150">150 — Standard ✓</button>
            <button class="dpi-preset-btn" data-dpi="300">300 — Print</button>
          </div>
          <input type="hidden" id="convert-dpi" value="150" />
        </div>`;
        extra.querySelectorAll(".dpi-preset-btn").forEach(btn => {
          btn.addEventListener("click", () => {
            extra.querySelectorAll(".dpi-preset-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            $("convert-dpi").value = btn.dataset.dpi;
          });
        });
      } else if (toVal === "pdf") {
        extra.innerHTML = `<div style="margin-top:14px;">
          <p class="options-card-title" style="margin-bottom:8px;">Page Size</p>
          <select id="convert-page-size" class="form-select">
            <option value="auto">Auto — match each image's dimensions</option>
            <option value="a4">A4 (210 × 297 mm)</option>
            <option value="letter">Letter (8.5 × 11 in)</option>
          </select>
        </div>`;
      } else {
        extra.innerHTML = "";
      }
    }

    fromSel.addEventListener("change", updateConvertTo);
    toSel.addEventListener("change", () => { renderConvertExtra(); updateFilenameInput(); });

    // Initialise extra options for default selection
    renderConvertExtra();
  }

  if (toolName === "slice") {
    const radios      = els.optionsPanel.querySelectorAll('input[name="slice-mode"]');
    const specGroup   = $("slice-page-spec-group");
    const rangesGroup = $("slice-ranges-group");
    function updateSliceUI() {
      const val = els.optionsPanel.querySelector('input[name="slice-mode"]:checked')?.value;
      specGroup.style.display   = val === "extract" ? "flex" : "none";
      rangesGroup.style.display = val === "ranges"  ? "flex" : "none";
    }
    radios.forEach(r => r.addEventListener("change", () => { updateSliceUI(); updateFilenameInput(); }));
    updateSliceUI();
  }

  if (toolName === "rotate") {
    const radios = els.optionsPanel.querySelectorAll('input[name="rotate-scope"]');
    const pagesGroup = $("rotate-pages-group");
    radios.forEach(r => r.addEventListener("change", () => {
      pagesGroup.style.display = r.value === "specific" && r.checked ? "flex" : "none";
    }));
  }

  if (toolName === "compress") {
    const slider = $("compress-quality");
    const display = $("quality-display");
    slider.addEventListener("input", () => { display.textContent = slider.value; });
  }

  if (toolName === "pdf-to-images") {
    const btns = els.optionsPanel.querySelectorAll(".dpi-preset-btn");
    const dpiInput = $("img-dpi");
    btns.forEach(btn => {
      btn.addEventListener("click", () => {
        btns.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        dpiInput.value = btn.dataset.dpi;
      });
    });
  }
}

// ============================================================
//  Output Filename
// ============================================================

function generateDefaultFilename() {
  const tool = state.activeTool;
  if (!state.files.length) return "";
  const stem = state.files[0].name.replace(/\.[^/.]+$/, "");

  switch (tool) {
    case "merge":
      return `${stem}-merged.pdf`;
    case "slice": {
      const mode = document.querySelector('input[name="slice-mode"]:checked')?.value || "extract";
      return mode === "extract" ? `${stem}-extracted.pdf` : `${stem}-split.zip`;
    }
    case "rotate":
      return `${stem}-rotated.pdf`;
    case "compress":
      return `${stem}-compressed.pdf`;
    case "convert": {
      const from = $("convert-from")?.value || "pdf";
      const to   = $("convert-to")?.value   || "jpg";
      if (from === "pdf") return `${stem}-converted.zip`;
      if (to === "pdf")   return `${stem}.pdf`;
      return state.files.length > 1 ? `${stem}-converted.zip` : `${stem}.${to}`;
    }
    case "merge-images":
      return `${stem}-merged.jpg`;
    default:
      return `${stem}-output.pdf`;
  }
}

function updateFilenameInput() {
  const enough = state.files.length >= TOOLS[state.activeTool].minFiles;
  els.filenameRow.hidden = !enough || state.processing;
  if (enough) {
    els.filenameInput.value = generateDefaultFilename();
  }
}

// ============================================================
//  Submit Button
// ============================================================

function updateSubmitButton() {
  const tool = TOOLS[state.activeTool];
  const enough = state.files.length >= tool.minFiles;
  els.actionRow.hidden = !enough || state.processing;
  els.submitBtn.disabled = !enough || state.processing;
  els.submitBtnText.textContent = tool.submitLabel;
  updateFilenameInput();
}

els.submitBtn.addEventListener("click", submitOperation);

// ============================================================
//  Form Submission
// ============================================================

async function submitOperation() {
  if (state.processing) return;

  const tool = TOOLS[state.activeTool];
  if (state.files.length < tool.minFiles) {
    showToast("Not enough files", `This tool requires at least ${tool.minFiles} file(s).`, "error");
    return;
  }

  // Validate tool-specific required fields
  const validationError = validateOptions();
  if (validationError) {
    showToast("Missing information", validationError, "error");
    return;
  }

  // Build FormData
  const formData = new FormData();
  for (const f of state.files) {
    formData.append("files", f, f.name);
  }
  appendOptions(formData);

  // Set processing state
  setProcessingState(true);
  hideResult();

  try {
    const response = await fetch(tool.endpoint, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      let errMsg = `Server error (${response.status})`;
      try {
        const data = await response.json();
        errMsg = data.error || errMsg;
      } catch (_) {}
      throw new Error(errMsg);
    }

    // Use the user's chosen filename (or the auto-generated default)
    const inputVal = (els.filenameInput?.value || "").trim();
    const filename = inputVal || getDefaultFilename();

    // Download the blob
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);

    // Trigger download
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // Show result panel
    els.resultFilename.textContent = filename;
    els.downloadLink.href = url;
    els.downloadLink.download = filename;
    showResult();

    showToast("Done!", `${filename} is ready.`, "success");

    // Revoke after a generous delay to allow re-download
    setTimeout(() => URL.revokeObjectURL(url), 120_000);

  } catch (err) {
    showToast("Processing failed", err.message, "error");
  } finally {
    setProcessingState(false);
    renderFileList();
    updateSubmitButton();
  }
}

function validateOptions() {
  const tool = state.activeTool;

  if (tool === "slice") {
    const mode = document.querySelector('input[name="slice-mode"]:checked');
    if (mode?.value === "extract") {
      if (!($("slice-page-spec")?.value || "").trim())
        return "Please enter the pages to extract, e.g. '1-3, 5'.";
    }
    if (mode?.value === "ranges") {
      if (!($("slice-ranges")?.value || "").trim())
        return "Please enter the page ranges, e.g. '1-3, 4-6'.";
    }
  }

  if (tool === "rotate") {
    const scope = document.querySelector('input[name="rotate-scope"]:checked');
    if (scope && scope.value === "specific") {
      const pages = ($("rotate-pages") || {}).value || "";
      if (!pages.trim()) return "Please enter the page numbers to rotate, e.g. '1, 3, 5-7'.";
    }
  }

  return null;
}

function appendOptions(formData) {
  const tool = state.activeTool;

  if (tool === "slice") {
    const mode = document.querySelector('input[name="slice-mode"]:checked');
    const modeVal = mode ? mode.value : "extract";
    formData.append("mode", modeVal);
    if (modeVal === "extract") {
      formData.append("page_spec", $("slice-page-spec")?.value || "");
    }
    if (modeVal === "ranges") {
      formData.append("ranges", $("slice-ranges")?.value || "");
    }
  }

  if (tool === "rotate") {
    const angle = document.querySelector('input[name="angle"]:checked');
    formData.append("angle", angle ? angle.value : "90");
    const scope = document.querySelector('input[name="rotate-scope"]:checked');
    if (scope && scope.value === "specific") {
      const pages = $("rotate-pages");
      formData.append("page_spec", pages ? pages.value : "all");
    } else {
      formData.append("page_spec", "all");
    }
  }

  if (tool === "compress") {
    const q = $("compress-quality");
    if (q) formData.append("quality", q.value);
  }

  if (tool === "pdf-to-images") {
    const fmt = $("img-format");
    const dpi = $("img-dpi");
    if (fmt) formData.append("format", fmt.value);
    if (dpi) formData.append("dpi", dpi.value);
  }

  if (tool === "convert") {
    const fromSel = $("convert-from");
    const toSel   = $("convert-to");
    if (fromSel) formData.append("from_format", fromSel.value);
    if (toSel)   formData.append("to_format",   toSel.value);
    const dpi = $("convert-dpi");
    if (dpi) formData.append("dpi", dpi.value);
    const ps = $("convert-page-size");
    if (ps) formData.append("page_size", ps.value);
  }

  if (tool === "merge-images") {
    const layout = document.querySelector('input[name="merge-layout"]:checked');
    formData.append("layout", layout ? layout.value : "vertical");
  }


}

function getDefaultFilename() {
  if (state.activeTool === "convert") {
    const toSel = $("convert-to");
    const toVal = toSel ? toSel.value : "jpg";
    const fromSel = $("convert-from");
    const fromVal = fromSel ? fromSel.value : "pdf";
    if (fromVal === "pdf" || (state.files.length > 1 && toVal !== "pdf")) {
      return "converted.zip";
    }
    return `converted.${toVal}`;
  }
  const defaults = {
    "merge":        "merged.pdf",
    "slice":        document.querySelector('input[name="slice-mode"]:checked')?.value === "extract" ? "sliced.pdf" : "sliced_pages.zip",
    "rotate":       "rotated.pdf",
    "compress":     "compressed.pdf",
    "merge-images": "merged.jpg",
  };
  return defaults[state.activeTool] || "result.pdf";
}

// ============================================================
//  Result Panel
// ============================================================

function showResult() {
  els.resultPanel.hidden = false;
}

function hideResult() {
  els.resultPanel.hidden = true;
}

els.processAnotherBtn.addEventListener("click", () => {
  hideResult();
  state.files = [];
  if (els.filenameInput) els.filenameInput.value = "";
  els.filenameRow.hidden = true;
  renderFileList();
  resetDropZone();
  updateSubmitButton();
});

// ============================================================
//  Toast Notifications
// ============================================================

const TOAST_ICONS = {
  success: `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22,4 12,14.01 9,11.01"/></svg>`,
  error:   `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
  info:    `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
  warning: `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
};

const TOAST_TITLES = { success: "Success", error: "Error", info: "Info", warning: "Warning" };

function showToast(title, message, type = "info", duration = 5000) {
  // Limit to 4 toasts
  while (els.toastContainer.children.length >= 4) {
    dismissToast(els.toastContainer.firstElementChild);
  }

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    ${TOAST_ICONS[type] || TOAST_ICONS.info}
    <div class="toast-body">
      <span class="toast-title">${escHtml(title)}</span>
      <span class="toast-msg">${escHtml(message)}</span>
    </div>
    <button class="toast-close" aria-label="Dismiss">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>
  `;

  toast.querySelector(".toast-close").addEventListener("click", () => dismissToast(toast));
  els.toastContainer.appendChild(toast);

  if (duration > 0) {
    setTimeout(() => dismissToast(toast), duration);
  }
}

function dismissToast(toast) {
  if (!toast || !toast.parentNode) return;
  toast.classList.add("toast-exit");
  toast.addEventListener("animationend", () => toast.remove(), { once: true });
}

// ============================================================
//  Utilities
// ============================================================

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ============================================================
//  Sidebar Navigation
// ============================================================

els.navItems.forEach(item => {
  item.addEventListener("click", () => setActiveTool(item.dataset.tool));
});

// ============================================================
//  Init
// ============================================================

setActiveTool("merge");
