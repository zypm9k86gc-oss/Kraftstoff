const STORAGE_KEY = "fahrtwert.trips.v1";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  trips: loadTrips(),
  imageData: "",
  sort: "fei",
  scanning: false,
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
elements.form.addEventListener("input", updateScorePreview);
elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const trip = tripFromForm();
  if (!trip) return;
  addTrip(trip);
  resetCapture();
  switchView("compare");
  showToast("Fahrt gespeichert");
});

$("#tripList").addEventListener("click", (event) => {
  const button = event.target.closest("[data-delete]");
  if (!button) return;
  state.trips = state.trips.filter((trip) => trip.id !== button.dataset.delete);
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
  if (!file.type.startsWith("image/")) {
    setScanStatus("Bitte ein Bild auswählen.", "error");
    return;
  }
  try {
    state.imageData = await resizeImage(file, 1400, 0.78);
    elements.previewImage.src = state.imageData;
    elements.photoDrop.hidden = true;
    elements.photoPreview.hidden = false;
    await runOCR(state.imageData);
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
  elements.photoPreview.classList.add("is-scanning");
  setScanStatus("Bild wird vorbereitet …", "working");
  try {
    const processed = await preprocessImage(imageData);
    const result = await window.Tesseract.recognize(processed, "deu", {
      logger(message) {
        if (message.status === "recognizing text") {
          setScanStatus(`Werte werden erkannt · ${Math.round((message.progress || 0) * 100)} %`, "working");
        }
      },
    });
    const values = parseDashboardText(result.data.text);
    const found = applyRecognizedValues(values);
    if (found) {
      elements.confidenceBadge.hidden = false;
      elements.confidenceBadge.textContent = `${found} Wert${found === 1 ? "" : "e"} erkannt`;
      setScanStatus(`${found} Wert${found === 1 ? "" : "e"} erkannt · bitte prüfen`, "done");
    } else {
      setScanStatus("Keine sicheren Werte erkannt. Bitte manuell eintragen.", "error");
    }
  } catch (error) {
    console.error(error);
    setScanStatus("Erkennung fehlgeschlagen. Die Werte können manuell eingetragen werden.", "error");
  } finally {
    state.scanning = false;
    elements.photoPreview.classList.remove("is-scanning");
  }
}

function parseDashboardText(rawText) {
  const text = rawText.replace(/O/g, "0").replace(/,/g, ".");
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const fuelMatch = text.match(/(\d{1,2}(?:\.\d)?)\s*(?:l|1)\s*\/?\s*100\s*k?m/i);
  const durationMatch = text.match(/(\d{1,3})\s*[:.]\s*([0-5]\d)\s*h/i);
  const speedMatches = [...text.matchAll(/(\d{1,3})\s*k?m\s*\/?\s*h/gi)]
    .map((match) => Number(match[1]))
    .filter((value) => value >= 10 && value <= 250);

  let distance;
  const pairedLine = lines.find((line) => /km\s*\/?\s*h/i.test(line) && /\d(?:[.,]\d)?\s*km/i.test(line.replace(/km\s*\/?\s*h/gi, "")));
  if (pairedLine) {
    const cleaned = pairedLine.replace(/\d{1,3}\s*k?m\s*\/?\s*h/gi, "");
    const match = cleaned.match(/(\d{1,5}(?:\.\d)?)\s*k?m/i);
    if (match) distance = Number(match[1]);
  }
  if (!distance) {
    const candidates = [...text.matchAll(/(\d{2,5}(?:\.\d)?)\s*k?m(?!\s*\/?\s*h)/gi)]
      .map((match) => Number(match[1]))
      .filter((value) => value >= 1 && value < 10000);
    distance = candidates.find((value) => String(value).includes(".")) || candidates[0];
  }

  return {
    consumption: fuelMatch ? Number(fuelMatch[1]) : undefined,
    duration: durationMatch ? `${durationMatch[1]}:${durationMatch[2]}` : undefined,
    averageSpeed: speedMatches[0],
    distance,
  };
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
  const distance = parseLocaleNumber(elements.distance.value);
  const consumption = parseLocaleNumber(elements.consumption.value);
  const durationMinutes = parseDuration(elements.duration.value);
  const averageSpeed = parseLocaleNumber(elements.averageSpeed.value);
  if (!(distance > 0) || !(consumption > 0) || !(durationMinutes > 0)) {
    showToast("Bitte Strecke, Verbrauch und Fahrzeit prüfen");
    return null;
  }
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    date: elements.date.value,
    name: elements.name.value.trim() || "Fahrt",
    distance,
    consumption,
    durationMinutes,
    averageSpeed: averageSpeed > 0 ? averageSpeed : Math.round(distance / (durationMinutes / 60)),
    image: state.imageData,
    createdAt: Date.now(),
    fei: calculateFEI(consumption, distance, durationMinutes),
  };
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
      </div>
      <div class="trip-score"><strong>${formatNumber(trip.fei, 1)}</strong><small>FEI</small></div>
      <button class="trip-delete" type="button" data-delete="${trip.id}" aria-label="${escapeHTML(trip.name)} löschen">Löschen</button>`;
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
  return 100 * Math.sqrt((consumption / 6) * (100 * (durationMinutes / 60) / distance));
}

function getVerdict(fei) {
  if (fei < 90) return { label: "Sehr effizient", copy: "Starkes Verhältnis aus Verbrauch und Zeit.", color: "var(--green)" };
  if (fei <= 110) return { label: "Ausgewogen", copy: "Nah am Referenzwert von 100.", color: "var(--cyan)" };
  return { label: "Verbrauchsintensiv", copy: "Hier lohnt sich ein Vergleich mit ruhigeren Fahrten.", color: "var(--amber)" };
}

function parseLocaleNumber(value) {
  return Number(String(value || "").trim().replace(/\s/g, "").replace(",", "."));
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
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(value);
}

function setScanStatus(message, type = "") {
  elements.scanStatus.className = `scan-status${type ? ` is-${type}` : ""}`;
  elements.scanStatus.lastElementChild.textContent = message;
}

function resetCapture() {
  elements.form.reset();
  elements.date.value = new Date().toISOString().slice(0, 10);
  elements.photoInput.value = "";
  elements.photoDrop.hidden = false;
  elements.photoPreview.hidden = true;
  elements.previewImage.removeAttribute("src");
  elements.confidenceBadge.hidden = true;
  state.imageData = "";
  setScanStatus("Bereit für dein nächstes Foto");
  updateScorePreview();
}

function loadTrips() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
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
