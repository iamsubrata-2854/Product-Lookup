/**
 * Scan Desk — Barcode Discount Lookup App
 * Single page application logic for local sheet processing, camera scanning,
 * manual lookup, sound generation, and local scan history.
 */

// Application State
const state = {
  discountDb: new Map(), // Map<normalizedCode, { originalCode, prod, discount }>
  isScanning: false,
  html5Qrcode: null,
  audioEnabled: true,
  lastScannedCode: null,
  lastScanTime: 0,
  history: []
};

// Built-in Sample Dataset for Quick Testing
const SAMPLE_DEALS = [
  { Barcode: "012345678905", Product: "Wireless Headphones", Discount: "40% OFF" },
  { Barcode: "098765432109", Product: "Organic Coffee Beans", Discount: "BUY 1 GET 1" },
  { Barcode: "12345678", Product: "Energy Drink 4-Pack", Discount: "25% OFF" },
  { Barcode: "88888888", Product: "Gourmet Chocolate Bar", Discount: "$2.00 OFF" },
  { Barcode: "SAMPLE123", Product: "Bluetooth Speaker", Discount: "50% OFF" },
  { Barcode: "76543210", Product: "Stainless Water Bottle", Discount: "30% OFF" }
];

// Web Audio API Sound Synthesizer (No external audio assets needed)
const AudioEngine = {
  ctx: null,

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  },

  playSale() {
    if (!state.audioEnabled) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6 arpeggio

    notes.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + idx * 0.07);

      gain.gain.setValueAtTime(0.2, now + idx * 0.07);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.07 + 0.18);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now + idx * 0.07);
      osc.stop(now + idx * 0.07 + 0.18);
    });
  },

  playNoSale() {
    if (!state.audioEnabled) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, now); // A3 down to Eb3
    osc.frequency.exponentialRampToValueAtTime(155.56, now + 0.22);

    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.25);
  }
};

// Helper: Normalize Barcode Strings for Matching
function normalizeCode(raw) {
  if (typeof raw !== 'string') raw = String(raw || '');
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// DOM Elements Initialization
document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const soundToggleBtn = document.getElementById('soundToggleBtn');
  const uploadBtn = document.getElementById('uploadBtn');
  const fileInput = document.getElementById('fileInput');
  const sampleBtn = document.getElementById('sampleBtn');
  const clearBtn = document.getElementById('clearBtn');
  const scanBtn = document.getElementById('scanBtn');
  const manualInput = document.getElementById('manualInput');
  const manualBtn = document.getElementById('manualBtn');
  const historyClear = document.getElementById('historyClear');

  // Sound Toggle Event
  soundToggleBtn.addEventListener('click', () => {
    state.audioEnabled = !state.audioEnabled;
    soundToggleBtn.textContent = state.audioEnabled ? '🔊 Audio ON' : '🔇 Audio OFF';
  });

  // Sheet Upload Events
  uploadBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', handleFileUpload);
  sampleBtn.addEventListener('click', loadSampleDeals);
  clearBtn.addEventListener('click', clearSheet);

  // Scanner Event
  scanBtn.addEventListener('click', toggleScanner);

  // Manual Input Events
  manualBtn.addEventListener('click', handleManualSubmit);
  manualInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleManualSubmit();
  });

  // History Clear Event
  historyClear.addEventListener('click', clearHistory);

  // Load sample dataset by default on startup
  loadSampleDeals();
});

// File Upload Parsing Logic
function handleFileUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  const fileName = file.name;
  const reader = new FileReader();

  if (fileName.endsWith('.json')) {
    reader.onload = (evt) => {
      try {
        const parsed = JSON.parse(evt.target.result);
        processSheetData(parsed, fileName);
      } catch (err) {
        alert('Could not parse JSON file. Ensure valid formatting.');
      }
    };
    reader.readAsText(file);
  } else {
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[firstSheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        processSheetData(rows, fileName);
      } catch (err) {
        alert('Could not parse spreadsheet file. Upload .xlsx, .xls or .csv.');
      }
    };
    reader.readAsArrayBuffer(file);
  }

  // Reset file input value
  e.target.value = '';
}

// Map Sheet Rows into State Map
function processSheetData(rows, sheetName) {
  if (!Array.isArray(rows) || rows.length === 0) {
    alert('Uploaded sheet is empty or invalid.');
    return;
  }

  state.discountDb.clear();
  let count = 0;

  rows.forEach((row) => {
    let code = '';
    let prod = 'Scanned Item';
    let discount = '';

    // Smart Column Matching
    Object.keys(row).forEach((k) => {
      const keyLower = k.toLowerCase().trim();
      const val = String(row[k]).trim();
      if (!val) return;

      if (keyLower.includes('bar') || keyLower.includes('code') || keyLower.includes('upc') || keyLower.includes('ean') || keyLower.includes('sku') || keyLower.includes('id')) {
        if (!code) code = val;
      } else if (keyLower.includes('disc') || keyLower.includes('sale') || keyLower.includes('off') || keyLower.includes('deal') || keyLower.includes('price')) {
        if (!discount) discount = val;
      } else if (keyLower.includes('name') || keyLower.includes('desc') || keyLower.includes('item') || keyLower.includes('prod') || keyLower.includes('title')) {
        if (prod === 'Scanned Item') prod = val;
      }
    });

    // Fallback: If no column headers matched standard naming
    const values = Object.values(row).map(v => String(v).trim()).filter(Boolean);
    if (!code && values.length > 0) code = values[0];
    if (!discount && values.length > 1) discount = values[values.length - 1];

    if (code) {
      const norm = normalizeCode(code);
      state.discountDb.set(norm, {
        originalCode: code,
        prod: prod,
        discount: discount || 'On Sale!'
      });
      count++;
    }
  });

  if (count > 0) {
    updateSheetUI(sheetName, `${count} items loaded`);
  } else {
    alert('No usable barcodes found in file.');
  }
}

// Sample Deals Loader
function loadSampleDeals() {
  processSheetData(SAMPLE_DEALS, 'Sample Deals Catalog');
}

// Clear Loaded Sheet
function clearSheet() {
  state.discountDb.clear();
  updateSheetUI('No sheet loaded', 'Upload .xlsx, .csv or .json');
  document.getElementById('clearBtn').style.display = 'none';
}

// Update Sheet Status UI
function updateSheetUI(title, meta) {
  document.getElementById('sheetTitle').textContent = title;
  document.getElementById('sheetMeta').textContent = meta;
  document.getElementById('clearBtn').style.display = 'inline-block';
}

// Camera Scanner Management
async function toggleScanner() {
  if (state.isScanning) {
    await stopScanner();
  } else {
    await startScanner();
  }
}

// Fast High-Performance Scanner Config
async function startScanner() {
  if (state.isScanning) return;

  try {
    if (!state.html5Qrcode) {
      state.html5Qrcode = new Html5Qrcode('reader');
    }

    const config = {
      fps: 30, // Boosted to 30 FPS for fast scanning
      qrbox: { width: 280, height: 160 },
      aspectRatio: 1.333333,
      // Target specific 1D retail barcode formats to reduce processor load
      formatsToSupport: [
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39
      ]
    };

    await state.html5Qrcode.start(
      { facingMode: 'environment' },
      config,
      onScanSuccess,
      onScanFailure
    );

    state.isScanning = true;
    updateScannerUI(true);
  } catch (err) {
    console.error('Camera startup error:', err);
    alert('Camera access failed. Please ensure camera permissions are granted.');
    updateScannerUI(false);
  }
}

async function stopScanner() {
  if (!state.isScanning || !state.html5Qrcode) return;

  try {
    await state.html5Qrcode.stop();
    state.isScanning = false;
    updateScannerUI(false);
  } catch (err) {
    console.error('Camera stop error:', err);
  }
}

function updateScannerUI(active) {
  const liveDot = document.getElementById('liveDot');
  const statusText = document.getElementById('statusText');
  const scannerIdle = document.getElementById('scannerIdle');
  const reticle = document.getElementById('reticle');
  const scanBtn = document.getElementById('scanBtn');

  if (active) {
    liveDot.classList.add('active');
    statusText.textContent = 'SCANNING';
    scannerIdle.style.display = 'none';
    reticle.style.display = 'flex';
    scanBtn.textContent = '⏹️ Stop Camera';
    scanBtn.className = 'btn btn-amber';
  } else {
    liveDot.classList.remove('active');
    statusText.textContent = 'Idle';
    scannerIdle.style.display = 'block';
    reticle.style.display = 'none';
    scanBtn.textContent = '📸 Start Scanning!';
    scanBtn.className = 'btn btn-pink';
  }
}

// Scanner Callback Handlers
function onScanSuccess(decodedText) {
  lookupBarcode(decodedText);
}

function onScanFailure(error) {
  // Continuous scanning frame failures are ignored to avoid console noise
}

// Manual Entry Handler
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

  // Reduced cooldown debounce from 2200ms to 800ms for faster multi-item scans
  if (state.lastScannedCode === norm && (now - state.lastScanTime) < 800) {
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
