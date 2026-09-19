const STORAGE_KEY = "fahrtwert.trips.v1";
// App reference for RS 3 8Y (2023); not a certified consumption at 100 km/h.
const FEI_REFERENCE_CONSUMPTION = 9.3;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  trips: loadTrips(),
  imageData: "",
  sort: "fei",
  scanning: false,
  ocrImage: null,
  editingId: null,
};

const elements = {
  form: $("#tripForm"),
  photoInput: $("#photoInput"),
  photoDrop: $("#photoDrop"),
  photoPreview: $("#photoPreview"),
  previewImage: $("#previewImage"),
  scanStatus: $("#scanStatus"),
  scanAgainButton: $("#scanAgainButton"),
  confidenceBadge: $("#confidenceBadge"),
  date: $("#tripDate"),
  name: $("#tripName"),
  distance: $("#distance"),
  consumption: $("#consumption"),
  duration: $("#duration"),
  averageSpeed: $("#averageSpeed"),
  scoreRing: $("#scoreRing"),
  scoreValue: $("#scoreValue"),
  scoreLabel: $("#scoreLabel"),
  scoreExplanation: $("#scoreExplanation"),
  tripList: $("#tripList"),
  emptyState: $("#emptyState"),
  toast: $("#toast"),
};

elements.date.value = new Date().toISOString().slice(0, 10);
renderAll();
registerServiceWorker();
registerWebMCP();
if (location.hash === "#vergleichen") switchView("compare");

$$('[data-target]').forEach((button) => button.addEventListener("click", () => switchView(button.dataset.target)));
$$('[data-go]').forEach((button) => button.addEventListener("click", () => switchView(button.dataset.go)));
$$('[data-sort]').forEach((button) => button.addEventListener("click", () => {
  state.sort = button.dataset.sort;
  $$('[data-sort]').forEach((item) => item.classList.toggle("is-active", item === button));
  renderTrips();
}));

let cameraStream = null;
let cameraRequest = 0;
let cameraReadyTimer;
const cameraDialog = $("#cameraDialog");
const cameraVideo = $("#cameraVideo");
elements.photoDrop.addEventListener("click", openCamera);
$("#cameraAgain").addEventListener("click", openCamera);
$("#cameraRetry").addEventListener("click", () => {
  stopCamera();
  openCamera(true);
});
$("#cameraClose").addEventListener("click", () => cameraDialog.close());
cameraDialog.addEventListener("close", stopCamera);
function cameraReady() {
  if (!cameraDialog.open || !cameraStream || !cameraVideo.videoWidth || cameraVideo.readyState < 2 || cameraVideo.paused) return;
  clearTimeout(cameraReadyTimer);
  $("#cameraCapture").disabled = false;
  $("#cameraStatus").textContent = "Vier Werte im Raster ausrichten und aufnehmen.";
}
cameraVideo.addEventListener("playing", cameraReady);
cameraVideo.addEventListener("loadeddata", cameraReady);
cameraVideo.addEventListener("waiting", () => {
  $("#cameraCapture").disabled = true;
  $("#cameraStatus").textContent = "Kamerabild lädt … Bei schwarzem Bild bitte Kamera neu starten.";
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && cameraStream && cameraDialog.open) cameraDialog.close();
});
window.addEventListener("pagehide", stopCamera);
$("#cameraCapture").addEventListener("click", captureCamera);

async function openCamera(restart = false) {
  if (state.scanning || (cameraDialog.open && restart !== true)) return;
  const request = ++cameraRequest;
  $("#cameraCapture").disabled = true;
  $("#cameraStatus").textContent = "Kamerazugriff bitte erlauben …";
  if (!cameraDialog.open) cameraDialog.showModal();
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera unavailable");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: false,
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
    if (request !== cameraRequest || !cameraDialog.open) {
      stream.getTracks().forEach(track => track.stop());
      return;
    }
    cameraStream = stream;
    cameraVideo.muted = true;
    cameraVideo.playsInline = true;
    cameraVideo.srcObject = stream;
    cameraReadyTimer = setTimeout(() => {
      if (request === cameraRequest && cameraDialog.open && $("#cameraCapture").disabled) {
        $("#cameraStatus").textContent = "Noch kein Kamerabild. Bitte Kamera neu starten oder ein vorhandenes Foto auswählen.";
      }
    }, 8000);
    await cameraVideo.play();
    if (request === cameraRequest) cameraReady();
  } catch (error) {
    if (request !== cameraRequest) return;
    stopCamera();
    $("#cameraStatus").textContent = "Kamera nicht verfügbar. Bitte den Kamerazugriff erlauben oder nach dem Schließen ein Foto auswählen.";
  }
}

function stopCamera() {
  clearTimeout(cameraReadyTimer);
  cameraRequest++;
  cameraStream?.getTracks().forEach(track => track.stop());
  cameraStream = null;
  cameraVideo.srcObject = null;
  $("#cameraCapture").disabled = true;
}

// Map the visible overlay through object-fit: cover into source video pixels.
function cameraSourceRect(sourceWidth, sourceHeight, viewWidth, viewHeight, grid) {
  const scale = Math.max(viewWidth / sourceWidth, viewHeight / sourceHeight);
  const offsetX = (sourceWidth * scale - viewWidth) / 2;
  const offsetY = (sourceHeight * scale - viewHeight) / 2;
  return { x: (grid.x + offsetX) / scale, y: (grid.y + offsetY) / scale,
    width: grid.width / scale, height: grid.height / scale };
}

async function captureCamera() {
  if (!cameraStream || !cameraVideo.videoWidth || cameraVideo.readyState < 2 || cameraVideo.paused) return;
  $("#cameraCapture").disabled = true;
  try {
    const view = cameraVideo.getBoundingClientRect();
    const grid = $("#cameraGrid").getBoundingClientRect();
    const rect = cameraSourceRect(cameraVideo.videoWidth, cameraVideo.videoHeight, view.width, view.height,
      { x: grid.left - view.left, y: grid.top - view.top, width: grid.width, height: grid.height });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(rect.width));
    canvas.height = Math.max(1, Math.round(rect.height));
    canvas.getContext("2d").drawImage(cameraVideo, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height);
    cameraDialog.close();
    stopCamera();
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("Capture failed");
    const loaded = await handleImage(new File([blob], "bordcomputer.png", { type: "image/png" }));
    if (!loaded) return;
    $("#cropTools").open = false;
    await runOCR(state.imageData);
  } catch (error) {
    cameraDialog.close();
    stopCamera();
    setScanStatus("Aufnahme fehlgeschlagen. Bitte erneut versuchen oder ein Foto auswählen.", "error");
  }
}

elements.photoInput.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (file) handleImage(file);
});

["dragenter", "dragover"].forEach((eventName) => elements.photoDrop.addEventListener(eventName, (event) => {
  event.preventDefault();
  elements.photoDrop.classList.add("is-dragging");
}));
["dragleave", "drop"].forEach((eventName) => elements.photoDrop.addEventListener(eventName, (event) => {
  event.preventDefault();
  elements.photoDrop.classList.remove("is-dragging");
}));
elements.photoDrop.addEventListener("drop", (event) => {
  const file = event.dataTransfer?.files?.[0];
  if (file?.type.startsWith("image/")) handleImage(file);
});

elements.scanAgainButton.addEventListener("click", () => runOCR(state.imageData));
["cropLeft", "cropTop", "cropWidth", "cropHeight"].forEach((id) => {
  $("#" + id).addEventListener("input", drawCrop);
});
elements.form.addEventListener("input", updateScorePreview);
$("#accEnabled").addEventListener("change", syncACC);
$("#cancelEditButton").addEventListener("click", () => {
  if (state.scanning) return;
  resetCapture();
  switchView("compare");
});
elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (state.scanning) return;
  const trip = tripFromForm();
  if (!trip) return;
  const editing = Boolean(state.editingId);
  if (editing) {
    state.trips = state.trips.map((item) => item.id === state.editingId ? trip : item);
    persistTrips();
    renderAll();
  } else addTrip(trip);
  resetCapture();
  switchView("compare");
  showToast(editing ? "Änderungen gespeichert" : "Fahrt gespeichert");
});

$("#tripList").addEventListener("click", (event) => {
  if (state.scanning) return;
  const edit = event.target.closest("[data-edit]");
  if (edit) { editTrip(edit.dataset.edit); return; }
  const button = event.target.closest("[data-delete]");
  if (!button) return;
  state.trips = state.trips.filter((trip) => trip.id !== button.dataset.delete);
  if (state.editingId === button.dataset.delete) resetCapture();
  persistTrips();
  renderAll();
  showToast("Fahrt gelöscht");
});

const privacyDialog = $("#privacyDialog");
$("#privacyButton").addEventListener("click", () => privacyDialog.showModal());
$(".dialog-close").addEventListener("click", () => privacyDialog.close());
privacyDialog.addEventListener("click", (event) => {
  if (event.target === privacyDialog) privacyDialog.close();
});

async function handleImage(file) {
  if (state.scanning) return;
  if (!file.type.startsWith("image/")) {
    setScanStatus("Bitte ein Bild auswählen.", "error");
    return;
  }
  try {
    // Keep the source separately: storage thumbnails must not limit OCR quality.
    const source = URL.createObjectURL(file);
    try {
      state.ocrImage = await loadImage(source);
    } finally {
      URL.revokeObjectURL(source);
    }
    state.imageData = await resizeImage(file, 1400, 0.85);
    [elements.distance, elements.consumption, elements.duration, elements.averageSpeed].forEach((input) => input.value = "");
    elements.confidenceBadge.hidden = true;
    $("#ocrDetails").hidden = true;
    updateScorePreview();
    ["cropLeft", "cropTop"].forEach((id) => $("#" + id).value = 0);
    ["cropWidth", "cropHeight"].forEach((id) => $("#" + id).value = 100);
    $("#cropTools").hidden = false;
    drawCrop();
    elements.previewImage.src = state.imageData;
    elements.photoDrop.hidden = true;
    elements.photoPreview.hidden = false;
    elements.scanAgainButton.hidden = false;
    $("#cropTools").open = true;
    setScanStatus("Ausschnitt auf die vier Werte unter dem Strich einstellen, dann Werte erkennen.");
    return true;
  } catch (error) {
    console.error(error);
    setScanStatus("Das Bild konnte nicht gelesen werden.", "error");
  }
}

async function runOCR(imageData) {
  if (!imageData || state.scanning) return;
  if (!window.Tesseract) {
    setScanStatus("Texterkennung ist offline nicht verfügbar. Werte bitte manuell eintragen.", "error");
    return;
  }
  state.scanning = true;
  elements.photoInput.disabled = true;
  elements.scanAgainButton.disabled = true;
  $("#saveButton").disabled = true;
  $$("#cropTools input").forEach((input) => input.disabled = true);
  elements.confidenceBadge.hidden = true;
  [elements.distance, elements.consumption, elements.duration, elements.averageSpeed].forEach((input) => input.value = "");
  updateScorePreview();
  $("#ocrText").textContent = "";
  $("#ocrDetails").hidden = false;
  elements.photoPreview.classList.add("is-scanning");
  setScanStatus("Bild wird vorbereitet …", "working");
  let worker;
  let pass = 1;
  try {
    worker = await window.Tesseract.createWorker("eng", 1, {
      logger(message) {
        if (message.status === "recognizing text") {
          setScanStatus(`Feld ${pass}/4 · ${Math.round((message.progress || 0) * 100)} %`, "working");
        }
      },
    });
    const values = {};
    const fields = ["consumption", "duration", "averageSpeed", "distance"];
    const labels = ["Oben links: Verbrauch", "Oben rechts: Fahrzeit", "Unten links: Ø-Tempo", "Unten rechts: Strecke"];
    const readings = fields.map(() => []);
    setScanStatus("Wertebereich und Textzeilen werden gesucht …", "working");
    const overview = await prepareOCR("original");
    await worker.setParameters({ tessedit_pageseg_mode: "11" });
    const located = await worker.recognize(overview);
    const layout = findDashboardFields(located.data.words || [], overview.width, overview.height);
    if (layout) layout.forEach((region,index) => {
      const value = parseFieldText(region.text || "", fields[index]);
      if (value !== undefined) readings[index].push({value,confidence:region.confidence || 0});
    });
    $("#ocrText").textContent = layout ? "Vier Textfelder automatisch gefunden.\n" : "Raster verwendet; bei fehlenden Werten bitte den Ausschnitt prüfen.\n";
    for (const mode of ["original", "inverted", "contrast"]) {
      const processed = await prepareOCR(mode);
      for (let index = 0; index < fields.length; index++) {
        pass = index + 1;
        const region = layout?.[index] || fieldRectangle(processed.width, processed.height, index);
        const canvas = document.createElement("canvas");
        canvas.width = region.width + 40;
        canvas.height = region.height + 40;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = mode !== "original" ? "white" : "black";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(processed, region.left, region.top, region.width, region.height, 20, 20, region.width, region.height);
        await worker.setParameters({ tessedit_pageseg_mode: "7", preserve_interword_spaces: "1" });
        const result = await worker.recognize(canvas);
        const value = parseFieldText(result.data.text, fields[index]);
        if (value !== undefined) readings[index].push({ value, confidence: result.data.confidence || 0 });
        $("#ocrText").textContent += `${labels[index]} (${mode})\n${result.data.text}\n`;
      }
    }
    fields.forEach((field, index) => {
      values[field] = chooseReading(readings[index]);
    });
    // Reject impossible distance candidates; never manufacture a value from speed/time.
    if (values.duration && values.averageSpeed) {
      const [hours,minutes] = values.duration.split(":").map(Number);
      const expected = (hours+minutes/60)*values.averageSpeed;
      const plausible = readings[3].filter(r => Math.abs(r.value-expected)/Math.max(expected,1)<.2);
      if (plausible.length) values.distance = chooseReading(plausible);
    }
    const found = applyRecognizedValues(values);
    if (found) {
      elements.confidenceBadge.hidden = false;
      elements.confidenceBadge.textContent = `${found} Wert${found === 1 ? "" : "e"} erkannt`;
      setScanStatus(`${found}/4 Werte erkannt · ${found < 4 ? "leere Felder sind unklar, bitte manuell ergänzen" : "bitte prüfen"}`, "done");
    } else {
      setScanStatus("Keine sicheren Werte erkannt. Bitte manuell eintragen.", "error");
    }
  } catch (error) {
    console.error(error);
    setScanStatus("Erkennung fehlgeschlagen. Die Werte können manuell eingetragen werden.", "error");
  } finally {
    if (worker) await worker.terminate().catch(console.error);
    state.scanning = false;
    elements.photoInput.disabled = false;
    elements.scanAgainButton.disabled = false;
    $("#saveButton").disabled = false;
    $$("#cropTools input").forEach((input) => input.disabled = false);
    elements.photoPreview.classList.remove("is-scanning");
  }
}

function chooseReading(readings) {
  const groups = new Map();
  readings.forEach(({value, confidence}) => {
    const group = groups.get(value) || { value, count: 0, confidence: 0 };
    group.count++;
    group.confidence = Math.max(group.confidence, confidence);
    groups.set(value, group);
  });
  const ranked = [...groups.values()].sort((a,b) => b.count - a.count || b.confidence - a.confidence);
  if (!ranked.length) return undefined;
  if (ranked.length > 1) return undefined;
  return ranked[0].value;
}

function findDashboardFields(words, width, height) {
  const cy = w => (w.bbox.y0 + w.bbox.y1) / 2;
  const numbers = words.filter(w => /\d[.,]\d|\d{2,}/.test(w.text));
  const anchors = words.filter(w => /^\d{1,3}\s*:\s*[0-5]\d\s*[hn]$/i.test(w.text));
  const layouts = [];
  for (const time of anchors) {
    const a = time.bbox, h = a.y1-a.y0;
    if (h < 3) continue;
    const left = numbers.filter(w => w.bbox.x1 < a.x0-h*.5 && w.bbox.x0 > a.x0-h*12);
    const fuel = left.filter(w => /\d[.,]\d/.test(w.text) && Math.abs(cy(w)-cy(time)) < h*1.3 && cy(w) < cy(time)+h*.5)
      .sort((u,v) => Math.abs(cy(u)-cy(time))-Math.abs(cy(v)-cy(time)))[0];
    if (!fuel) continue;
    const speed = left.filter(w => cy(w)>cy(fuel)+h*.8 && cy(w)<cy(time)+h*3.5)
      .sort((u,v) => cy(u)-cy(v))[0];
    let distance = numbers.filter(w => w!==time && w.bbox.x0>a.x0-h*3 && w.bbox.x0<a.x1+h
      && cy(w)>cy(time)+h*.7 && cy(w)<cy(time)+h*3.5)
      .sort((u,v) => cy(u)-cy(v))[0];
    if (!speed) continue;
    if (!distance) distance = {bbox:{x0:a.x0-h*1.3,x1:a.x1+h,y0:speed.bbox.y0-h*.2,y1:speed.bbox.y1+h*.2}};
    const fuelBox = {...fuel, bbox:{...fuel.bbox,x1:Math.min(a.x0-h*.6, fuel.bbox.x1+h*3)}};
    layouts.push([fuelBox,time,speed,distance].map(word => {
      const box=word.bbox, pad=h*.18;
      const left=Math.max(0,Math.floor(box.x0-pad)), top=Math.max(0,Math.floor(box.y0-pad));
      return {left,top,width:Math.min(width-left,Math.ceil(box.x1+pad-left)),height:Math.min(height-top,Math.ceil(box.y1+pad-top)),text:word.text || "",confidence:word.confidence || 0};
    }));
  }
  return layouts.length === 1 ? layouts[0] : null;
}

function fieldRectangle(width, height, index) {
  const splitX = Math.round(width * 0.6);
  const splitY = Math.round(height * 0.5);
  const right = index % 2 === 1;
  const bottom = index >= 2;
  return { left: right ? splitX : 0, top: bottom ? splitY : 0,
    width: right ? width - splitX : splitX, height: bottom ? height - splitY : splitY };
}

function parseFieldText(raw, field) {
  if (/^[<>]/.test(raw.trim())) return undefined;
  const text = raw.replace(/^[\søØ@©®oO2]+\s+(?=\d)/, "")
    .replace(/(\d)[.,](?=\d{3}[.,]\d)/g, "$1")
    .replace(/,/g, ".").replace(/(?<=\d)[Oo](?=\d|\b)/g, "0")
    .replace(/\s*\.\s*/g, ".");
  if (field === "duration") {
    const match = text.match(/\b(\d{1,3})\s*[:.]\s*([0-5]\d)(?!\d)/);
    return match ? `${Number(match[1])}:${match[2]}` : undefined;
  }
  // Units are optional: position, not the presence of km or l, determines the field.
  const withoutUnits = text.replace(/(?:l|i|1|\||v|\\)\s*\/?\s*100\s*k?m/gi, "")
    .replace(/(?:\s+\/?|\/)100\s*k?m\b/gi, "");
  const matches = withoutUnits.match(/\d+(?:\.\d+)?/g) || [];
  if (matches.length !== 1) return undefined;
  const value = Number(matches[0]);
  const max = field === "consumption" ? 60 : field === "averageSpeed" ? 350 : 999999;
  return value > 0 && value <= max ? value : undefined;
}

function parseDashboardText(rawText) {
  const text = rawText.replace(/(?<=\d)[Oo](?=\d|\s|$)/g, "0")
    .replace(/(\d)[.,](?=\d{3}[.,]\d)/g, "$1")
    .replace(/,/g, ".").replace(/[|]/g, "l")
    .replace(/(\d)\s*v\s*100\s*km/gi, "$1 l/100km")
    .replace(/km\s*\/\s*r\b/gi, "km/h");
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const fuelMatch = text.match(/\b(\d{1,2}(?:\s*\.\s*\d)?)\s*(?:l|1|i)\s*\/?\s*100\s*k?m/i);
  const durationMatch = text.match(/\b(\d{1,3})\s*[:.]\s*([0-5]\d)\s*h\b/i)
    || (text.match(/\b\d{1,3}\s*:\s*[0-5]\d\b/g)?.length === 1 ? text.match(/\b(\d{1,3})\s*:\s*([0-5]\d)\b/) : null);
  const speedMatches = [...text.matchAll(/(\d{1,3})\s*k?m\s*\/?\s*h/gi)]
    .map((match) => Number(match[1]))
    .filter((value) => value >= 1 && value <= 250);

  let distance;
  const pairedLine = lines.find((line) => /km\s*\/?\s*h/i.test(line) && /\d(?:[.,]\d)?\s*km/i.test(line.replace(/km\s*\/?\s*h/gi, "")));
  if (pairedLine) {
    const cleaned = pairedLine.replace(/\d{1,3}\s*k?m\s*\/?\s*h/gi, "");
    const match = cleaned.match(/(\d{1,5}(?:\.\d)?)\s*k?m/i);
    if (match) distance = Number(match[1]);
  }
  if (!distance) {
    const distanceText = text.replace(/\d{1,2}(?:\s*\.\s*\d)?\s*(?:l|1|i)\s*\/?\s*100\s*k?m/gi, "");
    const candidates = [...distanceText.matchAll(/\b(\d{1,5}(?:\.\d)?)\s*k?m\b(?!\s*\/?\s*h)/gi)]
      .map((match) => Number(match[1]))
      .filter((value) => value >= 1 && value < 10000);
    if (durationMatch && speedMatches.length) {
      const expected = (Number(durationMatch[1]) + Number(durationMatch[2]) / 60) * speedMatches[0];
      const plausible = candidates.filter((value) => Math.abs(value - expected) / Math.max(expected, 1) < 0.15);
      const decimalCandidates = plausible.filter((value) => !Number.isInteger(value));
      if (decimalCandidates.length === 1) distance = decimalCandidates[0];
      else if (plausible.length === 1) distance = plausible[0];
    }
    if (distance === undefined && candidates.length === 1) distance = candidates[0];
  }

  return {
    consumption: fuelMatch ? Number(fuelMatch[1].replace(/\s/g, "")) : undefined,
    duration: durationMatch ? `${durationMatch[1]}:${durationMatch[2]}` : undefined,
    averageSpeed: speedMatches[0],
    distance,
  };
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = source;
  });
}

function cropBounds(image) {
  const left = Number($("#cropLeft").value) / 100;
  const top = Number($("#cropTop").value) / 100;
  const width = Math.min(Number($("#cropWidth").value) / 100, 1 - left);
  const height = Math.min(Number($("#cropHeight").value) / 100, 1 - top);
  return [left * image.width, top * image.height, width * image.width, height * image.height];
}

function drawCrop() {
  if (!state.ocrImage) return;
  const canvas = $("#cropPreview");
  const [x, y, w, h] = cropBounds(state.ocrImage);
  canvas.width = Math.max(1, Math.round(600 * w / Math.max(w, h)));
  canvas.height = Math.max(1, Math.round(600 * h / Math.max(w, h)));
  canvas.getContext("2d").drawImage(state.ocrImage, x, y, w, h, 0, 0, canvas.width, canvas.height);
  const ctx = canvas.getContext("2d");
  ctx.strokeStyle = "#42e8cf";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(canvas.width * .6, 0);
  ctx.lineTo(canvas.width * .6, canvas.height);
  ctx.moveTo(0, canvas.height * .5);
  ctx.lineTo(canvas.width, canvas.height * .5);
  ctx.stroke();
}

async function prepareOCR(mode) {
  const image = state.ocrImage || await loadImage(state.imageData);
  const [x, y, w, h] = cropBounds(image);
  const scale = Math.min(3, 3200 / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, x, y, w, h, 0, 0, canvas.width, canvas.height);
  if (mode !== "original") {
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const histogram = new Uint32Array(256);
    if (mode === "contrast") {
      for (let i=0;i<pixels.data.length;i+=4) histogram[Math.round(pixels.data[i]*.299+pixels.data[i+1]*.587+pixels.data[i+2]*.114)]++;
    }
    let low=0, high=255, count=0;
    if (mode === "contrast") {
      const cutoff=canvas.width*canvas.height*.02;
      while(low<254 && count+histogram[low]<cutoff) count+=histogram[low++];
      count=0;
      while(high>low+1 && count+histogram[high]<cutoff) count+=histogram[high--];
    }
    for (let i = 0; i < pixels.data.length; i += 4) {
      const gray = pixels.data[i] * .299 + pixels.data[i + 1] * .587 + pixels.data[i + 2] * .114;
      const value = mode === "contrast" ? 255-Math.max(0,Math.min(255,(gray-low)*255/(high-low))) : mode === "threshold" ? (gray > 155 ? 0 : 255) : 255 - gray;
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = value;
    }
    context.putImageData(pixels, 0, 0);
  }
  return canvas;
}

function applyRecognizedValues(values) {
  let found = 0;
  const assignments = [
    [elements.distance, values.distance],
    [elements.consumption, values.consumption],
    [elements.duration, values.duration],
    [elements.averageSpeed, values.averageSpeed],
  ];
  assignments.forEach(([input, value]) => {
    if (value !== undefined && value !== null && value !== "" && Number(value) !== 0) {
      input.value = typeof value === "number" ? formatInputNumber(value) : value;
      found += 1;
    }
  });
  updateScorePreview();
  return found;
}

function tripFromForm() {
  const existing = state.trips.find((trip) => trip.id === state.editingId);
  const accEnabled = $("#accEnabled").checked;
  const accSpeed = Number($("#accSpeed").value);
  if (accEnabled && (!Number.isInteger(accSpeed) || accSpeed < 1 || accSpeed > 350)) {
    showToast("Bitte eine ACC-Geschwindigkeit von 1 bis 350 km/h eingeben");
    return null;
  }
  const distance = parseLocaleNumber(elements.distance.value);
  const consumption = parseLocaleNumber(elements.consumption.value);
  const durationMinutes = parseDuration(elements.duration.value);
  const averageSpeed = parseLocaleNumber(elements.averageSpeed.value);
  if (!(distance > 0) || !(consumption > 0) || !(durationMinutes > 0)) {
    showToast("Bitte Strecke, Verbrauch und Fahrzeit prüfen");
    return null;
  }
  return {
    ...existing,
    id: existing?.id || (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`),
    accEnabled,
    accSpeed: accEnabled ? accSpeed : null,
    traffic: $("#traffic").value,
    roadTypes: ["Motorway", "Country", "City"].filter(type => $("#road" + type).checked),
    date: elements.date.value,
    name: elements.name.value.trim() || "Fahrt",
    distance,
    consumption,
    durationMinutes,
    averageSpeed: averageSpeed > 0 ? averageSpeed : Math.round(distance / (durationMinutes / 60)),
    image: state.imageData,
    createdAt: existing?.createdAt ?? Date.now(),
    fei: calculateFEI(consumption, distance, durationMinutes),
  };
}

function syncACC() {
  const enabled = $("#accEnabled").checked;
  $("#accSpeedField").hidden = !enabled;
  $("#accSpeed").disabled = !enabled;
  $("#accSpeed").required = enabled;
}

function editTrip(id) {
  const trip = state.trips.find((item) => item.id === id);
  if (!trip) return;
  resetCapture();
  state.editingId = id;
  elements.date.value = trip.date;
  elements.name.value = trip.name;
  elements.distance.value = formatInputNumber(trip.distance);
  elements.consumption.value = formatInputNumber(trip.consumption);
  elements.duration.value = formatDuration(trip.durationMinutes).replace(/ h$/, "");
  elements.averageSpeed.value = formatInputNumber(trip.averageSpeed);
  $("#accEnabled").checked = Boolean(trip.accEnabled);
  $("#accSpeed").value = trip.accSpeed ?? "";
  $("#traffic").value = ["0", "+", "++"].includes(trip.traffic) ? trip.traffic : "";
  ["Motorway", "Country", "City"].forEach(type => {
    $("#road" + type).checked = Array.isArray(trip.roadTypes) && trip.roadTypes.includes(type);
  });
  syncACC();
  state.imageData = trip.image || "";
  if (state.imageData) {
    elements.previewImage.src = state.imageData;
    elements.photoPreview.hidden = false;
    elements.photoDrop.hidden = true;
  }
  // Existing values should only change by explicit manual edits or a new photo.
  elements.scanAgainButton.hidden = true;
  $("#saveButton span").textContent = "Änderungen speichern";
  $("#cancelEditButton").hidden = false;
  setScanStatus("Gespeicherte Fahrt bearbeiten");
  updateScorePreview();
  switchView("capture");
}

function addTrip(trip) {
  state.trips.unshift(trip);
  persistTrips();
  renderAll();
}

function updateScorePreview() {
  const distance = parseLocaleNumber(elements.distance.value);
  const consumption = parseLocaleNumber(elements.consumption.value);
  const durationMinutes = parseDuration(elements.duration.value);
  const fei = calculateFEI(consumption, distance, durationMinutes);
  if (!Number.isFinite(fei)) {
    elements.scoreValue.textContent = "–";
    elements.scoreLabel.textContent = "Werte eingeben";
    elements.scoreExplanation.textContent = "Je kleiner der Fahr-Effizienz-Index, desto effizienter die Fahrt.";
    elements.scoreRing.style.setProperty("--score-angle", "0deg");
    return;
  }
  const verdict = getVerdict(fei);
  elements.scoreValue.textContent = fei.toFixed(1).replace(".", ",");
  elements.scoreLabel.textContent = verdict.label;
  elements.scoreExplanation.textContent = verdict.copy;
  elements.scoreRing.style.setProperty("--score-angle", `${Math.min(360, Math.max(34, (150 / fei) * 250))}deg`);
  elements.scoreRing.style.setProperty("--ring", verdict.color);
}

function renderAll() {
  renderTrips();
  renderSummary();
  $("#navCount").textContent = state.trips.length;
  $("#navCount").hidden = state.trips.length === 0;
}

function renderTrips() {
  const trips = [...state.trips].sort((a, b) => state.sort === "fei" ? a.fei - b.fei : new Date(b.date) - new Date(a.date));
  elements.tripList.innerHTML = "";
  elements.emptyState.hidden = trips.length > 0;
  $("#listHint").textContent = trips.length ? `${trips.length} Fahrt${trips.length === 1 ? "" : "en"} im Vergleich` : "Noch keine Fahrten";
  trips.forEach((trip, index) => {
    const item = document.createElement("article");
    item.className = "trip-item";
    const date = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${trip.date}T12:00:00`));
    item.innerHTML = `
      <div class="trip-rank"><span>${state.sort === "fei" ? `#${index + 1}` : escapeHTML(date.slice(0, 2))}</span></div>
      <div class="trip-main">
        <strong>${escapeHTML(trip.name)}</strong>
        <span>${formatNumber(trip.distance, 1)} km · ${formatNumber(trip.consumption, 1)} l/100 · ${formatDuration(trip.durationMinutes)} · Ø ${formatNumber(trip.averageSpeed, 0)} km/h · ${date}</span>
        <span>${trip.accEnabled ? `ACC ${formatNumber(trip.accSpeed, 0)} km/h` : "ACC –"} · Verkehr ${escapeHTML(trip.traffic || "–")}</span>
        <span>Fahrstrecke: ${["Motorway", "Country", "City"].filter(type => Array.isArray(trip.roadTypes) && trip.roadTypes.includes(type)).map(type => ({Motorway:"Autobahn", Country:"Landstraße", City:"Stadt"})[type]).join(" · ") || "–"}</span>
      </div>
      <div class="trip-score"><strong>${formatNumber(trip.fei, 1)}</strong><small>FEI</small></div>
      <div class="trip-actions"><button class="small-button" type="button" data-edit="${escapeHTML(trip.id)}" aria-label="${escapeHTML(trip.name)} bearbeiten">Bearbeiten</button>
      <button class="trip-delete" type="button" data-delete="${escapeHTML(trip.id)}" aria-label="${escapeHTML(trip.name)} löschen">Löschen</button></div>`;
    if (trip.image) {
      const thumbnail = document.createElement("img");
      thumbnail.src = trip.image;
      thumbnail.alt = "";
      item.querySelector(".trip-rank").prepend(thumbnail);
    }
    elements.tripList.append(item);
  });
}

function renderSummary() {
  const count = state.trips.length;
  $("#tripCount").textContent = count;
  const total = state.trips.reduce((sum, trip) => sum + trip.distance, 0);
  $("#totalDistance").textContent = `${formatNumber(total, total < 100 ? 1 : 0)} km gesamt`;
  if (!count) {
    $("#bestScore").textContent = "–";
    $("#averageConsumption").textContent = "–";
    return;
  }
  $("#bestScore").textContent = formatNumber(Math.min(...state.trips.map((trip) => trip.fei)), 1);
  $("#averageConsumption").textContent = formatNumber(state.trips.reduce((sum, trip) => sum + trip.consumption, 0) / count, 1);
}

function switchView(target) {
  $$(".view").forEach((view) => {
    const active = view.dataset.view === target;
    view.hidden = !active;
    view.classList.toggle("is-active", active);
  });
  $$('[data-target]').forEach((button) => {
    const active = button.dataset.target === target;
    button.classList.toggle("is-active", active);
    if (active) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
  });
  history.replaceState(null, "", `#${target === "compare" ? "vergleichen" : "erfassen"}`);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function calculateFEI(consumption, distance, durationMinutes) {
  if (!(consumption > 0) || !(distance > 0) || !(durationMinutes > 0)) return NaN;
  return 100 * Math.sqrt((consumption / FEI_REFERENCE_CONSUMPTION) * (100 * (durationMinutes / 60) / distance));
}

function getVerdict(fei) {
  if (fei >= 90 && fei <= 100) return { label: "Effizient für den RS 3", copy: "Verbrauch und Zeit liegen im gewählten RS-3-Referenzbereich.", color: "var(--green)" };
  if (fei < 90) return { label: "Sehr effizient", copy: "Starkes Verhältnis aus Verbrauch und Zeit.", color: "var(--green)" };
  if (fei <= 110) return { label: "Ausgewogen", copy: "Nah am Referenzwert von 100.", color: "var(--cyan)" };
  return { label: "Verbrauchsintensiv", copy: "Hier lohnt sich ein Vergleich mit ruhigeren Fahrten.", color: "var(--amber)" };
}

function parseLocaleNumber(value) {
  const text = String(value || "").trim().replace(/\s/g, "");
  return Number(text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text);
}

function parseDuration(value) {
  const match = String(value || "").trim().match(/^(\d{1,3}):([0-5]\d)$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : NaN;
}

function formatDuration(minutes) {
  const hours = Math.floor(minutes / 60);
  return `${hours}:${String(minutes % 60).padStart(2, "0")} h`;
}

function formatNumber(value, digits = 1) {
  return new Intl.NumberFormat("de-DE", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

function formatInputNumber(value) {
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1, useGrouping: false }).format(value);
}

function setScanStatus(message, type = "") {
  elements.scanStatus.className = `scan-status${type ? ` is-${type}` : ""}`;
  elements.scanStatus.lastElementChild.textContent = message;
}

function resetCapture() {
  state.editingId = null;
  elements.form.reset();
  syncACC();
  elements.scanAgainButton.hidden = false;
  $("#saveButton span").textContent = "Fahrt speichern";
  $("#cancelEditButton").hidden = true;
  elements.date.value = new Date().toISOString().slice(0, 10);
  elements.photoInput.value = "";
  elements.photoDrop.hidden = false;
  elements.photoPreview.hidden = true;
  elements.previewImage.removeAttribute("src");
  elements.confidenceBadge.hidden = true;
  state.imageData = "";
  state.ocrImage = null;
  $("#cropTools").hidden = true;
  $("#ocrDetails").hidden = true;
  $("#ocrText").textContent = "";
  setScanStatus("Bereit für dein nächstes Foto");
  updateScorePreview();
}

function loadTrips() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.map(trip => ({...trip, fei: calculateFEI(trip.consumption, trip.distance, trip.durationMinutes)})) : [];
  } catch {
    return [];
  }
}

function persistTrips() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.trips));
  } catch (error) {
    console.error(error);
    const withoutImages = state.trips.map(({ image, ...trip }) => trip);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(withoutImages));
    state.trips = withoutImages;
    showToast("Speicher voll – Fahrt ohne Foto gesichert");
  }
}

function resizeImage(file, maxSize, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const image = new Image();
      image.onerror = reject;
      image.onload = () => {
        const ratio = Math.min(1, maxSize / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(image.width * ratio);
        canvas.height = Math.round(image.height * ratio);
        canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function preprocessImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onerror = reject;
    image.onload = () => {
      const canvas = document.createElement("canvas");
      const maxWidth = 1800;
      const scale = Math.min(1, maxWidth / image.width);
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      for (let index = 0; index < pixels.data.length; index += 4) {
        const gray = pixels.data[index] * .299 + pixels.data[index + 1] * .587 + pixels.data[index + 2] * .114;
        const boosted = Math.max(0, Math.min(255, (gray - 105) * 1.55 + 128));
        pixels.data[index] = pixels.data[index + 1] = pixels.data[index + 2] = boosted;
      }
      context.putImageData(pixels, 0, 0);
      resolve(canvas.toDataURL("image/jpeg", .9));
    };
    image.src = source;
  });
}

function escapeHTML(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

let toastTimer;
function showToast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  toastTimer = setTimeout(() => elements.toast.classList.remove("is-visible"), 2400);
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(console.error));
  }
}

function registerWebMCP() {
  const context = document.modelContext;
  if (!context?.registerTool) return;
  const register = (tool) => Promise.resolve(context.registerTool(tool)).catch(console.error);
  register({
    name: "list_trips",
    title: "Fahrten auflisten",
    description: "Gibt die lokal gespeicherten Fahrten samt FEI zurück.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute() {
      return { count: state.trips.length, trips: state.trips.map(({ image, ...trip }) => trip) };
    },
  });
  register({
    name: "add_trip",
    title: "Fahrt hinzufügen",
    description: "Speichert eine Fahrt aus Strecke, Verbrauch und Dauer lokal und berechnet den FEI.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        date: { type: "string", description: "Datum als YYYY-MM-DD" },
        distance: { type: "number", exclusiveMinimum: 0 },
        consumption: { type: "number", exclusiveMinimum: 0 },
        durationMinutes: { type: "number", exclusiveMinimum: 0 },
      },
      required: ["distance", "consumption", "durationMinutes"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute(input) {
      const distance = Number(input?.distance);
      const consumption = Number(input?.consumption);
      const durationMinutes = Number(input?.durationMinutes);
      if (!(distance > 0) || !(consumption > 0) || !(durationMinutes > 0)) throw new Error("Ungültige Fahrtdaten");
      const trip = {
        id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
        name: String(input.name || "Fahrt").slice(0, 40),
        date: /^\d{4}-\d{2}-\d{2}$/.test(input.date || "") ? input.date : new Date().toISOString().slice(0, 10),
        distance, consumption, durationMinutes,
        averageSpeed: Math.round(distance / (durationMinutes / 60)),
        image: "", createdAt: Date.now(),
        fei: calculateFEI(consumption, distance, durationMinutes),
      };
      addTrip(trip);
      return { id: trip.id, fei: trip.fei };
    },
  });
}
