/**
 * InjuryRiskEngine
 *
 * Rule-based knowledge base that maps movement defect combinations to
 * specific sports injuries with 3-level risk classification.
 *
 * Coverage:
 *   网球肘 (Tennis Elbow / Lateral Epicondylitis)
 *   肩袖劳损 (Rotator Cuff Strain)
 *   肩峰撞击综合征 (Shoulder Impingement Syndrome)
 *   膝关节内侧损伤 (Medial Knee Strain / MCL)
 *   腰背拉伤 (Lower Back Strain)
 *   腕关节腱鞘炎 (Wrist Tenosynovitis / De Quervain's)
 */

import type { DefectTag, InjuryRisk, InjuryType, RiskLevel } from './types';

interface InjuryRule {
    injuryType: InjuryType;
    name: string;
    nameZh: string;
    bodyPart: string;
    bodyPartZh: string;
    /** ALL required defects must be present to trigger this rule */
    required: DefectTag[];
    /** ANY amplifier present upgrades baseRisk → highRisk */
    amplifiers?: DefectTag[];
    baseRisk: RiskLevel;
    highRisk: RiskLevel;
    mechanism: string;
    mechanismZh: string;
    prevention: string[];
    preventionZh: string[];
}

// ── Knowledge Base ─────────────────────────────────────────────────────────────

const RULES: InjuryRule[] = [
    // ── Shoulder Impingement ──────────────────────────────────────────────────────
    {
        injuryType: 'SHOULDER_IMPINGEMENT',
        name: 'Shoulder Impingement Syndrome',
        nameZh: '肩峰撞击综合征',
        bodyPart: 'shoulder',
        bodyPartZh: '肩关节',
        required: ['SERVE_ELBOW_HIGH'],
        amplifiers: ['ARM_COMPENSATION', 'INSUFFICIENT_ROTATION'],
        baseRisk: 'medium',
        highRisk: 'high',
        mechanismZh:
            '高肘发球使肩关节在极度外展/外旋位置承受高速内旋负荷，加速肱骨头' +
            '与肩峰间软组织（肩峰下滑囊、冈上肌腼）磨损。上脂代偿发力进一步加劇' +
            '局部动态撞击，长期可导致慢性肩痛或肩袖撃裂。',
        mechanism:
            'The high-elbow serve loads the rotator cuff in extreme abduction/external rotation during the internal-rotation phase, ' +
            'accelerating wear on the subacromial bursa and supraspinatus tendon. ' +
            'Arm compensation further magnifies dynamic impingement, which can progress to chronic shoulder pain or rotator cuff tear.',
        preventionZh: [
            '调整触球点略偏内，减少极度外旋幅度',
            '加强冈上肌、冈下肌离心力量训练（哑铃外旋练习）',
            '打球前充分热身肩部旋转；每次打球后冰敟肩峰区10分钟',
            '感到肩部夹痛时立即停止发球，并进行专业运动康复评估',
        ],
        prevention: [
            'Adjust contact point slightly inward to reduce extreme external rotation',
            'Strengthen rotator cuff with eccentric external-rotation exercises (dumbbell ER drills)',
            'Warm up shoulder rotation thoroughly before play; ice the acromion area for 10 min after',
            'Stop serving immediately if you feel a pinching sensation and seek a sports-medicine assessment',
        ],
    },

    // ── Rotator Cuff Strain ────────────────────────────────────────────────────────
    {
        injuryType: 'ROTATOR_CUFF',
        name: 'Rotator Cuff Strain',
        nameZh: '肩袖劳损',
        bodyPart: 'shoulder',
        bodyPartZh: '肩关节',
        required: ['SERVE_ELBOW_HIGH'],
        amplifiers: ['KINETIC_CHAIN_BREAK', 'DELAYED_WEIGHT_TRANSFER'],
        baseRisk: 'medium',
        highRisk: 'high',
        mechanismZh:
            '发球加速阶段肩袖承受最大离心负荷。高肘姿势让肩袖处于拉伸位额外' +
            '承受剪切力；若发力链路脱节，手臂被迫独立完成加速，肩袖微小撕裂将' +
            '累积加重，最终发展为慢性肩袖劳损。',
        mechanism:
            'The rotator cuff bears maximum eccentric load during the acceleration phase. ' +
            'A high-elbow position places the cuff in a stretched posture under additional shear; if the kinetic chain breaks down, ' +
            'the arm must accelerate alone, accumulating micro-tears that progressively worsen into chronic rotator cuff strain.',
        preventionZh: [
            '纠正举拍位：肘部高度不超过肩部，肘关节屈曲75–110°',
            '练习完整的蹬地-转体-挥拍联动，减少肩部单独发力',
            '发球训练每组30个不超过，组间充分休息（≥90秒）',
            '出现肩后外侧酸痛需及时停止，可用MRI确认肩袖状态',
        ],
        prevention: [
            'Correct trophy position: elbow no higher than the shoulder, elbow flexion 75–110°',
            'Rehearse full push-off → rotation → swing linkage to reduce isolated shoulder effort',
            'Limit serve sets to 30 repetitions, with ≥90 s rest between sets',
            'Rest and consider MRI if you feel posterior-lateral shoulder soreness',
        ],
    },

    // ── Tennis Elbow ──────────────────────────────────────────────────────────────
    {
        injuryType: 'TENNIS_ELBOW',
        name: 'Tennis Elbow (Lateral Epicondylitis)',
        nameZh: '网球肘（肱骨外上髁炎）',
        bodyPart: 'elbow / forearm',
        bodyPartZh: '肘关节/前臂',
        required: ['LOCKED_ELBOW'],
        amplifiers: ['ARM_COMPENSATION', 'RIGID_WRIST_BACKHAND'],
        baseRisk: 'medium',
        highRisk: 'high',
        mechanismZh:
            '肘关节在接近伸直位（>165°）承受冲击时，应力集中于肱骨外上髁' +
            '的伸腕肌附着点。反手击球时手腕僵硬进一步加剧前臂伸肌腱的离心' +
            '牵拉，是网球肘最典型的生物力学成因。上肢代偿发力增加局部重复' +
            '性应力，加快外上髁炎的发展进程。',
        mechanism:
            'Near full elbow extension (>165°) at contact concentrates stress on the extensor muscle attachment at the lateral epicondyle. ' +
            'Wrist rigidity on the backhand amplifies eccentric traction on the forearm extensors — the classic biomechanical cause of tennis elbow. ' +
            'Arm compensation adds repetitive local stress, accelerating the development of lateral epicondylitis.',
        preventionZh: [
            '正手和反手均保持肘关节适度弯曲（120–158°），严禁“锁死”状态接球',
            '反手击球时手腕维持中立位，不要在接触前后做折腕补偿动作',
            '每周用离心训练法强化伸腕肌（腕部离心下放练习3×15次）',
            '肘外侧出现持续酸痛时减少打球量，佔戴网球肘护具缓解肌腼应力',
        ],
        prevention: [
            'Maintain moderate elbow flexion on both forehand and backhand (120–158°); never lock the elbow at contact',
            'Keep the wrist in neutral on backhand; avoid compensatory wrist snap before or after contact',
            'Strengthen wrist extensors with eccentric training (wrist eccentric lowering 3×15)',
            'If lateral elbow pain persists, reduce play volume and wear a lateral epicondyle strap',
        ],
    },

    // ── Wrist Tenosynovitis – Tennis Backhand ─────────────────────────────────────
    {
        injuryType: 'WRIST_TENDINITIS',
        name: 'Wrist Tenosynovitis (Backhand)',
        nameZh: '腕关节腱鞘炎（反手）',
        bodyPart: 'wrist',
        bodyPartZh: '腕关节',
        required: ['RIGID_WRIST_BACKHAND'],
        amplifiers: ['ARM_COMPENSATION', 'LOCKED_ELBOW'],
        baseRisk: 'low',
        highRisk: 'medium',
        mechanismZh:
            '反手击球时手腕过于固定，在高频冲击下腕关节屈/伸肌腱鞘内摩擦' +
            '力大幅增加，长期积累导致腱鞘滑膜炎症，典型表现为腕桡侧刺痛。',
        mechanism:
            'With the wrist locked on backhand contact, high-frequency impacts produce sustained friction inside the wrist tendon sheaths. ' +
            'This leads to synovial inflammation, typically presenting as a sharp pain on the radial side of the wrist.',
        preventionZh: [
            '反手接触时手腕保持中立并允许自然随挥，避免强行锁定',
            '每次打球后做腕关节轻柔旋转和前臂伸肌肌拉伸（30秒/侧）',
            '若出现腕梐侧弹响或晨间酸痛，尽早就医排查腼鞘炎',
        ],
        prevention: [
            'Allow the wrist to stay neutral and follow through naturally on backhand; avoid forcibly locking it',
            'After play, gently rotate the wrist and stretch the forearm extensors (30 s each side)',
            'Seek medical advice if you notice radial-side wrist clicking or morning soreness to rule out tenosynovitis',
        ],
    },

    // ── Medial Knee ────────────────────────────────────────────────────────────────
    {
        injuryType: 'MEDIAL_KNEE',
        name: 'Medial Knee Strain',
        nameZh: '膝关节内侧损伤（MCL/半月板）',
        bodyPart: 'knee',
        bodyPartZh: '膝关节',
        required: ['HIGH_COG'],
        amplifiers: ['INSUFFICIENT_ROTATION', 'DELAYED_WEIGHT_TRANSFER', 'EXCESSIVE_LATERAL_TILT'],
        baseRisk: 'medium',
        highRisk: 'medium',
        mechanismZh:
            '屈膝不足时膝关节无法充分分散侧向移动冲击力，急停变向时全部' +
            '应力直接作用于内侧副韧带和内侧半月板。髋部旋转不足进一步' +
            '增大膝关节内扣剪切力，长期导致慢性磨损性损伤。',
        mechanism:
            'When the knee is insufficiently bent, the joint cannot absorb lateral movement impact effectively. ' +
            'During sudden stops and direction changes, all stress acts directly on the medial collateral ligament and medial meniscus. ' +
            'Insufficient hip rotation further increases medial knee valgus shear, leading to chronic wear injuries over time.',
        preventionZh: [
            '专项训练“分腿蹲”和“侧步滑步”，让低重心移动成为习惯',
            '确保击球时膝盖弯曲度≥105°，充分缓冲地面反作用力',
            '每周加强臀中肌（侧卧抖腿、弹力带侧走），减少膝关节内扣',
            '打球穿有足弓支撑的专业运动鞋，减少膝关节旋转应力',
        ],
        prevention: [
            'Train split squats and lateral slide steps to make low-center-of-gravity movement habitual',
            'Ensure knee bend ≥105° at contact to properly absorb ground reaction force',
            'Strengthen the gluteus medius weekly (side-lying leg raises, lateral band walks) to reduce knee valgus',
            'Wear sport shoes with proper arch support to reduce rotational knee stress',
        ],
    },

    // ── Lower Back Strain ─────────────────────────────────────────────────────────
    {
        injuryType: 'LOWER_BACK',
        name: 'Lower Back Strain',
        nameZh: '腰背拉伤',
        bodyPart: 'lumbar spine',
        bodyPartZh: '腰背部',
        required: ['ARM_COMPENSATION'],
        amplifiers: ['INSUFFICIENT_ROTATION', 'DELAYED_WEIGHT_TRANSFER', 'EXCESSIVE_LATERAL_TILT'],
        baseRisk: 'low',
        highRisk: 'medium',
        mechanismZh:
            '上脂代偿发力时躯干旋转被绕过，腰椎代替高关节承担了过多扆转' +
            '负荷。在重复击球中，腰背肌及棘间韧带逐渐疲劳，触发拉伤或' +
            '下腰痛综合征。',
        mechanism:
            'When the arm compensates, the torso rotation is bypassed and the lumbar spine absorbs excessive torsional load that should go through the hips. ' +
            'Over repeated strokes, the lower-back muscles and interspinous ligaments fatigue progressively, triggering strain or lower-back pain syndrome.',
        preventionZh: [
            '先转高再挥臂——有意识地让发力来源从腰转移到高',
            '每周进行核心稳定训练：平板支撑、Bird-Dog各3组，保护腰椎',
            '打球前充分热身腰背（猫牛式、腰椎旋转），感觉腰背紧绷时不要全力击球',
            '长期腰背疼痛需排查腰椎间盘问题，进行专业运动康复评估',
        ],
        prevention: [
            'Lead with the hip before swinging — consciously shift power generation from the lower back to the hips',
            'Train core stability weekly: plank and Bird-Dog holds (3 sets each) to protect the lumbar spine',
            'Warm up the lower back before play (cat-cow, lumbar rotation); avoid full-power shots when the back feels tight',
            'Persistent lower-back pain warrants lumbar disc evaluation and professional sports rehabilitation assessment',
        ],
    },
];

// ── Classification API ─────────────────────────────────────────────────────────

/** Classify injury risks from a set of detected defect tags */
export function classifyInjuryRisks(defects: DefectTag[]): InjuryRisk[] {
    const defectSet = new Set(defects);
    const results: InjuryRisk[] = [];
    const seenTypes = new Set<InjuryType>();

    for (const rule of RULES) {
        // Each injury type is returned only once (highest-risk match wins)
        if (seenTypes.has(rule.injuryType)) continue;

        // All required defects must be present
        if (!rule.required.every(d => defectSet.has(d))) continue;

        const hasAmplifier = rule.amplifiers?.some(d => defectSet.has(d)) ?? false;
        const riskLevel: RiskLevel = hasAmplifier ? rule.highRisk : rule.baseRisk;

        results.push({
            injuryType: rule.injuryType,
            name: rule.name,
            nameZh: rule.nameZh,
            riskLevel,
            bodyPart: rule.bodyPart,
            bodyPartZh: rule.bodyPartZh,
            triggerDefects: [
                ...rule.required,
                ...(rule.amplifiers?.filter(d => defectSet.has(d)) ?? []),
            ],
            mechanism: rule.mechanism,
            mechanismZh: rule.mechanismZh,
            prevention: rule.prevention,
            preventionZh: rule.preventionZh,
        });
        seenTypes.add(rule.injuryType);
    }

    // Sort: high → medium → low
    const order: Record<RiskLevel, number> = { high: 0, medium: 1, low: 2 };
    return results.sort((a, b) => order[a.riskLevel] - order[b.riskLevel]);
}
