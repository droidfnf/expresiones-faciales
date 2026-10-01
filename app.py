"""Aplicación local de estimación de expresiones faciales."""

from __future__ import annotations

import base64
import binascii
import threading

import cv2
import numpy as np
from fer.fer import FER
from flask import Flask, jsonify, render_template, request

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 2 * 1024 * 1024

_detector: FER | None = None
_model_lock = threading.Lock()
_detector_lock = threading.Lock()


def get_detector() -> FER:
    global _detector
    if _detector is None:
        with _model_lock:
            if _detector is None:
                # FER incluye una red neuronal convolucional preentrenada.
                _detector = FER(mtcnn=False)
    return _detector


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/health")
def health():
    return jsonify({"status": "ok", "model_loaded": _detector is not None})


@app.post("/api/predict")
def predict():
    payload = request.get_json(silent=True) or {}
    image_data = payload.get("image", "")
    if not isinstance(image_data, str) or "," not in image_data:
        return jsonify({"error": "No se recibió una imagen válida."}), 400

    try:
        encoded = image_data.split(",", 1)[1]
        raw = base64.b64decode(encoded, validate=True)
        image_array = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
    except (ValueError, binascii.Error):
        return jsonify({"error": "La imagen recibida no se pudo leer."}), 400

    if image_array is None or image_array.size == 0:
        return jsonify({"error": "La imagen recibida no se pudo leer."}), 400

    height, width = image_array.shape[:2]
    # Reducimos el tamaño para enviar pocos datos y mantener el análisis ágil.
    max_side = 640
    scale = min(1.0, max_side / max(width, height))
    if scale < 1:
        image_array = cv2.resize(
            image_array, (round(width * scale), round(height * scale)), interpolation=cv2.INTER_AREA
        )

    try:
        with _detector_lock:
            faces = get_detector().detect_emotions(image_array)
    except Exception:
        app.logger.exception("Falló la inferencia del modelo FER")
        return jsonify({"error": "El modelo no pudo analizar este fotograma."}), 500

    if not faces:
        return jsonify({"faces": [], "width": image_array.shape[1], "height": image_array.shape[0]})

    # El detector encuentra caras; esta demo presenta la mayor para evitar
    # combinar las expresiones de varias personas.
    face = max(faces, key=lambda item: item["box"][2] * item["box"][3])
    x, y, box_width, box_height = [int(value) for value in face["box"]]
    return jsonify(
        {
            "faces": [
                {
                    "box": [x, y, box_width, box_height],
                    "expressions": face["emotions"],
                }
            ],
            "width": image_array.shape[1],
            "height": image_array.shape[0],
        }
    )


@app.errorhandler(413)
def too_large(_error):
    return jsonify({"error": "El fotograma es demasiado grande."}), 413


if __name__ == "__main__":
    # Solo escucha en el equipo local; no expone la cámara a la red.
    app.run(host="127.0.0.1", port=5000, debug=False, threaded=True)
