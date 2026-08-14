// Global State
let html5QrCode = null;
let isScanning = false;
let currentFacingMode = "environment"; // "environment" (back) or "user" (front)
let torchOn = false;
let soundEnabled = true;
let discountData = {}; // Stores barcode -> product deal object

// Audio context for sound effects
let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
  return audioCtx;
}

function playBeep(isSuccess = true) {
  if (!soundEnabled) return;
  try {
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.value = isSuccess ? 880 : 300; // High beep for deal, low for no deal
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  } catch (e) {
    console.warn("Audio play blocked or not supported:", e);
  }
}

// DOM Elements
let scanBtn, scannerIdle, reticle, camControls, liveDot, statusText, torchBtn, flipBtn, soundBtn;

// Initialize App
document.addEventListener("DOMContentLoaded", () => {
  scanBtn = document.getElementById("scanBtn");
  scannerIdle = document.getElementById("scannerIdle");
  reticle = document.getElementById("reticle");
  camControls = document.getElementById("camOverlayControls");
  liveDot = document.getElementById("liveDot");
  statusText = document.getElementById("statusText");
  torchBtn = document.getElementById("torchToggleBtn");
  flipBtn = document.getElementById("camFlipBtn");
  soundBtn = document.getElementById("soundToggleBtn");

  if (typeof Html5Qrcode !== "undefined") {
    html5QrCode = new Html5Qrcode("reader");
  } else {
    alert("Camera library (Html5Qrcode) failed to load. Check internet connection.");
  }

  setupEventListeners();
});

function setupEventListeners() {
  // Start/Stop Camera Button
  scanBtn.addEventListener("click", toggleScanner);

  // Flash Toggle
  torchBtn.addEventListener("click", toggleFlash);

  // Flip Camera
  flipBtn.addEventListener("click", switchCamera);

  // Sound Toggle
  soundBtn.addEventListener("click", () => {
    soundEnabled = !soundEnabled;
    soundBtn.textContent = soundEnabled ? "🔊 Audio ON" : "🔇 Audio OFF";
  });

  // Manual Lookup
  document.getElementById("manualBtn").addEventListener("click", handleManualLookup);
  document.getElementById("manualInput").addEventListener("keypress", (e) => {
    if (e.key === "Enter") handleManualLookup();
  });

  // File Upload
  document.getElementById("uploadBtn").addEventListener("click", () => {
    document.getElementById("fileInput").click();
  });
  document.getElementById("fileInput").addEventListener("change", handleFileUpload);

  // Sample Data Button
  document.getElementById("sampleBtn").addEventListener("click", loadSampleData);

  // Clear Receipt History
  document.getElementById("historyClear").addEventListener("click", clearHistory);

  // Clear sheet button
  document.getElementById("clearBtn").addEventListener("click", clearSheetData);
}

// --- Camera Scanner Core Logic ---
async function toggleScanner() {
  if (isScanning) {
    await stopScanner();
  } else {
    await startScanner();
  }
}

async function startScanner() {
  if (!html5QrCode) return;

  const config = {
    fps: 15,
    qrbox: { width: 250, height: 180 },
    aspectRatio: 1.333333
  };

  try {
    scannerIdle.style.display = "none";
    reticle.style.display = "flex";
    camControls.style.display = "flex";

    await html5QrCode.start(
      { facingMode: currentFacingMode },
      config,
      onScanSuccess,
      onScanError
    );

    isScanning = true;
    scanBtn.textContent = "🛑 Stop Camera";
    scanBtn.style.background = "var(--pink)";
    liveDot.classList.add("active");
    statusText.textContent = "LIVE";

  } catch (err) {
    console.error("Camera Start Error:", err);
    alert("Could not access camera: " + (err.message || err) + "\n\nNote: Browsers block camera access over insecure (http://) connections.");
    resetScannerUI();
  }
}

async function stopScanner() {
  if (!html5QrCode || !isScanning) return;

  try {
    await html5QrCode.stop();
  } catch (err) {
    console.warn("Camera stop error:", err);
  } finally {
    isScanning = false;
    resetScannerUI();
  }
}

function resetScannerUI() {
  scannerIdle.style.display = "block";
  reticle.style.display = "none";
  camControls.style.display = "none";
  scanBtn.textContent = "📸 Start Scanning!";
  scanBtn.style.background = "var(--pink)";
  liveDot.classList.remove("active");
  statusText.textContent = "Idle";
  torchOn = false;
  torchBtn.textContent = "⚡ Flash";
}

// --- Flash & Flip Functionality ---
async function toggleFlash() {
  if (!isScanning) return;
  try {
    torchOn = !torchOn;
    await html5QrCode.applyVideoConstraints({
      advanced: [{ torch: torchOn }]
    });
    torchBtn.textContent = torchOn ? "⚡ Torch ON" : "⚡ Flash";
  } catch (e) {
    alert("Flash/Torch is not supported on this camera device.");
    torchOn = false;
  }
}

async function switchCamera() {
  currentFacingMode = currentFacingMode === "environment" ? "user" : "environment";
  if (isScanning) {
    await stopScanner();
    await startScanner();
  }
}

// --- Scan Result Handling ---
function onScanSuccess(decodedText) {
  playBeep(true);
  lookupBarcode(decodedText);

  // Trigger Confetti if deal found
  if (window.confetti && discountData[decodedText]) {
    confetti({ particleCount: 50, spread: 60, origin: { y: 0.8 } });
  }
}

function onScanError(errorMessage) {
  // Silent fail during frame scanning
}

function handleManualLookup() {
  const input = document.getElementById("manualInput");
  const code = input.value.trim();
  if (code) {
    lookupBarcode(code);
    input.value = "";
  }
}

function lookupBarcode(code) {
  const stampEmpty = document.getElementById("stampEmpty");
  const stampResult = document.getElementById("stampResult");
  const stampMark = document.getElementById("stampMark");
  const stampCode = document.getElementById("stampCode");
  const stampProd = document.getElementById("stampProd");

  const deal = discountData[code];

  stampEmpty.style.display = "none";
  stampResult.style.display = "flex";
  stampCode.textContent = code;

  if (deal) {
    stampMark.textContent = `🎉 ${deal.discount || "ON SALE!"}`;
    stampMark.className = "stamp-mark sale";
    stampProd.textContent = deal.title || "Discounted Item";
    addToReceipt(code, deal.title || "Discounted Item", deal.discount || "SALE", true);
  } else {
    stampMark.textContent = "😅 FULL PRICE";
    stampMark.className = "stamp-mark nosale";
    stampProd.textContent = "No discount found on sheet";
    addToReceipt(code, "Regular Item", "No Deal", false);
  }
}

// --- Sheet Parsing & Helpers ---
function handleFileUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(evt) {
    try {
      const data = new Uint8Array(evt.target.result);
      const workbook = XLSX.read(data, { type: "array" });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });

      discountData = {};
      rows.forEach(row => {
        if (row[0]) {
          discountData[String(row[0]).trim()] = {
            title: row[1] || "Item",
            discount: row[2] || "Discounted"
          };
        }
      });

      document.getElementById("sheetTitle").textContent = file.name;
      document.getElementById("sheetMeta").textContent = `${Object.keys(discountData).length} items loaded`;
      document.getElementById("clearBtn").style.display = "inline-block";
    } catch (err) {
      alert("Error parsing file. Please ensure it is a valid CSV or XLSX file.");
    }
  };
  reader.readAsArrayBuffer(file);
}

function loadSampleData() {
  discountData = {
    "123456789": { title: "Wireless Headphones", discount: "40% OFF" },
    "987654321": { title: "Organic Coffee Beans", discount: "BUY 1 GET 1" },
    "051111400013": { title: "Sticky Notes 12-Pack", discount: "$5.00 OFF" }
  };
  document.getElementById("sheetTitle").textContent = "Sample Deals Loaded";
  document.getElementById("sheetMeta").textContent = "3 demo barcodes ready";
  document.getElementById("clearBtn").style.display = "inline-block";
}

function clearSheetData() {
  discountData = {};
  document.getElementById("sheetTitle").textContent = "No sheet loaded";
  document.getElementById("sheetMeta").textContent = "Upload .xlsx, .csv or .json";
  document.getElementById("clearBtn").style.display = "none";
}

function addToReceipt(code, title, tag, isSale) {
  const receipt = document.getElementById("receipt");
  const emptyMsg = document.getElementById("receiptEmpty");
  if (emptyMsg) emptyMsg.style.display = "none";

  const item = document.createElement("div");
  item.className = "receipt-item";
  item.innerHTML = `
    <div class="info">
      <span class="title">${title}</span>
      <span class="code">${code}</span>
    </div>
    <span class="receipt-tag ${isSale ? 'sale' : 'nosale'}">${tag}</span>
  `;
  receipt.prepend(item);
}

function clearHistory() {
  const receipt = document.getElementById("receipt");
  receipt.innerHTML = `<div class="receipt-empty" id="receiptEmpty">Nothing scanned yet — go find a bargain!</div>`;
}
dHistoryItem(rawCode, hit.prod, hit.discount, true);
  } else {
    // Not on discount
    renderStampResult(false, 'NO DISCOUNT', rawCode, 'Regular Price Item');
    AudioEngine.playNoSale();
    addHistoryItem(rawCode, 'Scanned Item', 'Regular Price', false);
  }
}

// Display Stamp Card Result
function renderStampResult(isSale, markText, code, description) {
  const stampEmpty = document.getElementById('stampEmpty');
  const stampResult = document.getElementById('stampResult');
  const stampMark = document.getElementById('stampMark');
  const stampCode = document.getElementById('stampCode');
  const stampProd = document.getElementById('stampProd');

  stampEmpty.style.display = 'none';
  stampResult.style.display = 'flex';

  stampMark.textContent = isSale ? `🎉 ${markText}` : `😅 ${markText}`;
  stampMark.className = `stamp-mark ${isSale ? 'sale' : 'nosale'}`;

  stampCode.textContent = code;
  stampProd.textContent = description;

  // Re-trigger CSS entrance animation
  stampResult.style.animation = 'none';
  void stampResult.offsetWidth; // Trigger reflow
  stampResult.style.animation = 'popIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
}

// Confetti Particle Effect
function triggerConfetti() {
  if (typeof confetti === 'function') {
    confetti({
      particleCount: 50,
      spread: 60,
      origin: { y: 0.65 }
    });
  }
}

// Scan Party Receipt History Logic
function addHistoryItem(code, title, tag, isSale) {
  const item = { code, title, tag, isSale, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) };
  state.history.unshift(item);
  renderHistoryUI();
}

function clearHistory() {
  state.history = [];
  renderHistoryUI();
}

function renderHistoryUI() {
  const receipt = document.getElementById('receipt');
  const receiptEmpty = document.getElementById('receiptEmpty');

  if (state.history.length === 0) {
    receiptEmpty.style.display = 'block';
    receipt.innerHTML = '';
    receipt.appendChild(receiptEmpty);
    return;
  }

  receiptEmpty.style.display = 'none';
  receipt.innerHTML = '';

  state.history.forEach((item) => {
    const el = document.createElement('div');
    el.className = 'receipt-item';
    el.innerHTML = `
      <div class="info">
        <span class="code">${escapeHtml(item.code)} • ${item.time}</span>
        <span class="title">${escapeHtml(item.title)}</span>
      </div>
      <span class="receipt-tag ${item.isSale ? 'sale' : 'nosale'}">${escapeHtml(item.tag)}</span>
    `;
    receipt.appendChild(el);
  });
}

// Helper: Escape HTML to avoid XSS
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
nual Entry Handler
function handleManualSubmit() {
  const input = document.getElementById('manualInput');
  const code = input.value.trim();
  if (!code) return;

  lookupBarcode(code);
  input.value = '';
}

// Core Lookup Engine
function lookupBarcode(rawCode) {
  const now = Date.now();
  const norm = normalizeCode(rawCode);

  // Cooldown throttle: 2.2s debounce on same barcode
  if (state.lastScannedCode === norm && (now - state.lastScanTime) < 2200) {
    return;
  }

  state.lastScannedCode = norm;
  state.lastScanTime = now;

  const hit = state.discountDb.get(norm);

  if (hit) {
    // Discount Found
    renderStampResult(true, hit.discount, rawCode, hit.prod);
    AudioEngine.playSale();
    triggerConfetti();
    addHistoryItem(rawCode, hit.prod, hit.discount, true);
  } else {
    // Not on discount
    renderStampResult(false, 'NO DISCOUNT', rawCode, 'Regular Price Item');
    AudioEngine.playNoSale();
    addHistoryItem(rawCode, 'Scanned Item', 'Regular Price', false);
  }
}

// Display Stamp Card Result
function renderStampResult(isSale, markText, code, description) {
  const stampEmpty = document.getElementById('stampEmpty');
  const stampResult = document.getElementById('stampResult');
  const stampMark = document.getElementById('stampMark');
  const stampCode = document.getElementById('stampCode');
  const stampProd = document.getElementById('stampProd');

  stampEmpty.style.display = 'none';
  stampResult.style.display = 'flex';

  stampMark.textContent = isSale ? `🎉 ${markText}` : `😅 ${markText}`;
  stampMark.className = `stamp-mark ${isSale ? 'sale' : 'nosale'}`;

  stampCode.textContent = code;
  stampProd.textContent = description;

  // Re-trigger CSS entrance animation
  stampResult.style.animation = 'none';
  void stampResult.offsetWidth; // Trigger reflow
  stampResult.style.animation = 'popIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
}

// Confetti Particle Effect
function triggerConfetti() {
  if (typeof confetti === 'function') {
    confetti({
      particleCount: 50,
      spread: 60,
      origin: { y: 0.65 }
    });
  }
}

// Scan Party Receipt History Logic
function addHistoryItem(code, title, tag, isSale) {
  const item = { code, title, tag, isSale, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) };
  state.history.unshift(item);
  renderHistoryUI();
}

function clearHistory() {
  state.history = [];
  renderHistoryUI();
}

function renderHistoryUI() {
  const receipt = document.getElementById('receipt');
  const receiptEmpty = document.getElementById('receiptEmpty');

  if (state.history.length === 0) {
    receiptEmpty.style.display = 'block';
    receipt.innerHTML = '';
    receipt.appendChild(receiptEmpty);
    return;
  }

  receiptEmpty.style.display = 'none';
  receipt.innerHTML = '';

  state.history.forEach((item) => {
    const el = document.createElement('div');
    el.className = 'receipt-item';
    el.innerHTML = `
      <div class="info">
        <span class="code">${escapeHtml(item.code)} • ${item.time}</span>
        <span class="title">${escapeHtml(item.title)}</span>
      </div>
      <span class="receipt-tag ${item.isSale ? 'sale' : 'nosale'}">${escapeHtml(item.tag)}</span>
    `;
    receipt.appendChild(el);
  });
}

// Helper: Escape HTML to avoid XSS
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
