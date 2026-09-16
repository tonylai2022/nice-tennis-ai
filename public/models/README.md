# YOLO Pose Model

This app uses a YOLO pose model exported to ONNX and loaded in the browser via `onnxruntime-web`.

## Expected file

Place a pose ONNX model at:

- `public/models/yolo11n-pose.onnx`

Note: this repository previously ignored `*.onnx` via `.gitignore`. For Vercel hosting you must either:

- Commit `public/models/yolo11n-pose.onnx` to the repo (recommended for this ~13MB model), or
- Host the model elsewhere and pass a full URL into the YOLO initializer.

When deployed (e.g. Vercel), files in `public/` are served from the site root, so the model URL is:

- `/models/yolo11n-pose.onnx`

## Hosting (Vercel) notes

This project configures `onnxruntime-web` to load its WASM binaries from a CDN by default.

If you want to force CDN usage explicitly on Vercel, set:

- `VITE_ORT_WASM_BASE_URL=https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.2/dist/`

Also verify after deploy:

- `https://<your-domain>/models/yolo11n-pose.onnx` returns `200`.

The code currently assumes an Ultralytics-style COCO-17 pose head, with output shaped like:

- `(1, 4 + num_classes(=1) + 17*3, num_predictions)` → `(1, 56, N)`

## How to get a compatible model

- Export from Ultralytics YOLO pose (e.g. `yolo11n-pose.pt`) with `format=onnx`.
- Keep NMS **disabled** in export (default `nms=False`), since we do NMS in JS.

If you use a different model or output layout, update `src/services/pose/YoloPose.ts`.

## Optional: YOLO Object Model (Ball + Racket)

For more reliable contact-point detection, the app can optionally load a dedicated object detector (COCO classes for **sports ball** and **tennis racket**) via `onnxruntime-web`.

Place an object-detection ONNX model at:

- `public/models/yolo11n-coco.onnx`

When deployed, this resolves to:

- `/models/yolo11n-coco.onnx`

Or provide a URL via:

- `VITE_YOLO_OBJECTS_MODEL_URL=<https://.../your-model.onnx>`

Notes:

- If the object model is missing/unloadable, the app automatically falls back to the heuristic pixel-based ball/racket detectors.
- The current implementation assumes an Ultralytics YOLO detect head with output shaped like `(1, 4 + num_classes, num_predictions)` (typical YOLOv8/YOLO11 ONNX export with `nms=False`).

### Export (Ultralytics)

Recommended export for YOLO11n COCO detect:

```bash
pip install ultralytics

# Produces yolo11n.onnx in the current folder
yolo export model=yolo11n.pt format=onnx imgsz=640 opset=12 nms=False simplify=True
```

Then place/rename it to:

- `public/models/yolo11n-coco.onnx`

Important:

- Keep `nms=False` (this app runs NMS in the browser).
- Use `imgsz=640` (the browser preprocessor letterboxes to 640x640).
