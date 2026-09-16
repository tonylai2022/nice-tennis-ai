import * as ort from 'onnxruntime-web';

export type NormalizedBox = {
    x0: number; // 0..1
    y0: number; // 0..1
    x1: number; // 0..1
    y1: number; // 0..1
};

export type DetectedBall = {
    x: number; // 0..1 center
    y: number; // 0..1 center
    confidence: number; // 0..1
    radius?: number; // approx, 0..1
    box: NormalizedBox;
};

export type DetectedRacket = {
    confidence: number; // 0..1
    box: NormalizedBox;
};

export type YoloObjectDetections = {
    ball?: DetectedBall;
    racket?: DetectedRacket;
};

type LetterboxInfo = {
    scale: number;
    padX: number;
    padY: number;
    srcW: number;
    srcH: number;
    dst: number;
};

const YOLO_INPUT_SIZE = 640;

// COCO80 class ids in Ultralytics models (0-indexed)
const COCO = {
    SPORTS_BALL: 32,
    TENNIS_RACKET: 38,
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
    dets: { box: [number, number, number, number]; score: number; cls: number }[],
    iouThresh: number,
    topK = 40
) {
    const sorted = [...dets].sort((a, b) => b.score - a.score);
    const kept: typeof sorted = [];

    for (const det of sorted) {
        let keep = true;
        for (const k of kept) {
            if (iou(det.box, k.box) > iouThresh) {
                keep = false;
                break;
            }
        }
        if (keep) kept.push(det);
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

function decodeYoloDetectOutput(
    output: ort.Tensor,
    lb: LetterboxInfo,
    confThresh = 0.25,
    iouThresh = 0.45
): { ball?: DetectedBall; racket?: DetectedRacket } {
    const dims = output.dims;
    if (dims.length !== 3) {
        console.warn('[YOLO-OBJ] Unexpected output dims:', dims);
        return {};
    }

    const [batch, channels, numPred] = dims;
    if (batch !== 1 || channels < 4 + 2) {
        console.warn('[YOLO-OBJ] Unexpected output shape:', dims);
        return {};
    }

    const data = output.data as Float32Array;
    const numClasses = channels - 4;

    const dets: { box: [number, number, number, number]; score: number; cls: number }[] = [];

    for (let i = 0; i < numPred; i++) {
        let bestC = -1;
        let bestS = 0;

        for (let c = 0; c < numClasses; c++) {
            const s = data[(4 + c) * numPred + i];
            if (s > bestS) {
                bestS = s;
                bestC = c;
            }
        }

        if (bestS < confThresh) continue;
        if (bestC !== COCO.SPORTS_BALL && bestC !== COCO.TENNIS_RACKET) continue;

        const cx = data[0 * numPred + i];
        const cy = data[1 * numPred + i];
        const w = data[2 * numPred + i];
        const h = data[3 * numPred + i];

        const x1 = cx - w / 2;
        const y1 = cy - h / 2;
        const x2 = cx + w / 2;
        const y2 = cy + h / 2;

        dets.push({ box: [x1, y1, x2, y2], score: bestS, cls: bestC });
    }

    if (!dets.length) return {};

    const kept = nms(dets, iouThresh, 30);

    const toNormBox = (box: [number, number, number, number]): NormalizedBox => {
        const [x1, y1, x2, y2] = box;
        // Convert from letterbox coords -> original frame coords
        const x1o = (x1 - lb.padX) / lb.scale;
        const y1o = (y1 - lb.padY) / lb.scale;
        const x2o = (x2 - lb.padX) / lb.scale;
        const y2o = (y2 - lb.padY) / lb.scale;

        const nx0 = clamp01(x1o / lb.srcW);
        const ny0 = clamp01(y1o / lb.srcH);
        const nx1 = clamp01(x2o / lb.srcW);
        const ny1 = clamp01(y2o / lb.srcH);

        return { x0: nx0, y0: ny0, x1: nx1, y1: ny1 };
    };

    const bestBall = kept.filter((d) => d.cls === COCO.SPORTS_BALL).sort((a, b) => b.score - a.score)[0];
    const bestRacket = kept.filter((d) => d.cls === COCO.TENNIS_RACKET).sort((a, b) => b.score - a.score)[0];

    const out: { ball?: DetectedBall; racket?: DetectedRacket } = {};

    if (bestBall) {
        const b = toNormBox(bestBall.box);
        const cx = (b.x0 + b.x1) / 2;
        const cy = (b.y0 + b.y1) / 2;
        const radius = 0.25 * ((b.x1 - b.x0) + (b.y1 - b.y0));
        out.ball = {
            x: cx,
            y: cy,
            confidence: clamp01(bestBall.score),
            radius: clamp01(radius),
            box: b,
        };
    }

    if (bestRacket) {
        const b = toNormBox(bestRacket.box);
        out.racket = {
            confidence: clamp01(bestRacket.score),
            box: b,
        };
    }

    return out;
}

export class YoloObjectsService {
    private static session: ort.InferenceSession | null = null;
    private static modelUrl: string | null = null;

    // Keep ORT wasm binaries aligned with installed version.
    private static readonly DEFAULT_WASM_BASE_URL = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.2/dist/';

    private static inputCanvas: HTMLCanvasElement | null = null;
    private static inputCtx: CanvasRenderingContext2D | null = null;

    static async initialize(options?: { modelUrl?: string; wasmBaseUrl?: string }) {
        if (this.session) return;

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
            // Avoid ORT SIMD feature detection issues on some mobile CPUs.
            try {
                (ort.env as any).wasm.simd = false;
                (ort.env as any).wasm.proxy = false;
            } catch {
                // ignore
            }
        }

        const modelUrlFromEnv = (import.meta as any)?.env?.VITE_YOLO_OBJECTS_MODEL_URL as string | undefined;
        this.modelUrl = options?.modelUrl ?? modelUrlFromEnv ?? '/models/yolo11n-coco.onnx';

        const wasmBaseFromEnv = (import.meta as any)?.env?.VITE_ORT_WASM_BASE_URL as string | undefined;
        const wasmBase = options?.wasmBaseUrl ?? wasmBaseFromEnv ?? this.DEFAULT_WASM_BASE_URL;
        ort.env.wasm.wasmPaths = wasmBase;
        ort.env.wasm.numThreads = 1;

        console.log(`[YOLO-OBJ] Initializing object model: ${this.modelUrl}`);

        // If the model isn't present, callers should catch and fall back.
        this.session = await ort.InferenceSession.create(this.modelUrl, {
            executionProviders: ['wasm'],
            graphOptimizationLevel: 'all',
        });

        this.inputCanvas = document.createElement('canvas');
        this.inputCanvas.width = YOLO_INPUT_SIZE;
        this.inputCanvas.height = YOLO_INPUT_SIZE;
        this.inputCtx = this.inputCanvas.getContext('2d', { willReadFrequently: true });

        if (!this.inputCtx) {
            this.session = null;
            throw new Error('[YOLO-OBJ] Failed to create 2D canvas context');
        }

        console.log('[YOLO-OBJ] Object model initialized');
    }

    static isReady() {
        return !!this.session && !!this.inputCtx;
    }

    static async detectFromVideo(video: HTMLVideoElement): Promise<YoloObjectDetections> {
        if (!this.session || !this.inputCtx) {
            throw new Error('[YOLO-OBJ] detectFromVideo called before initialize()');
        }
        if (!video.videoWidth || !video.videoHeight) return {};

        const lb = letterboxToSquare(this.inputCtx, video, YOLO_INPUT_SIZE);
        const img = this.inputCtx.getImageData(0, 0, YOLO_INPUT_SIZE, YOLO_INPUT_SIZE);
        const inputTensor = imageDataToTensor(img);

        const inputName = this.session.inputNames[0];
        const outputName = this.session.outputNames[0];

        const outputs = await this.session.run({ [inputName]: inputTensor });
        const outTensor = outputs[outputName] as ort.Tensor;

        return decodeYoloDetectOutput(outTensor, lb, 0.25, 0.45);
    }
}
