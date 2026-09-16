import type { PoseResult } from '../MotionAnalysisRouter';

export interface FreeTip {
    title: string;
    detail: string;
    detailZhSimp?: string;
    detailZhTrad?: string;
    short?: string;         // ≤6 words, for canvas bullet
    shortZhSimp?: string;
    shortZhTrad?: string;
    score: number; // 0–100
    rawValue?: number;  // actual measured value (e.g. joint angle)
    rawUnit?: string;   // unit string (e.g. '°', '% torso')
}

export interface FreeFeedback {
    encouragement: string;
    overallScore: number; // 0–100
    tips: FreeTip[];
}

// MediaPipe landmark indices
const LM = {
    LEFT_SHOULDER: 11,
    RIGHT_SHOULDER: 12,
    LEFT_ELBOW: 13,
    RIGHT_ELBOW: 14,
    LEFT_WRIST: 15,
    RIGHT_WRIST: 16,
    LEFT_HIP: 23,
    RIGHT_HIP: 24,
    LEFT_KNEE: 25,
    RIGHT_KNEE: 26,
    LEFT_ANKLE: 27,
    RIGHT_ANKLE: 28,
};

type Lm = { x: number; y: number; visibility?: number };

function getLm(frame: PoseResult, idx: number): Lm | null {
    const lm = frame.landmarks?.[idx];
    if (!lm || (lm.visibility !== undefined && lm.visibility < 0.3)) return null;
    return lm as Lm;
}

function angle(a: Lm, b: Lm, c: Lm): number {
    const ab = { x: a.x - b.x, y: a.y - b.y };
    const cb = { x: c.x - b.x, y: c.y - b.y };
    const dot = ab.x * cb.x + ab.y * cb.y;
    const mag = Math.sqrt(ab.x ** 2 + ab.y ** 2) * Math.sqrt(cb.x ** 2 + cb.y ** 2);
    if (mag === 0) return 0;
    return (Math.acos(Math.max(-1, Math.min(1, dot / mag))) * 180) / Math.PI;
}

/** Pick the frame at a normalized position (0..1) along the sequence */
function atNorm(frames: PoseResult[], t: number): PoseResult | null {
    if (!frames.length) return null;
    const idx = Math.min(frames.length - 1, Math.round(t * (frames.length - 1)));
    return frames[idx];
}

/** Score a deviation: 0 deviation → 100, maxDev or more → 0 */
function deviationScore(deviation: number, maxDev: number): number {
    return Math.max(0, Math.round(100 * (1 - Math.min(1, deviation / maxDev))));
}

/** Score user vs pro relative to the pro's own reference value.
 *  Formula: score = 100 × (1 − |user − pro| / |pro|)
 *  e.g. pro = 160°, user = 100° → deviation 60/160 = 0.375 → score 63. */
function proScore(userVal: number, proVal: number): number {
    if (Math.abs(proVal) < 1e-6) return 50; // guard: avoid division by near-zero
    return Math.max(0, Math.round(100 * (1 - Math.abs(userVal - proVal) / Math.abs(proVal))));
}

// ─── Six standard tennis metrics ─────────────────────────────────────────────

/** PREP — shoulder unit-turn angle at preparation phase */
function checkPrep(userFrames: PoseResult[], refFrames: PoseResult[]): FreeTip | null {
    const u = atNorm(userFrames, 0.25);
    const r = atNorm(refFrames, 0.25);
    if (!u || !r) return null;
    const uLS = getLm(u, LM.LEFT_SHOULDER), uRS = getLm(u, LM.RIGHT_SHOULDER);
    const rLS = getLm(r, LM.LEFT_SHOULDER), rRS = getLm(r, LM.RIGHT_SHOULDER);
    if (!uLS || !uRS || !rLS || !rRS) return null;

    const userTurn = Math.round(Math.atan2(Math.abs(uRS.y - uLS.y), Math.abs(uRS.x - uLS.x)) * 180 / Math.PI);
    const refTurn = Math.round(Math.atan2(Math.abs(rRS.y - rLS.y), Math.abs(rRS.x - rLS.x)) * 180 / Math.PI);
    const diff = Math.abs(userTurn - refTurn);
    const score = proScore(userTurn, refTurn);

    let detail: string;
    if (diff < 8) detail = `Shoulder coil at prep (${userTurn}°) matches the pro's ${refTurn}° — solid unit turn. Your body is storing elastic energy before the swing starts, which is exactly where forehand power begins.`;
    else if (userTurn < refTurn - 8) detail = `Shoulder coil at prep is too shallow: you turned ${userTurn}° vs the pro's ${refTurn}°. Under-rotating here means the forehand relies on arm strength alone — you lose most of your potential racket-head speed. Drill: shadow-swing with an exaggerated turn until your front shoulder crosses the centre line before your backswing ends.`;
    else detail = `Shoulder turn (${userTurn}°) over-rotates vs the pro (${refTurn}°). Excess coil delays the shift to forward swing and makes timing erratic. Aim for a compact, controlled unit turn so the weight transfer starts immediately.`;

    let short: string, shortZhSimp: string, shortZhTrad: string;
    if (diff < 8) {
        short = `Shoulder turn OK (${userTurn}°→${refTurn}°) ✓`;
        shortZhSimp = `转肩角度正常 (${userTurn}°→${refTurn}°) ✓`; shortZhTrad = `轉肩角度正常 (${userTurn}°→${refTurn}°) ✓`;
    } else if (userTurn < refTurn - 8) {
        short = `Shoulder turn: coil more (${userTurn}°→${refTurn}°)`;
        shortZhSimp = `肩部转动角度不足 (${userTurn}°→${refTurn}°)`; shortZhTrad = `肩部轉動角度不足 (${userTurn}°→${refTurn}°)`;
    } else {
        short = `Shoulder turn: reduce coil (${userTurn}°→${refTurn}°)`;
        shortZhSimp = `肩部转动角度过大 (${userTurn}°→${refTurn}°)`; shortZhTrad = `肩部轉動角度過大 (${userTurn}°→${refTurn}°)`;
    }
    return { title: 'Shoulder turn', score, detail, short, shortZhSimp, shortZhTrad, rawValue: userTurn, rawUnit: '°' };
}

/** KINETICS — hip-to-shoulder kinetic chain separation at contact */
function checkKinetics(userFrames: PoseResult[], refFrames: PoseResult[]): FreeTip | null {
    const u = atNorm(userFrames, 0.55);
    const r = atNorm(refFrames, 0.55);
    if (!u || !r) return null;
    const uLS = getLm(u, LM.LEFT_SHOULDER), uRS = getLm(u, LM.RIGHT_SHOULDER);
    const uLH = getLm(u, LM.LEFT_HIP), uRH = getLm(u, LM.RIGHT_HIP);
    const rLS = getLm(r, LM.LEFT_SHOULDER), rRS = getLm(r, LM.RIGHT_SHOULDER);
    const rLH = getLm(r, LM.LEFT_HIP), rRH = getLm(r, LM.RIGHT_HIP);
    if (!uLS || !uRS || !uLH || !uRH || !rLS || !rRS || !rLH || !rRH) return null;

    const uSep = Math.abs((Math.atan2(uRS.y - uLS.y, uRS.x - uLS.x) - Math.atan2(uRH.y - uLH.y, uRH.x - uLH.x)) * 180 / Math.PI);
    const rSep = Math.abs((Math.atan2(rRS.y - rLS.y, rRS.x - rLS.x) - Math.atan2(rRH.y - rLH.y, rRH.x - rLH.x)) * 180 / Math.PI);
    const sep = Math.round(uSep);
    const diff = Math.abs(uSep - rSep);
    const score = proScore(uSep, rSep);

    let detail: string;
    if (diff < 5) detail = `Hip-shoulder separation (${sep}°) matches the pro's ${Math.round(rSep)}° — the kinetic sequence is working. Your hips are firing ahead of your shoulders, multiplying racket-head speed through the chain.`;
    else if (uSep < rSep - 5) detail = `Hip-shoulder separation is low (${sep}° vs pro's ${Math.round(rSep)}°) — hips and shoulders are rotating together instead of sequentially. This kills the 'X-factor' that multiplies power. Fix: push off the back foot and snap the hips before the upper body unwinds.`;
    else detail = `Separation of ${sep}° is larger than the pro's ${Math.round(rSep)}°. Good hip lead — now make sure the shoulder fires before the elbow, and the elbow before the wrist, to ride the whip effect all the way to the racket.`;

    let shortK: string, shortKZhSimp: string, shortKZhTrad: string;
    const rSepRound = Math.round(rSep);
    if (diff < 5) {
        shortK = `Hip–shoulder gap OK (${sep}°→${rSepRound}°) ✓`;
        shortKZhSimp = `髋肩分离角正常 (${sep}°→${rSepRound}°) ✓`; shortKZhTrad = `髖肩分離角正常 (${sep}°→${rSepRound}°) ✓`;
    } else if (uSep < rSep - 5) {
        shortK = `Hip–shoulder gap: lead hips (${sep}°→${rSepRound}°)`;
        shortKZhSimp = `髋肩分离角不足，先动髋 (${sep}°→${rSepRound}°)`; shortKZhTrad = `髖肩分離角不足，先動髖 (${sep}°→${rSepRound}°)`;
    } else {
        shortK = `Hip–shoulder gap: sequence (${sep}°→${rSepRound}°)`;
        shortKZhSimp = `髋肩分离角：注意发力顺序 (${sep}°→${rSepRound}°)`; shortKZhTrad = `髖肩分離角：注意發力順序 (${sep}°→${rSepRound}°)`;
    }
    return { title: 'Hip drive', score, detail, short: shortK, shortZhSimp: shortKZhSimp, shortZhTrad: shortKZhTrad, rawValue: sep, rawUnit: '°' };
}

/** FINISH — arm extension angle at follow-through */
function checkFinish(userFrames: PoseResult[], refFrames: PoseResult[]): FreeTip | null {
    const u = atNorm(userFrames, 0.85);
    const r = atNorm(refFrames, 0.85);
    if (!u || !r) return null;
    const uSh = getLm(u, LM.RIGHT_SHOULDER) ?? getLm(u, LM.LEFT_SHOULDER);
    const uEl = getLm(u, LM.RIGHT_ELBOW) ?? getLm(u, LM.LEFT_ELBOW);
    const uWr = getLm(u, LM.RIGHT_WRIST) ?? getLm(u, LM.LEFT_WRIST);
    const rSh = getLm(r, LM.RIGHT_SHOULDER) ?? getLm(r, LM.LEFT_SHOULDER);
    const rEl = getLm(r, LM.RIGHT_ELBOW) ?? getLm(r, LM.LEFT_ELBOW);
    const rWr = getLm(r, LM.RIGHT_WRIST) ?? getLm(r, LM.LEFT_WRIST);
    if (!uSh || !uEl || !uWr || !rSh || !rEl || !rWr) return null;

    const userAngle = Math.round(angle(uSh, uEl, uWr));
    const refAngle = Math.round(angle(rSh, rEl, rWr));
    const diff = Math.abs(userAngle - refAngle);
    const score = proScore(userAngle, refAngle);

    let detail: string;
    if (diff < 10) detail = `Elbow extension angle at follow-through (${userAngle}°) matches the pro's ${refAngle}° — textbook finish. A complete arc keeps the racket accelerating through the ball rather than decelerating into it.`;
    else if (userAngle < refAngle - 10) detail = `Elbow extension angle at follow-through is too acute: yours is ${userAngle}° vs the pro's ${refAngle}°. A bent elbow finish means the swing is stopping early — the racket decelerates before contact and topspin is lost. Cue: finish with your elbow pointing up and the racket over the opposite shoulder.`;
    else detail = `Elbow extension angle at follow-through is too wide (${userAngle}° vs pro's ${refAngle}°). Over-extending means the swing is long and arm-driven. Bring the elbow up and across the body earlier to tighten the arc.`;

    let shortF: string, shortFZhSimp: string, shortFZhTrad: string;
    if (diff < 10) {
        shortF = `Elbow finish angle OK (${userAngle}°→${refAngle}°) ✓`;
        shortFZhSimp = `肘部收拍角度正常 (${userAngle}°→${refAngle}°) ✓`; shortFZhTrad = `肘部收拍角度正常 (${userAngle}°→${refAngle}°) ✓`;
    } else if (userAngle < refAngle - 10) {
        shortF = `Elbow: extend finish (${userAngle}°→${refAngle}°)`;
        shortFZhSimp = `肘部收拍角度不足 (${userAngle}°→${refAngle}°)`; shortFZhTrad = `肘部收拍角度不足 (${userAngle}°→${refAngle}°)`;
    } else {
        shortF = `Elbow: tighten finish (${userAngle}°→${refAngle}°)`;
        shortFZhSimp = `肘部收拍角度过大 (${userAngle}°→${refAngle}°)`; shortFZhTrad = `肘部收拍角度過大 (${userAngle}°→${refAngle}°)`;
    }
    return { title: 'Elbow at finish', score, detail, short: shortF, shortZhSimp: shortFZhSimp, shortZhTrad: shortFZhTrad, rawValue: userAngle, rawUnit: '°' };
}

/** RACKET FACE — elbow angle at contact as proxy for racket face control */
function checkRacketFace(userFrames: PoseResult[], refFrames: PoseResult[]): FreeTip | null {
    const u = atNorm(userFrames, 0.58);
    const r = atNorm(refFrames, 0.58);
    if (!u || !r) return null;
    const uSh = getLm(u, LM.RIGHT_SHOULDER) ?? getLm(u, LM.LEFT_SHOULDER);
    const uEl = getLm(u, LM.RIGHT_ELBOW) ?? getLm(u, LM.LEFT_ELBOW);
    const uWr = getLm(u, LM.RIGHT_WRIST) ?? getLm(u, LM.LEFT_WRIST);
    const rSh = getLm(r, LM.RIGHT_SHOULDER) ?? getLm(r, LM.LEFT_SHOULDER);
    const rEl = getLm(r, LM.RIGHT_ELBOW) ?? getLm(r, LM.LEFT_ELBOW);
    const rWr = getLm(r, LM.RIGHT_WRIST) ?? getLm(r, LM.LEFT_WRIST);
    if (!uSh || !uEl || !uWr || !rSh || !rEl || !rWr) return null;

    const userAngle = Math.round(angle(uSh, uEl, uWr));
    const refAngle = Math.round(angle(rSh, rEl, rWr));
    const diff = Math.abs(userAngle - refAngle);
    const score = proScore(userAngle, refAngle);

    let detail: string;
    if (diff < 10) detail = `Elbow angle at contact (shoulder–elbow–wrist: ${userAngle}°) matches the pro's ${refAngle}° — arm position is keeping the racket face square and consistent through the hitting zone.`;
    else if (userAngle < refAngle - 10) detail = `Elbow angle at contact is too acute (shoulder–elbow–wrist: ${userAngle}° vs pro's ${refAngle}°). An over-bent elbow at impact typically closes the racket face early, causing net balls or heavy mis-hits. Cue: feel a straight line from shoulder to elbow as you meet the ball.`;
    else detail = `Elbow angle at contact is too wide (shoulder–elbow–wrist: ${userAngle}° vs pro's ${refAngle}°). A locked-out elbow removes the forearm's shock-absorber and can stress the joint. Keep a slight bend so the wrist can release through the ball.`;

    let shortR: string, shortRZhSimp: string, shortRZhTrad: string;
    if (diff < 10) {
        shortR = `Elbow contact angle OK (${userAngle}°→${refAngle}°) ✓`;
        shortRZhSimp = `肘部击球角度正常 (${userAngle}°→${refAngle}°) ✓`; shortRZhTrad = `肘部擊球角度正常 (${userAngle}°→${refAngle}°) ✓`;
    } else if (userAngle < refAngle - 10) {
        shortR = `Elbow: extend at contact (${userAngle}°→${refAngle}°)`;
        shortRZhSimp = `肘部击球角度过小 (${userAngle}°→${refAngle}°)`; shortRZhTrad = `肘部擊球角度過小 (${userAngle}°→${refAngle}°)`;
    } else {
        shortR = `Elbow: bend at contact (${userAngle}°→${refAngle}°)`;
        shortRZhSimp = `肘部击球角度过大 (${userAngle}°→${refAngle}°)`; shortRZhTrad = `肘部擊球角度過大 (${userAngle}°→${refAngle}°)`;
    }
    return { title: 'Elbow at contact', score, detail, short: shortR, shortZhSimp: shortRZhSimp, shortZhTrad: shortRZhTrad, rawValue: userAngle, rawUnit: '°' };
}

/** STABILITY — knee angle as proxy for athletic base/balance */
function checkStability(userFrames: PoseResult[], refFrames: PoseResult[]): FreeTip | null {
    const u = atNorm(userFrames, 0.3);
    const r = atNorm(refFrames, 0.3);
    if (!u || !r) return null;
    const uHip = getLm(u, LM.RIGHT_HIP) ?? getLm(u, LM.LEFT_HIP);
    const uKnee = getLm(u, LM.RIGHT_KNEE) ?? getLm(u, LM.LEFT_KNEE);
    const uAnkle = getLm(u, LM.RIGHT_ANKLE) ?? getLm(u, LM.LEFT_ANKLE);
    const rHip = getLm(r, LM.RIGHT_HIP) ?? getLm(r, LM.LEFT_HIP);
    const rKnee = getLm(r, LM.RIGHT_KNEE) ?? getLm(r, LM.LEFT_KNEE);
    const rAnkle = getLm(r, LM.RIGHT_ANKLE) ?? getLm(r, LM.LEFT_ANKLE);
    if (!uHip || !uKnee || !rHip || !rKnee) return null;

    const userKnee = uAnkle ? Math.round(angle(uHip, uKnee, uAnkle)) : 160;
    const refKnee = rAnkle ? Math.round(angle(rHip, rKnee, rAnkle)) : 160;
    const diff = Math.abs(userKnee - refKnee);
    const score = proScore(userKnee, refKnee);

    let detail: string;
    if (diff < 8) detail = `Knee flexion angle at setup (hip–knee–ankle: ${userKnee}°) matches the pro's ${refKnee}° — solid athletic base. Proper knee bend lowers your centre of gravity, giving you explosive push-off in any direction.`;
    else if (userKnee > refKnee + 8) detail = `Knee flexion angle is too wide at setup (hip–knee–ankle: ${userKnee}° vs pro's ${refKnee}°). A high angle means nearly straight legs — your centre of gravity is too high, you're slower laterally and lose ground-reaction power. Cue: 'sit on a stool' — bend until you feel weight in your quads.`;
    else detail = `Knee flexion angle is too acute at setup (hip–knee–ankle: ${userKnee}° vs pro's ${refKnee}°). Over-bending slows push-off reaction time. Rise slightly so the legs are coiled but not fully loaded — like a sprinter in blocks.`;

    let shortS: string, shortSZhSimp: string, shortSZhTrad: string;
    if (diff < 8) {
        shortS = `Knee flexion angle OK (${userKnee}°→${refKnee}°) ✓`;
        shortSZhSimp = `膝关节弯曲角度正常 (${userKnee}°→${refKnee}°) ✓`; shortSZhTrad = `膝關節彎曲角度正常 (${userKnee}°→${refKnee}°) ✓`;
    } else if (userKnee > refKnee + 8) {
        shortS = `Knee: bend more (${userKnee}°→${refKnee}°)`;
        shortSZhSimp = `膝关节需多弯曲 (${userKnee}°→${refKnee}°)`; shortSZhTrad = `膝關節需多彎曲 (${userKnee}°→${refKnee}°)`;
    } else {
        shortS = `Knee: straighten slightly (${userKnee}°→${refKnee}°)`;
        shortSZhSimp = `膝关节弯曲过多 (${userKnee}°→${refKnee}°)`; shortSZhTrad = `膝關節彎曲過多 (${userKnee}°→${refKnee}°)`;
    }
    return { title: 'Knee bend', score, detail, short: shortS, shortZhSimp: shortSZhSimp, shortZhTrad: shortSZhTrad, rawValue: userKnee, rawUnit: '°' };
}

// ─── Removed old functions (kept signature for type-safety) ──────────────────

function checkElbowAngle(userFrames: PoseResult[], refFrames: PoseResult[]): FreeTip | null {
    // Check at ~contact point (normalized 0.6)
    const u = atNorm(userFrames, 0.6);
    const r = atNorm(refFrames, 0.6);
    if (!u || !r) return null;

    // Prefer right side but fall back to left
    const uShoulder = getLm(u, LM.RIGHT_SHOULDER) ?? getLm(u, LM.LEFT_SHOULDER);
    const uElbow = getLm(u, LM.RIGHT_ELBOW) ?? getLm(u, LM.LEFT_ELBOW);
    const uWrist = getLm(u, LM.RIGHT_WRIST) ?? getLm(u, LM.LEFT_WRIST);
    const rShoulder = getLm(r, LM.RIGHT_SHOULDER) ?? getLm(r, LM.LEFT_SHOULDER);
    const rElbow = getLm(r, LM.RIGHT_ELBOW) ?? getLm(r, LM.LEFT_ELBOW);
    const rWrist = getLm(r, LM.RIGHT_WRIST) ?? getLm(r, LM.LEFT_WRIST);

    if (!uShoulder || !uElbow || !uWrist || !rShoulder || !rElbow || !rWrist) return null;

    const userAngle = angle(uShoulder, uElbow, uWrist);
    const refAngle = angle(rShoulder, rElbow, rWrist);
    const diff = Math.abs(userAngle - refAngle);
    const score = deviationScore(diff, 40);

    const ua = Math.round(userAngle), ra = Math.round(refAngle);
    let detail: string, detailZhSimp: string, detailZhTrad: string;
    let short: string, shortZhSimp: string, shortZhTrad: string;
    if (diff < 10) {
        detail = 'Your elbow angle at contact matches the pro closely. Great extension!';
        detailZhSimp = '接触点肘角与专业选手接近，延伸很好！';
        detailZhTrad = '接觸點肘角與專業選手接近，延伸很好！';
        short = 'Elbow angle looks great';
        shortZhSimp = '肘角良好，保持！';
        shortZhTrad = '肘角良好，保持！';
    } else if (userAngle < refAngle - 10) {
        detail = `Your elbow is more bent at contact (${ua}° vs pro's ${ra}°). Try to extend your arm further through the ball.`;
        detailZhSimp = `接触时肘部过弯（${ua}°，专业${ra}°），尝试更充分伸展击球。`;
        detailZhTrad = `接觸時肘部過彎（${ua}°，專業${ra}°），嘗試更充分伸展擊球。`;
        short = `Extend arm more (${ua}°→${ra}°)`;
        shortZhSimp = `接触时伸直手臂（${ua}°→${ra}°）`;
        shortZhTrad = `接觸時伸直手臂（${ua}°→${ra}°）`;
    } else {
        detail = `Your arm is straighter than ideal at contact (${ua}° vs pro's ${ra}°). Maintain a slight bend to generate more power.`;
        detailZhSimp = `接触时手臂偏直（${ua}°，专业${ra}°），保持微弯以增加力量。`;
        detailZhTrad = `接觸時手臂偏直（${ua}°，專業${ra}°），保持微彎以增加力量。`;
        short = `Bend elbow slightly (${ua}°→${ra}°)`;
        shortZhSimp = `接触时微弯手肘（${ua}°→${ra}°）`;
        shortZhTrad = `接觸時微彎手肘（${ua}°→${ra}°）`;
    }

    return { title: 'Elbow angle at contact', score, detail, detailZhSimp, detailZhTrad, short, shortZhSimp, shortZhTrad, rawValue: ua, rawUnit: '°' };
}

function checkShoulderRotation(userFrames: PoseResult[], refFrames: PoseResult[]): FreeTip | null {
    // Check at preparation phase (~0.3) and contact (~0.6)
    const uPrep = atNorm(userFrames, 0.3);
    const rPrep = atNorm(refFrames, 0.3);
    if (!uPrep || !rPrep) return null;

    const uLS = getLm(uPrep, LM.LEFT_SHOULDER);
    const uRS = getLm(uPrep, LM.RIGHT_SHOULDER);
    const rLS = getLm(rPrep, LM.LEFT_SHOULDER);
    const rRS = getLm(rPrep, LM.RIGHT_SHOULDER);

    if (!uLS || !uRS || !rLS || !rRS) return null;

    // Shoulder width in x as a proxy for rotation (narrower = more turned)
    const userWidth = Math.abs(uLS.x - uRS.x);
    const refWidth = Math.abs(rLS.x - rRS.x);
    const diff = Math.abs(userWidth - refWidth);
    const score = deviationScore(diff, 0.15);

    let detail: string, detailZhSimp: string, detailZhTrad: string;
    let short: string, shortZhSimp: string, shortZhTrad: string;
    if (diff < 0.03) {
        detail = 'Shoulder rotation in preparation looks great — well aligned with the pro.';
        detailZhSimp = '准备阶段肩部转动良好，与专业选手对齐。';
        detailZhTrad = '準備階段肩部轉動良好，與專業選手對齊。';
        short = 'Shoulder rotation is good';
        shortZhSimp = '肩部转动良好！';
        shortZhTrad = '肩部轉動良好！';
    } else if (userWidth > refWidth + 0.03) {
        detail = 'You can rotate your shoulders more during preparation. A fuller unit turn will give you more power and time to swing.';
        detailZhSimp = '可加大肩部转动，完整转体带来更多力量和挥拍时间。';
        detailZhTrad = '可加大肩部轉動，完整轉體帶來更多力量和揮拍時間。';
        short = 'Rotate shoulders more';
        shortZhSimp = '加大肩部转动幅度';
        shortZhTrad = '加大肩部轉動幅度';
    } else {
        detail = 'Your shoulder turn in preparation is slightly over-rotated. Focus on a controlled unit turn.';
        detailZhSimp = '肩部转动稍过，注意控制转体幅度。';
        detailZhTrad = '肩部轉動稍過，注意控制轉體幅度。';
        short = 'Ease shoulder rotation slightly';
        shortZhSimp = '肩部转动稍微控制';
        shortZhTrad = '肩部轉動稍微控制';
    }

    // Shoulder line angle from horizontal: 0° = face-on, 90° = fully turned
    const shoulderTurnDeg = Math.round(Math.atan2(Math.abs(uRS.y - uLS.y), Math.abs(uRS.x - uLS.x)) * 180 / Math.PI);
    return { title: 'Shoulder rotation (unit turn)', score, detail, detailZhSimp, detailZhTrad, short, shortZhSimp, shortZhTrad, rawValue: shoulderTurnDeg, rawUnit: '° turn' };
}

/** KINETIC CHAIN — evaluates the full ground-up power chain at contact.
 *  Computes two sub-metrics from pure landmarks (no ball needed):
 *    1. Leg drive: hip height above ankles as % of leg length (knee bend / weight loading)
 *    2. Arm reach: shoulder→wrist distance normalized to torso (arm extension into the shot)
 *  Reports whichever link deviates most from the PRO so feedback stays focused. */
function checkKineticChain(userFrames: PoseResult[], refFrames: PoseResult[]): FreeTip | null {
    const u = atNorm(userFrames, 0.6);
    const r = atNorm(refFrames, 0.6);
    if (!u || !r) return null;

    // ── shared landmarks ─────────────────────────────────────────────────────
    const uLH = getLm(u, LM.LEFT_HIP), uRH = getLm(u, LM.RIGHT_HIP);
    const rLH = getLm(r, LM.LEFT_HIP), rRH = getLm(r, LM.RIGHT_HIP);
    const uLS = getLm(u, LM.LEFT_SHOULDER) ?? getLm(u, LM.RIGHT_SHOULDER);
    const rLS = getLm(r, LM.LEFT_SHOULDER) ?? getLm(r, LM.RIGHT_SHOULDER);
    const uWr = getLm(u, LM.RIGHT_WRIST) ?? getLm(u, LM.LEFT_WRIST);
    const rWr = getLm(r, LM.RIGHT_WRIST) ?? getLm(r, LM.LEFT_WRIST);
    const uSh = getLm(u, LM.RIGHT_SHOULDER) ?? getLm(u, LM.LEFT_SHOULDER);
    const rSh = getLm(r, LM.RIGHT_SHOULDER) ?? getLm(r, LM.LEFT_SHOULDER);

    if (!uLH || !uRH || !rLH || !rRH) return null;

    const uHipY = (uLH.y + uRH.y) / 2;
    const rHipY = (rLH.y + rRH.y) / 2;
    const uHipX = (uLH.x + uRH.x) / 2;
    const rHipX = (rLH.x + rRH.x) / 2;

    // ── sub-metric 1: leg drive (hip drop relative to ankle) ─────────────────
    const uLA = getLm(u, LM.LEFT_ANKLE), uRA = getLm(u, LM.RIGHT_ANKLE);
    const rLA = getLm(r, LM.LEFT_ANKLE), rRA = getLm(r, LM.RIGHT_ANKLE);
    let legDriveDiff = 0, uLegPct = 0, rLegPct = 0;
    if ((uLA || uRA) && (rLA || rRA) && uLS && rLS) {
        const uAnkleY = uLA && uRA ? (uLA.y + uRA.y) / 2 : (uLA?.y ?? uRA!.y);
        const rAnkleY = rLA && rRA ? (rLA.y + rRA.y) / 2 : (rLA?.y ?? rRA!.y);
        // Leg length = ankle y minus shoulder y (full body height proxy)
        const uBodyH = uAnkleY - uLS.y;
        const rBodyH = rAnkleY - rLS.y;
        // Hip drop ratio: (ankleY - hipY) / bodyH  — higher = hips lower = more leg bend
        uLegPct = uBodyH > 0 ? Math.round(((uAnkleY - uHipY) / uBodyH) * 100) : 50;
        rLegPct = rBodyH > 0 ? Math.round(((rAnkleY - rHipY) / rBodyH) * 100) : 50;
        legDriveDiff = Math.abs(uLegPct - rLegPct);
    }

    // ── sub-metric 2: arm reach (shoulder→wrist / torso length) ─────────────
    let armReachDiff = 0, uArmPct = 0, rArmPct = 0;
    if (uSh && uWr && rSh && rWr) {
        const uTorso = uLS ? Math.abs(uHipY - uLS.y) || 0.25 : 0.25;
        const rTorso = rLS ? Math.abs(rHipY - rLS.y) || 0.25 : 0.25;
        const uReach = Math.sqrt((uWr.x - uSh.x) ** 2 + (uWr.y - uSh.y) ** 2);
        const rReach = Math.sqrt((rWr.x - rSh.x) ** 2 + (rWr.y - rSh.y) ** 2);
        uArmPct = Math.round((uReach / uTorso) * 100);
        rArmPct = Math.round((rReach / rTorso) * 100);
        armReachDiff = Math.abs(uArmPct - rArmPct);
    }

    // ── pick the weaker link ─────────────────────────────────────────────────
    // Normalise both diffs to comparable scales before picking
    const legWeight = legDriveDiff / 15;   // 15 % pts = "significant" for leg drop
    const armWeight = armReachDiff / 20;   // 20 % pts = "significant" for arm reach
    const useLegLink = legWeight >= armWeight;
    const score = proScore(
        useLegLink ? uLegPct : uArmPct,
        useLegLink ? rLegPct : rArmPct,
    );

    let detail: string, detailZhSimp: string, detailZhTrad: string;
    let short: string, shortZhSimp: string, shortZhTrad: string;
    let rawValue: number, rawUnit: string;

    if (useLegLink) {
        rawValue = uLegPct; rawUnit = '% leg';
        const diff = uLegPct - rLegPct;
        if (Math.abs(diff) < 5) {
            detail = `Leg drive at contact (${uLegPct}%) matches the pro's ${rLegPct}% — the ground→knee→hip chain is activating well. Your body is loading into the shot and efficiently transferring force upward.`;
            detailZhSimp = `击球时腿部发力良好，髋部下沉比例（${uLegPct}%）与专业选手匹配，动力链运作正常。`;
            detailZhTrad = `擊球時腿部發力良好，髖部下沉比例（${uLegPct}%）與專業選手匹配，動力鏈運作正常。`;
            short = `Leg drive ideal (${uLegPct}%→${rLegPct}%) ✓`;
            shortZhSimp = `腿部发力到位 (${uLegPct}%→${rLegPct}%) ✓`;
            shortZhTrad = `腿部發力到位 (${uLegPct}%→${rLegPct}%) ✓`;
        } else if (diff < 0) {
            // Hips too high (legs too straight)
            detail = `Legs are too straight at contact (${uLegPct}% vs pro's ${rLegPct}% hip drop). Upright legs mean the shot is all arm — you're losing the ground-reaction force that feeds power up the chain. Cue: 'sink and drive' — bend the knees and push into the court as you swing.`;
            detailZhSimp = `击球时腿部过于伸展（${uLegPct}% vs 专业${rLegPct}%），损失地面反作用力。弯曲膝盖，向地面发力以激活全身动力链。`;
            detailZhTrad = `擊球時腿部過於伸展（${uLegPct}% vs 專業${rLegPct}%），損失地面反作用力。彎曲膝蓋，向地面發力以激活全身動力鏈。`;
            short = `Sink into ball (${uLegPct}%→${rLegPct}%)`;
            shortZhSimp = `重心下沉击球 (${uLegPct}%→${rLegPct}%)`;
            shortZhTrad = `重心下沉擊球 (${uLegPct}%→${rLegPct}%)`;
        } else {
            detail = `Hips are lower than the pro at contact (${uLegPct}% vs ${rLegPct}%). Good leg load — but a very deep squat can stall the upward energy transfer. Rise through the swing so the hip drive propels the torso rotation above it.`;
            detailZhSimp = `击球时髋部下沉过多（${uLegPct}% vs 专业${rLegPct}%），过深的下蹲会阻碍向上的能量传导，挥拍时适当抬升发力。`;
            detailZhTrad = `擊球時髖部下沉過多（${uLegPct}% vs 專業${rLegPct}%），過深的下蹲會阻礙向上的能量傳導，揮拍時適當抬升發力。`;
            short = `Rise through contact (${uLegPct}%→${rLegPct}%)`;
            shortZhSimp = `击球时向上发力 (${uLegPct}%→${rLegPct}%)`;
            shortZhTrad = `擊球時向上發力 (${uLegPct}%→${rLegPct}%)`;
        }
    } else {
        rawValue = uArmPct; rawUnit = '% torso';
        if (Math.abs(uArmPct - rArmPct) < 8) {
            detail = `Arm reach at contact (${uArmPct}% of torso) matches the pro's ${rArmPct}% — the shoulder→elbow→wrist chain is fully extending into the shot. Good centrifugal power delivery.`;
            detailZhSimp = `击球时手臂延伸幅度（${uArmPct}%）与专业选手匹配（${rArmPct}%），肩肘腕动力链充分发力。`;
            detailZhTrad = `擊球時手臂延伸幅度（${uArmPct}%）與專業選手匹配（${rArmPct}%），肩肘腕動力鏈充分發力。`;
            short = `Arm chain ideal (${uArmPct}%→${rArmPct}%) ✓`;
            shortZhSimp = `手臂动力链到位 (${uArmPct}%→${rArmPct}%) ✓`;
            shortZhTrad = `手臂動力鏈到位 (${uArmPct}%→${rArmPct}%) ✓`;
        } else if (uArmPct < rArmPct - 8) {
            detail = `Arm reach is short at contact (${uArmPct}% vs pro's ${rArmPct}% of torso). A tucked arm means less centrifugal force and a smaller hitting arc — power bleeds out before the racket reaches the ball. Fix: drive the elbow forward first, then let the forearm and wrist whip through.`;
            detailZhSimp = `击球时手臂延伸不足（${uArmPct}% vs 专业${rArmPct}%），减少了离心力和击打弧度。先以肘部领先，再让前臂和手腕鞭打发力。`;
            detailZhTrad = `擊球時手臂延伸不足（${uArmPct}% vs 專業${rArmPct}%），減少了離心力和擊打弧度。先以肘部領先，再讓前臂和手腕鞭打發力。`;
            short = `Extend arm chain (${uArmPct}%→${rArmPct}%)`;
            shortZhSimp = `充分伸展臂部链 (${uArmPct}%→${rArmPct}%)`;
            shortZhTrad = `充分伸展臂部鏈 (${uArmPct}%→${rArmPct}%)`;
        } else {
            detail = `Arm over-reaches at contact (${uArmPct}% vs pro's ${rArmPct}% of torso). A fully locked arm removes the wrist-lag that creates snap and spin — and risks elbow strain. Cue: keep a slight elbow bend at impact and let the wrist release naturally through the ball.`;
            detailZhSimp = `击球时手臂过度延伸（${uArmPct}% vs 专业${rArmPct}%），失去手腕甩臂力量且增加肘部压力。保持肘部微弯，手腕自然释放击球。`;
            detailZhTrad = `擊球時手臂過度延伸（${uArmPct}% vs 專業${rArmPct}%），失去手腕甩臂力量且增加肘部壓力。保持肘部微彎，手腕自然釋放擊球。`;
            short = `Less arm overreach (${uArmPct}%→${rArmPct}%)`;
            shortZhSimp = `减少手臂过伸 (${uArmPct}%→${rArmPct}%)`;
            shortZhTrad = `減少手臂過伸 (${uArmPct}%→${rArmPct}%)`;
        }
    }

    return { title: 'Kinetic chain', score, detail, detailZhSimp, detailZhTrad, short, shortZhSimp, shortZhTrad, rawValue, rawUnit };
}

function checkKneeBend(userFrames: PoseResult[], refFrames: PoseResult[]): FreeTip | null {
    // Check at preparation (~0.3)
    const u = atNorm(userFrames, 0.3);
    const r = atNorm(refFrames, 0.3);
    if (!u || !r) return null;

    const uHip = getLm(u, LM.RIGHT_HIP) ?? getLm(u, LM.LEFT_HIP);
    const uKnee = getLm(u, LM.RIGHT_KNEE) ?? getLm(u, LM.LEFT_KNEE);
    const rHip = getLm(r, LM.RIGHT_HIP) ?? getLm(r, LM.LEFT_HIP);
    const rKnee = getLm(r, LM.RIGHT_KNEE) ?? getLm(r, LM.LEFT_KNEE);

    if (!uHip || !uKnee || !rHip || !rKnee) return null;

    // y distance hip→knee as a proxy for bend (larger = more bent)
    const userBend = Math.abs(uKnee.y - uHip.y);
    const refBend = Math.abs(rKnee.y - rHip.y);
    const diff = Math.abs(userBend - refBend);
    const score = deviationScore(diff, 0.1);

    let detail: string, detailZhSimp: string, detailZhTrad: string;
    let short: string, shortZhSimp: string, shortZhTrad: string;
    if (diff < 0.02) {
        detail = 'Your knee bend and athletic stance match the pro. Solid base!';
        detailZhSimp = '屈膝和准备姿势与专业选手一致，底盘稳健！';
        detailZhTrad = '屈膝和準備姿勢與專業選手一致，底盤穩健！';
        short = 'Knee bend is solid';
        shortZhSimp = '屈膝良好，底盘稳健！';
        shortZhTrad = '屈膝良好，底盤穩健！';
    } else if (userBend < refBend - 0.02) {
        detail = 'Bend your knees more in the ready position. A lower center of gravity gives you better balance and power.';
        detailZhSimp = '准备姿势屈膝不足，降低重心可获得更好的平衡和发力。';
        detailZhTrad = '準備姿勢屈膝不足，降低重心可獲得更好的平衡和發力。';
        short = 'Bend knees more';
        shortZhSimp = '多屈膝降低重心';
        shortZhTrad = '多屈膝降低重心';
    } else {
        detail = 'Your stance is slightly lower than the pro. Check your footwork and make sure you can push off fluidly.';
        detailZhSimp = '站姿重心略低于专业选手，确保脚步灵活随时蹬地发力。';
        detailZhTrad = '站姿重心略低於專業選手，確保腳步靈活隨時蹬地發力。';
        short = 'Lighten knee bend slightly';
        shortZhSimp = '屈膝稍大，稍微调整';
        shortZhTrad = '屈膝稍大，稍微調整';
    }

    // Compute actual knee angle in degrees using hip-knee-ankle
    const uAnkle = getLm(u, LM.RIGHT_ANKLE) ?? getLm(u, LM.LEFT_ANKLE);
    const kneeAngleDeg = uAnkle ? Math.round(angle(uHip, uKnee, uAnkle)) : null;
    return { title: 'Knee bend & athletic stance', score, detail, detailZhSimp, detailZhTrad, short, shortZhSimp, shortZhTrad, ...(kneeAngleDeg !== null && { rawValue: kneeAngleDeg, rawUnit: '°' }) };
}

function checkHipShoulderDifferential(userFrames: PoseResult[], refFrames: PoseResult[]): FreeTip | null {
    // At contact (~0.6)
    const u = atNorm(userFrames, 0.6);
    const r = atNorm(refFrames, 0.6);
    if (!u || !r) return null;

    const uLS = getLm(u, LM.LEFT_SHOULDER);
    const uRS = getLm(u, LM.RIGHT_SHOULDER);
    const uLH = getLm(u, LM.LEFT_HIP);
    const uRH = getLm(u, LM.RIGHT_HIP);
    const rLS = getLm(r, LM.LEFT_SHOULDER);
    const rRS = getLm(r, LM.RIGHT_SHOULDER);
    const rLH = getLm(r, LM.LEFT_HIP);
    const rRH = getLm(r, LM.RIGHT_HIP);

    if (!uLS || !uRS || !uLH || !uRH || !rLS || !rRS || !rLH || !rRH) return null;

    // Angle of shoulder line relative to hip line (kinetic chain rotation)
    const uShoulderAngle = Math.atan2(uRS.y - uLS.y, uRS.x - uLS.x) * 180 / Math.PI;
    const uHipAngle = Math.atan2(uRH.y - uLH.y, uRH.x - uLH.x) * 180 / Math.PI;
    const rShoulderAngle = Math.atan2(rRS.y - rLS.y, rRS.x - rLS.x) * 180 / Math.PI;
    const rHipAngle = Math.atan2(rRH.y - rLH.y, rRH.x - rLH.x) * 180 / Math.PI;

    const userDiff = uShoulderAngle - uHipAngle;
    const refDiff = rShoulderAngle - rHipAngle;
    const deviation = Math.abs(userDiff - refDiff);
    const score = deviationScore(deviation, 20);

    let detail: string, detailZhSimp: string, detailZhTrad: string;
    let short: string, shortZhSimp: string, shortZhTrad: string;
    if (deviation < 5) {
        detail = 'Hip-to-shoulder kinetic chain rotation looks good!';
        detailZhSimp = '髋肩分离动力链旋转良好！';
        detailZhTrad = '髖肩分離動力鏈旋轉良好！';
        short = 'Hip-shoulder rotation great';
        shortZhSimp = '髋肩分离良好！';
        shortZhTrad = '髖肩分離良好！';
    } else if (userDiff < refDiff - 5) {
        detail = 'Try to rotate your upper body more independently from your hips at contact. This separation generates more racket speed.';
        detailZhSimp = '接触时躯干独立转动不足，更大的髋肩分离能有效提升拍速。';
        detailZhTrad = '接觸時軀幹獨立轉動不足，更大的髖肩分離能有效提升拍速。';
        short = 'Separate torso more from hips';
        shortZhSimp = '加大躯肩分离度';
        shortZhTrad = '加大軀肩分離度';
    } else {
        detail = 'There is good hip-shoulder separation, but make sure you are leading with the hips first, then the upper body following through.';
        detailZhSimp = '髋肩分离良好，记住先转髋，再带动上身跟进完成随挥。';
        detailZhTrad = '髖肩分離良好，記住先轉髖，再帶動上身跟進完成隨揮。';
        short = 'Lead hips first, then torso';
        shortZhSimp = '先转髋再带动上身';
        shortZhTrad = '先轉髖再帶動上身';
    }

    return { title: 'Hip-to-shoulder kinetic chain', score, detail, detailZhSimp, detailZhTrad, short, shortZhSimp, shortZhTrad, rawValue: Math.round(Math.abs(userDiff)), rawUnit: '°' };
}

// ─── Main export ──────────────────────────────────────────────────────────────

/** Build a coaching encouragement that references the actual best/worst metric found */
function buildTennisEncouragement(tips: FreeTip[], overallScore: number): string {
    if (!tips.length) {
        if (overallScore >= 70) return 'Good work! Your mechanics are solid. Focus on the tips below to level up.';
        return "Keep going! Every rep builds muscle memory. Work through these tips one at a time.";
    }
    const sorted = [...tips].sort((a, b) => a.score - b.score);
    const worst = sorted[0];
    const best = sorted[sorted.length - 1];
    // First clause of each detail (up to first sentence-ending punctuation)
    const worstClause = worst.detail.split(/[.!?]/)[0].trim();
    const bestClause = best.detail.split(/[.!?]/)[0].trim();

    if (overallScore >= 85) {
        const suffix = worst.score >= 80
            ? 'All metrics are dialed in — keep polishing every rep.'
            : `Main focus: ${worstClause.charAt(0).toLowerCase() + worstClause.slice(1)}.`;
        return `Excellent form! ${bestClause}. ${suffix}`;
    }
    if (worst.score < 55) {
        return `${worstClause}. Fixing this single area will unlock the biggest jump in your score. Check all tips below for the full picture.`;
    }
    if (overallScore >= 70) {
        return `Good mechanics overall. Key priority: ${worstClause.charAt(0).toLowerCase() + worstClause.slice(1)}. Nail this and your whole game levels up.`;
    }
    return `Keep pushing! ${worstClause}. Work through each tip below — consistent drilling builds lasting muscle memory.`;
}

export class FreeTennisCoach {
    static analyze(
        userFrames: PoseResult[],
        refFrames: PoseResult[],
        _motionType: string
    ): FreeFeedback {
        if (!userFrames.length || !refFrames.length) {
            return {
                encouragement: "Analysis complete. Upload both videos to get detailed feedback.",
                overallScore: 50,
                tips: [],
            };
        }

        const checks = [
            checkPrep(userFrames, refFrames),
            checkKinetics(userFrames, refFrames),
            checkKineticChain(userFrames, refFrames),
            checkFinish(userFrames, refFrames),
            checkRacketFace(userFrames, refFrames),
            checkStability(userFrames, refFrames),
        ].filter((t): t is FreeTip => t !== null);

        // Keep fixed display order (Prep → Kinetics → Timing → Finish → Racket Face → Stability)
        const topTips = checks;
        const overallScore =
            topTips.length > 0
                ? Math.round(topTips.reduce((s, t) => s + t.score, 0) / topTips.length)
                : 70;

        const encouragement = buildTennisEncouragement(topTips, overallScore);

        return { encouragement, overallScore, tips: topTips };
    }
}
