import React, { useRef, useState } from 'react';
import { RotateCcw, Sparkles } from 'lucide-react';
import { mediaPipeVideoPoseService, type PoseLandmark } from '../services/pose/MediaPipeVideoPoseService';

type PhaseKey = 'preparation' | 'contact' | 'finish';

interface PhaseResult {
    key: PhaseKey;
    title: string;
    timestamp: number;
    imageUrl: string;
    score: number;
    issue: string;
    correction: string;
}

export interface AIFeedbackPublishPayload {
    title: string;
    body: string;
    priorityCue: string;
    frames: Pick<PhaseResult, 'key' | 'title' | 'imageUrl'>[];
}

interface FrameCallout {
    landmarkIndex: number;
    tone: 'error' | 'correction';
    text: string;
}

interface PhaseAssessment {
    score: number;
    needsCorrection: boolean;
    issue: string;
    correction: string;
    callouts: FrameCallout[];
}

const PHASES: { key: PhaseKey; title: string; progress: number }[] = [
    { key: 'preparation', title: '准备', progress: 0.2 },
    { key: 'contact', title: '触球', progress: 0.52 },
    { key: 'finish', title: '收拍', progress: 0.84 },
];

export function StudentVideoAIFeedback({ videoUrl, fileName, placement = 'standalone', onPublish, onShareChange }: { videoUrl: string; fileName: string; placement?: 'standalone' | 'workbench'; onPublish?: (payload: AIFeedbackPublishPayload) => Promise<void>; onShareChange?: (payload: AIFeedbackPublishPayload | null) => void }) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [status, setStatus] = useState<'idle' | 'analyzing' | 'complete' | 'error'>('idle');
    const [progress, setProgress] = useState('');
    const [results, setResults] = useState<PhaseResult[]>([]);
    const [error, setError] = useState('');
    const [shareWithStudent, setShareWithStudent] = useState(false);
    const [publishing, setPublishing] = useState(false);
    const [published, setPublished] = useState(false);

    const analyze = async () => {
        const video = videoRef.current;
        if (!video || status === 'analyzing') return;
        setStatus('analyzing');
        setError('');
        setResults([]);
        setShareWithStudent(false);
        setPublished(false);
        onShareChange?.(null);
        try {
            setProgress('正在加载动作识别模型...');
            const landmarker = await mediaPipeVideoPoseService.init();
            if (!landmarker) throw new Error('动作识别模型暂时无法加载，请检查网络后重试。');
            await ensureVideoMetadata(video);

            const nextResults: PhaseResult[] = [];
            for (let index = 0; index < PHASES.length; index += 1) {
                const phase = PHASES[index];
                setProgress(`正在提取${phase.title}（${index + 1}/${PHASES.length}）...`);
                const timestamp = Math.min(Math.max(0, video.duration * phase.progress), Math.max(0, video.duration - 0.05));
                await seekVideo(video, timestamp);
                const landmarks = await mediaPipeVideoPoseService.detectImage(video);
                if (!landmarks || landmarks.length < 33) continue;
                const assessment = assessPhase(phase.key, landmarks);
                nextResults.push({
                    key: phase.key,
                    title: phase.title,
                    timestamp,
                    imageUrl: renderAnnotatedFrame(video, landmarks, assessment, phase.key),
                    score: assessment.score,
                    issue: assessment.issue,
                    correction: assessment.correction,
                });
            }

            if (!nextResults.length) throw new Error('视频中未识别到清晰的全身动作。请使用人物完整可见、光线充足的视频。');
            setResults(nextResults);
            setStatus('complete');
            setProgress('');
        } catch (analysisError) {
            setError(analysisError instanceof Error ? analysisError.message : '分析失败，请稍后重试。');
            setStatus('error');
            setProgress('');
        }
    };

    const priority = results.length ? [...results].sort((left, right) => left.score - right.score)[0] : null;
    const priorityCue = priority?.key === 'preparation'
        ? '转身时稍微屈膝，让重心先稳定下来。'
        : priority?.key === 'contact'
            ? '先找到身体前方的击球点，再向前送拍。'
            : '自然完成随挥，用小步快速回位。';

    const buildPublishPayload = (): AIFeedbackPublishPayload => ({
        title: `AI 动作反馈 · ${fileName}`,
        priorityCue,
        body: [`优先练习：${priorityCue}`, ...results.map((result, index) => `${index + 1}. ${result.title}：${result.correction} ${result.issue}`)].join('\n\n'),
        frames: results.map(({ key, title, imageUrl }) => ({ key, title, imageUrl })),
    });

    const changeSharing = (checked: boolean) => {
        setShareWithStudent(checked);
        onShareChange?.(checked ? buildPublishPayload() : null);
    };

    const publishResult = async () => {
        if (!onPublish || !shareWithStudent || publishing || !results.length) return;
        setPublishing(true);
        setError('');
        try {
            await onPublish(buildPublishPayload());
            setPublished(true);
            setShareWithStudent(false);
        } catch (publishError) {
            setError(publishError instanceof Error ? publishError.message : '发布失败，请稍后重试。');
        } finally {
            setPublishing(false);
        }
    };

    return <section className={`crm-ai-feedback ${placement === 'workbench' ? 'is-workbench' : ''}`}>
        <video ref={videoRef} src={videoUrl} crossOrigin="anonymous" preload="metadata" muted className="crm-ai-feedback-source" />
        {status !== 'complete' && <button type="button" className="crm-button crm-ai-feedback-button" disabled={status === 'analyzing'} onClick={() => void analyze()}>
            <Sparkles aria-hidden="true" /> {status === 'analyzing' ? 'AI 分析中...' : 'AI Feedback'}
        </button>}
        {progress && <div className="crm-ai-feedback-progress" role="status"><span /><p>{progress}</p></div>}
        {error && <div className="crm-ai-feedback-error" role="alert"><p>{error}</p><button type="button" className="crm-text-button" onClick={() => void analyze()}><RotateCcw aria-hidden="true" />重新分析</button></div>}
        {status === 'complete' && <div className="crm-ai-feedback-report">
            <header><p className="crm-eyebrow">动作复盘 · 关键帧标注</p><h3>三个阶段，先改一个重点。</h3><p>优先练习：{priorityCue}</p><div className="crm-ai-feedback-legend"><span><i className="is-red" />当前姿态</span><span><i className="is-green" />重点位置</span><span><i className="is-amber" />练习方向</span></div></header>
            <div className="crm-ai-feedback-frames">{results.map((result, index) => <article key={result.key}>
                <div className="crm-ai-feedback-phase-heading"><span>{index + 1}</span><h5>{result.title}</h5><time>{formatTime(result.timestamp)}</time></div>
                <div className="crm-ai-feedback-image"><img src={result.imageUrl} alt={`${result.title}动作标注`} /></div>
                <div className="crm-ai-feedback-coaching"><small>{result.score < 80 ? '优先调整' : '继续保持'}</small><h6>{result.correction}</h6><p>{result.issue}</p></div>
            </article>)}</div>
            <div className="crm-ai-feedback-next"><span>下次先练这一项</span><strong>{priorityCue}</strong></div>
            {(onPublish || onShareChange) && <div className="crm-ai-feedback-publish">
                {published ? <p role="status">已发布给学生。学生将在训练日志中看到这 3 张反馈图片。</p> : <><label><input type="checkbox" checked={shareWithStudent} onChange={(event) => changeSharing(event.target.checked)} /><span><strong>{onShareChange ? 'Include AI result in feedback' : 'Show this result to student'}</strong><small>{onShareChange ? 'The main Publish feedback button will include all 3 frames and coaching tips.' : 'Publish all 3 annotated frames and coaching tips to the student log.'}</small></span></label>{onPublish && <button type="button" className="crm-button crm-button-primary" disabled={!shareWithStudent || publishing} onClick={() => void publishResult()}>{publishing ? 'Publishing...' : 'Publish AI feedback'}</button>}</>}
            </div>}
            <footer><span>使用原视频关键帧，仅做动作姿态辅助分析；球路与击球效果请由教练确认。</span><small>{fileName}</small><button type="button" className="crm-text-button" onClick={() => void analyze()}><RotateCcw aria-hidden="true" />重新分析</button></footer>
        </div>}
    </section>;
}

function assessPhase(phase: PhaseKey, landmarks: PoseLandmark[]): PhaseAssessment {
    const leftKnee = jointAngle(landmarks[23], landmarks[25], landmarks[27]);
    const rightKnee = jointAngle(landmarks[24], landmarks[26], landmarks[28]);
    const kneeAngle = average([leftKnee, rightKnee]);
    const leftElbow = jointAngle(landmarks[11], landmarks[13], landmarks[15]);
    const rightElbow = jointAngle(landmarks[12], landmarks[14], landmarks[16]);
    const extension = Math.max(leftElbow ?? 0, rightElbow ?? 0);
    const shoulderTilt = lineTilt(landmarks[11], landmarks[12]);
    const hipTilt = lineTilt(landmarks[23], landmarks[24]);
    const alignmentGap = Math.abs((shoulderTilt ?? 0) - (hipTilt ?? 0));

    if (phase === 'preparation') {
        const needsCorrection = kneeAngle === null || kneeAngle > 164;
        return needsCorrection
            ? { score: 68, needsCorrection, issue: '上身保持直立，不要急着挥拍。', correction: '膝盖稍屈，重心稍降。', callouts: [{ landmarkIndex: 25, tone: 'error', text: '膝盖偏直' }, { landmarkIndex: 23, tone: 'correction', text: '重心稍降' }, { landmarkIndex: 11, tone: 'correction', text: '先转肩' }] }
            : { score: 86, needsCorrection, issue: '转肩和下肢支撑已经到位。', correction: '保持屈膝，放松启动。', callouts: [{ landmarkIndex: 25, tone: 'correction', text: '屈膝到位' }, { landmarkIndex: 23, tone: 'correction', text: '重心稳定' }, { landmarkIndex: 11, tone: 'correction', text: '先转肩' }] };
    }
    if (phase === 'contact') {
        const needsCorrection = extension < 150 || alignmentGap > 18;
        const hittingWrist = distance(landmarks[11], landmarks[15]) >= distance(landmarks[12], landmarks[16]) ? 15 : 16;
        return needsCorrection
            ? { score: 64, needsCorrection, issue: '手臂离身体太近，容易挤压击球。', correction: '先找前点击球，再自然收拍。', callouts: [{ landmarkIndex: hittingWrist, tone: 'error', text: '击球点偏近' }, { landmarkIndex: hittingWrist, tone: 'correction', text: '向前伸展' }, { landmarkIndex: 23, tone: 'correction', text: '躯干稳定' }] }
            : { score: 88, needsCorrection, issue: '手臂伸展和身体轴线都很稳定。', correction: '保持前点击球，继续向前送拍。', callouts: [{ landmarkIndex: hittingWrist, tone: 'correction', text: '前点击球' }, { landmarkIndex: 13, tone: 'correction', text: '充分伸展' }, { landmarkIndex: 23, tone: 'correction', text: '躯干稳定' }] };
    }
    const needsCorrection = alignmentGap > 20 || kneeAngle === null || kneeAngle > 170;
    return needsCorrection
        ? { score: 70, needsCorrection, issue: '结束时身体偏直，回位会慢半拍。', correction: '自然随挥，屈膝回位。', callouts: [{ landmarkIndex: 12, tone: 'error', text: '随挥偏短' }, { landmarkIndex: 26, tone: 'error', text: '缓冲不足' }, { landmarkIndex: 24, tone: 'correction', text: '稳定回位' }] }
        : { score: 87, needsCorrection, issue: '随挥和落地支撑都很稳定。', correction: '保持自然随挥，后脚跟进。', callouts: [{ landmarkIndex: 12, tone: 'correction', text: '完整收拍' }, { landmarkIndex: 26, tone: 'correction', text: '落地稳定' }, { landmarkIndex: 24, tone: 'correction', text: '快速回位' }] };
}

function renderAnnotatedFrame(video: HTMLVideoElement, landmarks: PoseLandmark[], assessment: PhaseAssessment, phase: PhaseKey) {
    const maxWidth = 960;
    const scale = Math.min(1, maxWidth / video.videoWidth);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法生成动作标注图片。');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    drawSimplePhaseGuide(context, landmarks, canvas.width, canvas.height, phase);
    drawCallouts(context, landmarks, assessment.callouts.slice(0, 2), canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.88);
}

function drawSimplePhaseGuide(context: CanvasRenderingContext2D, landmarks: PoseLandmark[], width: number, height: number, phase: PhaseKey) {
    const lineWidth = Math.max(2, width * 0.0045);
    if (phase === 'preparation') {
        const kneeIndex = (landmarks[25].visibility ?? 0) >= (landmarks[26].visibility ?? 0) ? 25 : 26;
        drawFocusRing(context, landmarks[kneeIndex], width, height, '#d5a34d', width * 0.045);
        const hip = midpoint(landmarks[23], landmarks[24]);
        drawLeaderArrow(context, hip.x * width, hip.y * height, hip.x * width, Math.min(height * 0.94, hip.y * height + height * 0.12), '#d5a34d', lineWidth);
        return;
    }

    if (phase === 'contact') {
        const leftReach = distance(landmarks[11], landmarks[15]);
        const rightReach = distance(landmarks[12], landmarks[16]);
        const [shoulderIndex, wristIndex] = leftReach >= rightReach ? [11, 15] : [12, 16];
        const shoulder = landmarks[shoulderIndex];
        const wrist = landmarks[wristIndex];
        drawFocusRing(context, wrist, width, height, '#42dc87', width * 0.042);
        const vectorX = wrist.x - shoulder.x;
        const vectorY = wrist.y - shoulder.y;
        drawDashedArrow(context, shoulder.x * width, shoulder.y * height, Math.max(8, Math.min(width - 8, (wrist.x + vectorX * 0.45) * width)), Math.max(8, Math.min(height - 8, (wrist.y + vectorY * 0.45) * height)), '#d5a34d', lineWidth);
        return;
    }

    const rearAnkleIndex = landmarks[27].y <= landmarks[28].y ? 27 : 28;
    const frontAnkleIndex = rearAnkleIndex === 27 ? 28 : 27;
    drawFocusRing(context, landmarks[frontAnkleIndex], width, height, '#42dc87', width * 0.05);
    drawDashedArrow(context, landmarks[rearAnkleIndex].x * width, landmarks[rearAnkleIndex].y * height, landmarks[frontAnkleIndex].x * width, landmarks[frontAnkleIndex].y * height, '#d5a34d', lineWidth);
}

function drawFocusRing(context: CanvasRenderingContext2D, point: PoseLandmark, width: number, height: number, color: string, radius: number) {
    if (!point || (point.visibility ?? 1) < 0.25) return;
    context.save();
    context.strokeStyle = color;
    context.lineWidth = Math.max(3, width * 0.006);
    context.shadowColor = 'rgba(0, 0, 0, 0.45)';
    context.shadowBlur = 4;
    context.beginPath();
    context.arc(point.x * width, point.y * height, radius, 0, Math.PI * 2);
    context.stroke();
    context.restore();
}

function drawDashedArrow(context: CanvasRenderingContext2D, startX: number, startY: number, endX: number, endY: number, color: string, lineWidth: number) {
    context.save();
    context.setLineDash([lineWidth * 3, lineWidth * 2.4]);
    drawLeaderArrow(context, startX, startY, endX, endY, color, lineWidth);
    context.restore();
}

function midpoint(first: PoseLandmark, second: PoseLandmark): PoseLandmark {
    return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2, visibility: Math.min(first.visibility ?? 1, second.visibility ?? 1) };
}

function drawCallouts(context: CanvasRenderingContext2D, landmarks: PoseLandmark[], callouts: FrameCallout[], width: number, height: number) {
    const visible = landmarks.slice(11, 33).filter((point) => (point.visibility ?? 1) >= 0.35);
    const bodyCenter = visible.length ? visible.reduce((total, point) => total + point.x, 0) / visible.length : 0.5;
    const fontSize = Math.max(11, Math.round(width * 0.018));
    const padding = Math.max(6, Math.round(width * 0.009));
    const boxWidth = Math.min(width * 0.43, fontSize * 14);
    context.save();
    context.font = `700 ${fontSize}px sans-serif`;
    callouts.forEach((callout, index) => {
        const target = landmarks[callout.landmarkIndex];
        if (!target || (target.visibility ?? 1) < 0.25) return;
        const lines = wrapCanvasText(context, `${callout.tone === 'error' ? '问题' : '改进'}：${callout.text}`, boxWidth - padding * 2);
        const boxHeight = lines.length * fontSize * 1.28 + padding * 2;
        const useRight = bodyCenter < 0.42 || (bodyCenter <= 0.58 && index % 2 === 1);
        const boxX = useRight ? width - boxWidth - 10 : 10;
        const slotY = height * (0.1 + index * 0.28);
        const boxY = Math.max(8, Math.min(height - boxHeight - 8, slotY));
        const color = callout.tone === 'error' ? '#c48324' : '#16834c';
        const lineStartX = useRight ? boxX : boxX + boxWidth;
        const lineStartY = boxY + boxHeight / 2;
        drawLeaderArrow(context, lineStartX, lineStartY, target.x * width, target.y * height, color, Math.max(2, width * 0.004));
        context.fillStyle = color;
        context.globalAlpha = 0.94;
        context.fillRect(boxX, boxY, boxWidth, boxHeight);
        context.globalAlpha = 1;
        context.fillStyle = '#ffffff';
        lines.forEach((line, lineIndex) => context.fillText(line, boxX + padding, boxY + padding + fontSize * (lineIndex + 0.9)));
    });
    context.restore();
}

function drawLeaderArrow(context: CanvasRenderingContext2D, startX: number, startY: number, endX: number, endY: number, color: string, lineWidth: number) {
    const angle = Math.atan2(endY - startY, endX - startX);
    const headSize = Math.max(7, lineWidth * 2.6);
    context.save();
    context.strokeStyle = color;
    context.fillStyle = color;
    context.lineWidth = lineWidth;
    context.beginPath();
    context.moveTo(startX, startY);
    context.lineTo(endX, endY);
    context.stroke();
    context.beginPath();
    context.moveTo(endX, endY);
    context.lineTo(endX - headSize * Math.cos(angle - Math.PI / 6), endY - headSize * Math.sin(angle - Math.PI / 6));
    context.lineTo(endX - headSize * Math.cos(angle + Math.PI / 6), endY - headSize * Math.sin(angle + Math.PI / 6));
    context.closePath();
    context.fill();
    context.restore();
}

function wrapCanvasText(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
    const lines: string[] = [];
    let line = '';
    for (const character of text) {
        if (line && context.measureText(line + character).width > maxWidth) {
            lines.push(line);
            line = character;
        } else {
            line += character;
        }
    }
    if (line) lines.push(line);
    return lines;
}

function distance(first: PoseLandmark, second: PoseLandmark) {
    return Math.hypot(first.x - second.x, first.y - second.y);
}

function ensureVideoMetadata(video: HTMLVideoElement) {
    if (video.readyState >= 1 && Number.isFinite(video.duration)) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
        video.addEventListener('loadedmetadata', () => resolve(), { once: true });
        video.addEventListener('error', () => reject(new Error('无法加载这段视频，请刷新链接后重试。')), { once: true });
        video.load();
    });
}

function seekVideo(video: HTMLVideoElement, timestamp: number) {
    if (Math.abs(video.currentTime - timestamp) < 0.02) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
        video.addEventListener('seeked', () => resolve(), { once: true });
        video.addEventListener('error', () => reject(new Error('视频画面提取失败。')), { once: true });
        video.currentTime = timestamp;
    });
}

function jointAngle(first?: PoseLandmark, vertex?: PoseLandmark, second?: PoseLandmark) {
    if (!first || !vertex || !second) return null;
    const firstVector = { x: first.x - vertex.x, y: first.y - vertex.y };
    const secondVector = { x: second.x - vertex.x, y: second.y - vertex.y };
    const magnitude = Math.hypot(firstVector.x, firstVector.y) * Math.hypot(secondVector.x, secondVector.y);
    if (!magnitude) return null;
    return Math.acos(Math.max(-1, Math.min(1, (firstVector.x * secondVector.x + firstVector.y * secondVector.y) / magnitude))) * 180 / Math.PI;
}

function lineTilt(first?: PoseLandmark, second?: PoseLandmark) {
    if (!first || !second) return null;
    return Math.abs(Math.atan2(second.y - first.y, second.x - first.x) * 180 / Math.PI);
}

function average(values: (number | null)[]) {
    const valid = values.filter((value): value is number => value !== null && Number.isFinite(value));
    return valid.length ? valid.reduce((total, value) => total + value, 0) / valid.length : null;
}

function formatTime(seconds: number) {
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
}