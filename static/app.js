const $ = (selector) => document.querySelector(selector);
const video = $("#video");
const overlay = $("#overlay");
const capture = document.createElement("canvas");
const captureContext = capture.getContext("2d", { willReadFrequently: true });

const emotions = {
  neutral: { model: "neutral", label: "Neutral", emoji: "😌", caption: "Rostro relajado o sin señales marcadas", message: "Una expresión tranquila también comunica. <b>Una pausa puede ser un buen momento para respirar.</b>" },
  happy: { model: "happy", label: "Alegría", emoji: "😊", caption: "Señales asociadas a una sonrisa", message: "¡Se detectan señales de alegría! <b>Ojalá encuentres algo que te siga sacando una sonrisa.</b>" },
  sad: { model: "sad", label: "Tristeza", emoji: "🌧️", caption: "Señales faciales asociadas a tristeza", message: "El modelo observa señales que suelen asociarse con tristeza. <b>Si necesitas un momento, está bien tomártelo.</b>" },
  angry: { model: "angry", label: "Enojo", emoji: "🌋", caption: "Señales faciales de tensión", message: "El rostro muestra señales que el modelo asocia con enojo. <b>Tomar aire despacio puede ayudarte a hacer una pausa.</b>" },
  fearful: { model: "fear", label: "Temor", emoji: "🌱", caption: "Señales faciales asociadas a temor", message: "Hay señales que el modelo asocia con temor. <b>Si te ayuda, haz una pausa y nota lo que necesitas en este momento.</b>" },
  disgusted: { model: "disgust", label: "Desagrado", emoji: "🍋", caption: "Señales faciales de desagrado", message: "Se observan señales que suelen asociarse con desagrado. <b>Escuchar lo que necesitas puede ser un buen primer paso.</b>" },
  surprised: { model: "surprise", label: "Sorpresa", emoji: "✨", caption: "Señales faciales de sorpresa", message: "¡El modelo detecta señales de sorpresa! <b>A veces lo inesperado abre una nueva posibilidad.</b>" },
};
const keys = Object.keys(emotions);
const emotionList = $("#emotionList");
emotionList.innerHTML = keys.map((key) => `<div class="emotion-row" data-key="${key}"><span>${emotions[key].emoji}</span><span class="mini"><i></i></span><span class="pct">0%</span></div>`).join("");

let stream = null;
let running = false;
let busy = false;
let smoothed = {};

function setStatus(label, active) {
  $("#liveLabel").textContent = label;
  $("#liveDot").style.background = active ? "var(--green)" : "#66756c";
  $("#liveDot").style.boxShadow = active ? "0 0 12px #c6f27670" : "none";
}

function toast(text) {
  const element = $("#toast");
  element.textContent = text;
  element.classList.add("show");
  setTimeout(() => element.classList.remove("show"), 3600);
}

function updateRow(key, value, active) {
  const row = document.querySelector(`[data-key="${key}"]`);
  row.classList.toggle("active", active);
  row.querySelector(".mini i").style.width = `${Math.round(value * 100)}%`;
  row.querySelector(".pct").textContent = `${Math.round(value * 100)}%`;
}

function showExpression(key) {
  keys.forEach((item) => updateRow(item, smoothed[item] || 0, item === key));
  const confidence = smoothed[key] || 0;
  if (confidence < 0.38) {
    $("#mainEmotion").textContent = "Poco concluyente";
    $("#mainCaption").textContent = "La imagen no permite una estimación clara";
    $("#mainEmoji").textContent = "🔎";
    $("#message").innerHTML = "<b>La estimación es incierta.</b> Prueba con más luz, mira hacia la cámara o relaja el rostro.";
    $("#confidenceTag").textContent = "BAJA SEÑAL";
  } else {
    const item = emotions[key];
    $("#mainEmotion").textContent = item.label;
    $("#mainCaption").textContent = item.caption;
    $("#mainEmoji").textContent = item.emoji;
    $("#message").innerHTML = item.message;
    $("#confidenceTag").textContent = `${Math.round(confidence * 100)}%`;
  }
  $("#confidenceValue").textContent = `${Math.round(confidence * 100)}%`;
  $("#confidenceBar").style.width = `${Math.round(confidence * 100)}%`;
}

function clearOverlay() {
  overlay.getContext("2d").clearRect(0, 0, overlay.width, overlay.height);
}

async function analyzeFrame() {
  if (!running || busy || video.readyState < 2) return;
  busy = true;
  try {
    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;
    const ratio = Math.min(1, 640 / Math.max(sourceWidth, sourceHeight));
    capture.width = Math.round(sourceWidth * ratio);
    capture.height = Math.round(sourceHeight * ratio);
    captureContext.drawImage(video, 0, 0, capture.width, capture.height);
    const image = capture.toDataURL("image/jpeg", 0.72);
    const response = await fetch("/api/predict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "No se pudo analizar el fotograma.");

    if (overlay.width !== sourceWidth || overlay.height !== sourceHeight) {
      overlay.width = sourceWidth;
      overlay.height = sourceHeight;
    }
    clearOverlay();

    if (!result.faces.length) {
      keys.forEach((key) => { smoothed[key] = 0; updateRow(key, 0, false); });
      $("#mainEmotion").textContent = "No detectado";
      $("#mainCaption").textContent = "Coloca tu rostro frente a la cámara";
      $("#mainEmoji").textContent = "👀";
      $("#message").innerHTML = "<b>No vemos un rostro con claridad.</b> Ajusta la posición o mejora la iluminación.";
      $("#confidenceTag").textContent = "—";
      $("#confidenceValue").textContent = "—";
      $("#confidenceBar").style.width = "0";
      return;
    }

    const face = result.faces[0];
    const [x, y, width, height] = face.box;
    const scaleX = sourceWidth / result.width;
    const scaleY = sourceHeight / result.height;
    const context = overlay.getContext("2d");
    context.strokeStyle = "#c6f276";
    context.lineWidth = Math.max(2, sourceWidth / 480);
    context.strokeRect(x * scaleX, y * scaleY, width * scaleX, height * scaleY);

    keys.forEach((key) => {
      const raw = Number(face.expressions[emotions[key].model] || 0);
      smoothed[key] = (smoothed[key] ?? raw) * 0.58 + raw * 0.42;
    });
    const winner = keys.reduce((best, key) => smoothed[key] > smoothed[best] ? key : best);
    showExpression(winner);
  } catch (error) {
    console.error(error);
    if (running) toast(error.message || "Error al analizar la cámara.");
  } finally {
    busy = false;
    if (running) setTimeout(analyzeFrame, 650);
  }
}

async function startCamera() {
  if (running) return;
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("La cámara requiere un navegador compatible y acceso local a esta página.");
    }
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 960 }, height: { ideal: 540 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    running = true;
    $("#placeholder").hidden = true;
    $("#startBtn").disabled = true;
    $("#stopBtn").disabled = false;
    setStatus("EN VIVO", true);
    analyzeFrame();
  } catch (error) {
    console.error(error);
    toast(error.name === "NotAllowedError" ? "Permite el acceso a la cámara en tu navegador." : error.message || "No fue posible iniciar la cámara.");
    setStatus("EN ESPERA", false);
  }
}

function stopCamera() {
  running = false;
  if (stream) stream.getTracks().forEach((track) => track.stop());
  stream = null;
  video.srcObject = null;
  clearOverlay();
  $("#placeholder").hidden = false;
  $("#startBtn").disabled = false;
  $("#stopBtn").disabled = true;
  setStatus("EN ESPERA", false);
  $("#mainEmotion").textContent = "En espera";
  $("#mainCaption").textContent = "Activa la cámara para comenzar";
  $("#mainEmoji").textContent = "✳";
  $("#message").innerHTML = "<b>Todo listo.</b> Cuando quieras, inicia la cámara para explorar una estimación de las expresiones visibles.";
  $("#confidenceTag").textContent = "—";
  $("#confidenceValue").textContent = "—";
  $("#confidenceBar").style.width = "0";
  smoothed = {};
  keys.forEach((key) => updateRow(key, 0, false));
}

$("#startBtn").addEventListener("click", startCamera);
$("#stopBtn").addEventListener("click", stopCamera);
window.addEventListener("pagehide", () => {
  if (stream) stream.getTracks().forEach((track) => track.stop());
});
