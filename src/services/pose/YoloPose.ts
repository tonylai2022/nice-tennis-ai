import * as ort from 'onnxruntime-web';

export type NormalizedLandmark = {
    x: number;
    y: number;
    z?: number;
    visibility?: number;
};

type LetterboxInfo = {
    scale: number;
    padX: number;
    padY: number;
    srcW: number;
    srcH: number;
    dst: number;
};

type CocoKeypoint = {
    x: number; // normalized 0..1 in original frame
    y: number; // normalized 0..1 in original frame
    c: number; // confidence 0..1
};

export type YoloPoseDetection = {
    landmarks33: NormalizedLandmark[];
    avgVisibility: number;
};

const YOLO_INPUT_SIZE = 640;

// COCO-17 indices (Ultralytics default)
const COCO = {
    NOSE: 0,
    LEFT_EYE: 1,
    RIGHT_EYE: 2,
    LEFT_EAR: 3,
    RIGHT_EAR: 4,
    LEFT_SHOULDER: 5,
    RIGHT_SHOULDER: 6,
    LEFT_ELBOW: 7,
    RIGHT_ELBOW: 8,
    LEFT_WRIST: 9,
    RIGHT_WRIST: 10,
    LEFT_HIP: 11,
    RIGHT_HIP: 12,
    LEFT_KNEE: 13,
    RIGHT_KNEE: 14,
    LEFT_ANKLE: 15,
    RIGHT_ANKLE: 16,
} as const;

// MediaPipe Pose landmark indices (subset used by the app).
const MP = {
    NOSE: 0,
    LEFT_EYE_INNER: 1,
    LEFT_EYE: 2,
    LEFT_EYE_OUTER: 3,
    RIGHT_EYE_INNER: 4,
    RIGHT_EYE: 5,
    RIGHT_EYE_OUTER: 6,
    LEFT_EAR: 7,
    RIGHT_EAR: 8,
    MOUTH_LEFT: 9,
    MOUTH_RIGHT: 10,
    LEFT_SHOULDER: 11,
    RIGHT_SHOULDER: 12,
    LEFT_ELBOW: 13,
    RIGHT_ELBOW: 14,
    LEFT_WRIST: 15,
    RIGHT_WRIST: 16,
    LEFT_PINKY: 17,
    RIGHT_PINKY: 18,
    LEFT_INDEX: 19,
    RIGHT_INDEX: 20,
    LEFT_THUMB: 21,
    RIGHT_THUMB: 22,
    LEFT_HIP: 23,
    RIGHT_HIP: 24,
    LEFT_KNEE: 25,
    RIGHT_KNEE: 26,
    LEFT_ANKLE: 27,
    RIGHT_ANKLE: 28,
    LEFT_HEEL: 29,
    RIGHT_HEEL: 30,
    LEFT_FOOT_INDEX: 31,
    RIGHT_FOOT_INDEX: 32,
} as const;

function clamp01(v: number) {
    return Math.max(0, Math.min(1, v));
}

function iou(a: [number, number, number, number], b: [number, number, number, number]) {
    const x1 = Math.max(a[0], b[0]);
    const y1 = Math.max(a[1], b[1]);
    const x2 = Math.min(a[2], b[2]);
    const y2 = Math.min(a[3], b[3]);

    const w = Math.max(0, x2 - x1);
    const h = Math.max(0, y2 - y1);
    const inter = w * h;
    const areaA = Math.max(0, a[2] - a[0]) * Math.max(0, a[3] - a[1]);
    const areaB = Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
    const union = areaA + areaB - inter;
    return union > 0 ? inter / union : 0;
}

function nms(
    dets: { box: [number, number, number, number]; score: number; kpts: number[] }[],
    iouThresh: number,
    topK = 20
) {
    const sorted = [...dets].sort((a, b) => b.score - a.score);
    const kept: typeof sorted = [];

    for (const det of sorted) {
        let shouldKeep = true;
        for (const k of kept) {
            if (iou(det.box, k.box) > iouThresh) {
                shouldKeep = false;
                break;
            }
        }
        if (shouldKeep) kept.push(det);
        if (kept.length >= topK) break;
    }

    return kept;
}

function letterboxToSquare(ctx: CanvasRenderingContext2D, src: HTMLVideoElement, dst: number): LetterboxInfo {
    const srcW = src.videoWidth;
    const srcH = src.videoHeight;
    const scale = Math.min(dst / srcW, dst / srcH);
    const newW = Math.round(srcW * scale);
    const newH = Math.round(srcH * scale);
    const padX = Math.floor((dst - newW) / 2);
    const padY = Math.floor((dst - newH) / 2);

    ctx.clearRect(0, 0, dst, dst);
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, dst, dst);

    // Make scaling behavior explicit for more consistent results across browsers/devices.
    ctx.imageSmoothingEnabled = true;
    try {
        (ctx as any).imageSmoothingQuality = 'high';
    } catch {
        // ignore
    }

    ctx.drawImage(src, 0, 0, srcW, srcH, padX, padY, newW, newH);

    return { scale, padX, padY, srcW, srcH, dst };
}

function imageDataToTensor(img: ImageData): ort.Tensor {
    const { data, width, height } = img;
    // RGB, NCHW float32 0..1
    const out = new Float32Array(1 * 3 * width * height);
    const area = width * height;

    for (let i = 0; i < area; i++) {
        const r = data[i * 4 + 0] / 255;
        const g = data[i * 4 + 1] / 255;
        const b = data[i * 4 + 2] / 255;
        out[i] = r;
        out[area + i] = g;
        out[2 * area + i] = b;
    }

    return new ort.Tensor('float32', out, [1, 3, height, width]);
}

function decodeYoloV8PoseOutput(
    output: ort.Tensor,
    lb: LetterboxInfo,
    confThresh = 0.25,
    iouThresh = 0.45
): CocoKeypoint[] | null {
    const dims = output.dims;
    if (dims.length !== 3) {
        console.warn('[YOLO] Unexpected output dims:', dims);
        return null;
    }

    const [batch, channels, numPred] = dims;
    if (batch !== 1) {
        console.warn('[YOLO] Unexpected batch:', batch);
        return null;
    }

    // Expect 4 + num_classes(1) + 17*3 = 56 channels for COCO pose.
    if (channels < 56) {
        console.warn('[YOLO] Unexpected channels:', channels);
        return null;
    }

    const data = output.data as Float32Array;

    // Layout is (1, C, N). Values per prediction i are at data[c * N + i].
    const dets: { box: [number, number, number, number]; score: number; kpts: number[] }[] = [];

    const classOffset = 4;
    const kptOffset = 5; // after 4 box + 1 class

    for (let i = 0; i < numPred; i++) {
        const score = data[classOffset * numPred + i];
        if (score < confThresh) continue;

        const cx = data[0 * numPred + i];
        const cy = data[1 * numPred + i];
        const w = data[2 * numPred + i];
        const h = data[3 * numPred + i];

        const x1 = cx - w / 2;
        const y1 = cy - h / 2;
        const x2 = cx + w / 2;
        const y2 = cy + h / 2;

        const kpts: number[] = [];
        for (let k = 0; k < 17 * 3; k++) {
            kpts.push(data[(kptOffset + k) * numPred + i]);
        }

        // Prefer the pose with the best keypoint confidence, not just the objectness score.
        let kptAvg = 0;
        for (let j = 0; j < 17; j++) kptAvg += kpts[j * 3 + 2];
        kptAvg /= 17;
        const combined = score * Math.max(0, Math.min(1, kptAvg));

        dets.push({ box: [x1, y1, x2, y2], score: combined, kpts });
    }

    if (!dets.length) return null;

    const kept = nms(dets, iouThresh, 10);
    const best = kept[0];

    const coco: CocoKeypoint[] = [];
    for (let j = 0; j < 17; j++) {
        const xL = best.kpts[j * 3 + 0];
        const yL = best.kpts[j * 3 + 1];
        const c = best.kpts[j * 3 + 2];

        // Convert from letterbox coords -> original frame coords
        const xOrig = (xL - lb.padX) / lb.scale;
        const yOrig = (yL - lb.padY) / lb.scale;

        coco.push({
            x: clamp01(xOrig / lb.srcW),
            y: clamp01(yOrig / lb.srcH),
            c: clamp01(c),
        });
    }

    return coco;
}

function coco17ToMediapipe33(coco: CocoKeypoint[]): NormalizedLandmark[] {
    const out: NormalizedLandmark[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));

    const set = (mpIndex: number, kp: CocoKeypoint | undefined) => {
        if (!kp) return;
        out[mpIndex] = { x: kp.x, y: kp.y, z: 0, visibility: kp.c };
    };

    // Face-ish
    set(MP.NOSE, coco[COCO.NOSE]);
    set(MP.LEFT_EYE_INNER, coco[COCO.LEFT_EYE]);
    set(MP.LEFT_EYE, coco[COCO.LEFT_EYE]);
    set(MP.LEFT_EYE_OUTER, coco[COCO.LEFT_EYE]);
    set(MP.RIGHT_EYE_INNER, coco[COCO.RIGHT_EYE]);
    set(MP.RIGHT_EYE, coco[COCO.RIGHT_EYE]);
    set(MP.RIGHT_EYE_OUTER, coco[COCO.RIGHT_EYE]);
    set(MP.LEFT_EAR, coco[COCO.LEFT_EAR]);
    set(MP.RIGHT_EAR, coco[COCO.RIGHT_EAR]);
    set(MP.MOUTH_LEFT, coco[COCO.NOSE]);
    set(MP.MOUTH_RIGHT, coco[COCO.NOSE]);

    // Upper body
    set(MP.LEFT_SHOULDER, coco[COCO.LEFT_SHOULDER]);
    set(MP.RIGHT_SHOULDER, coco[COCO.RIGHT_SHOULDER]);
    set(MP.LEFT_ELBOW, coco[COCO.LEFT_ELBOW]);
    set(MP.RIGHT_ELBOW, coco[COCO.RIGHT_ELBOW]);
    set(MP.LEFT_WRIST, coco[COCO.LEFT_WRIST]);
    set(MP.RIGHT_WRIST, coco[COCO.RIGHT_WRIST]);

    // Hands: approximate with wrist (YOLO pose doesn't provide finger joints)
    set(MP.LEFT_PINKY, coco[COCO.LEFT_WRIST]);
    set(MP.RIGHT_PINKY, coco[COCO.RIGHT_WRIST]);
    set(MP.LEFT_INDEX, coco[COCO.LEFT_WRIST]);
    set(MP.RIGHT_INDEX, coco[COCO.RIGHT_WRIST]);
    set(MP.LEFT_THUMB, coco[COCO.LEFT_WRIST]);
    set(MP.RIGHT_THUMB, coco[COCO.RIGHT_WRIST]);

    // Lower body
    set(MP.LEFT_HIP, coco[COCO.LEFT_HIP]);
    set(MP.RIGHT_HIP, coco[COCO.RIGHT_HIP]);
    set(MP.LEFT_KNEE, coco[COCO.LEFT_KNEE]);
    set(MP.RIGHT_KNEE, coco[COCO.RIGHT_KNEE]);
    set(MP.LEFT_ANKLE, coco[COCO.LEFT_ANKLE]);
    set(MP.RIGHT_ANKLE, coco[COCO.RIGHT_ANKLE]);

    // Feet: approximate from ankle
    set(MP.LEFT_HEEL, coco[COCO.LEFT_ANKLE]);
    set(MP.RIGHT_HEEL, coco[COCO.RIGHT_ANKLE]);
    set(MP.LEFT_FOOT_INDEX, coco[COCO.LEFT_ANKLE]);
    set(MP.RIGHT_FOOT_INDEX, coco[COCO.RIGHT_ANKLE]);

    return out;
}

export class YoloPoseService {
    private static session: ort.InferenceSession | null = null;
    private static modelUrl: string | null = null;

    // IMPORTANT: This MUST match the installed `onnxruntime-web` version.
    // If the JS glue code and the fetched WASM binaries are from different versions,
    // initialization can fail with opaque errors (e.g. "t.getValue is not a function").
    private static readonly DEFAULT_WASM_BASE_URL = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.2/dist/';

    private static inputCanvas: HTMLCanvasElement | null = null;
    private static inputCtx: CanvasRenderingContext2D | null = null;

    static async initialize(options?: { modelUrl?: string; wasmBaseUrl?: string }) {
        if (this.session) return;

        // iOS Safari/WebKit can throw on `WebAssembly.instantiateStreaming(Promise<Response>, ...)`
        // with: "first argument must be a Response or Promise for Response".
        // ONNX Runtime will fall back to ArrayBuffer instantiation anyway, so skip streaming on iOS.
        const ua = navigator.userAgent;
        const isIOS = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && (navigator as any).maxTouchPoints > 1);
        const isMobile = /iPhone|iPad|iPod|Android/i.test(ua);
        if (isIOS && typeof (WebAssembly as any).instantiateStreaming === 'function') {
            try {
                delete (WebAssembly as any).instantiateStreaming;
            } catch {
                // ignore
            }
        }

        if (isMobile) {
            // Some mobile CPUs fail SIMD feature detection in ORT with "unknown cpu vendor".
            // Disable SIMD/proxy to favor compatibility.
            try {
                (ort.env as any).wasm.simd = false;
                (ort.env as any).wasm.proxy = false;
            } catch {
                // ignore
            }
        }

        this.modelUrl = options?.modelUrl ?? '/models/yolo11n-pose.onnx';

        // In many bundlers/dev-servers, onnxruntime-web's .wasm files are not served from the expected path.
        // When that happens, the fetch returns index.html ("<!do"), and WASM instantiation fails.
        // Point to a known-good base URL by default.
        const wasmBaseFromEnv = (import.meta as any)?.env?.VITE_ORT_WASM_BASE_URL as string | undefined;
        const wasmBase = options?.wasmBaseUrl ?? wasmBaseFromEnv ?? this.DEFAULT_WASM_BASE_URL;
        console.log(`[YOLO] Configuring WASM base: ${wasmBase}`);
        ort.env.wasm.wasmPaths = wasmBase;

        // Force single-threaded WASM to avoid COOP/COEP requirements for SharedArrayBuffer.
        // This keeps the app working in typical Vite dev/prod hosting setups.
        ort.env.wasm.numThreads = 1;

        try {
            console.log(`[YOLO] Attempting to load model from: ${this.modelUrl}`);

            // Test if model is accessible
            const testFetch = await fetch(this.modelUrl);
            if (!testFetch.ok) {
                throw new Error(`Model fetch failed: ${testFetch.status} ${testFetch.statusText}`);
            }
            const contentType = testFetch.headers.get('content-type');
            console.log(`[YOLO] Model fetch OK (${testFetch.status}), content-type: ${contentType}`);

            console.log('[YOLO] Creating ONNX Runtime session...');
            this.session = await ort.InferenceSession.create(this.modelUrl, {
                executionProviders: ['wasm'],
                graphOptimizationLevel: 'all',
            });
            console.log('[YOLO] Session created successfully');

            this.inputCanvas = document.createElement('canvas');
            this.inputCanvas.width = YOLO_INPUT_SIZE;
            this.inputCanvas.height = YOLO_INPUT_SIZE;
            this.inputCtx = this.inputCanvas.getContext('2d', { willReadFrequently: true });

            if (!this.inputCtx) {
                throw new Error('Failed to create 2D canvas context for YOLO pre-processing');
            }

            console.log('[YOLO] Pose model initialized:', this.modelUrl);
        } catch (e) {
            this.session = null;
            const errorMsg = e instanceof Error ? e.message : String(e);
            console.error('[YOLO] Initialization failed:', errorMsg, e);
            throw new Error(
                `[YOLO] Failed to initialize pose model at ${this.modelUrl}. ${errorMsg}`
            );
        }
    }

    static async detectFromVideo(video: HTMLVideoElement): Promise<YoloPoseDetection | null> {
        if (!this.session || !this.inputCtx) {
            throw new Error('[YOLO] detectFromVideo called before initialize()');
        }

        if (!video.videoWidth || !video.videoHeight) return null;

        const lb = letterboxToSquare(this.inputCtx, video, YOLO_INPUT_SIZE);
        const img = this.inputCtx.getImageData(0, 0, YOLO_INPUT_SIZE, YOLO_INPUT_SIZE);
        const inputTensor = imageDataToTensor(img);

        const inputName = this.session.inputNames[0];
        const outputName = this.session.outputNames[0];

        const outputs = await this.session.run({ [inputName]: inputTensor });
        const outTensor = outputs[outputName] as ort.Tensor;

        const coco = decodeYoloV8PoseOutput(outTensor, lb);
        if (!coco) return null;

        const landmarks33 = coco17ToMediapipe33(coco);
        const avgVisibility = coco.reduce((sum, k) => sum + k.c, 0) / coco.length;

        return { landmarks33, avgVisibility };
    }
}
