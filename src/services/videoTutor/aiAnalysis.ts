// AI-powered motion analysis via Gemini API and tips extraction

import { MotionAnalysisService } from '../MotionAnalysisRouter';
import { getGoogleApiKey } from './types';
import { generateFallbackFeedback, generateDemoFeedback, buildRichTips } from './feedback';
import type { SkillType, AnalysisFeedback } from './types';

// Analyze and compare motion to ideal (uses Gemini when available)
export async function analyzeMotionWithAI(
    motionType: SkillType,
    userDescription: string,
    comparisonData?: { overallScore: number, frameScores: number[] },
    sport: 'tennis' = MotionAnalysisService.getSport()
): Promise<AnalysisFeedback> {
    try {
        const googleApiKey = getGoogleApiKey();
        if (!googleApiKey) {
            if (comparisonData) return generateFallbackFeedback(comparisonData, motionType, sport);
            return generateDemoFeedback(motionType);
        }

        const servePrompt = `You are a certified professional tennis coach providing detailed technical analysis of a serve. Analyze the motion data and provide specific feedback for each phase:

PREPARATION: Analyze stance, grip, balance, and setup positioning. Give 2-3 specific technical corrections.
BALL_TOSS: Analyze ball placement, release point, and timing consistency. Give 2-3 specific improvements.
LOADING: Analyze trophy position, shoulder turn, and racquet preparation. Give 2-3 technical points.
CONTACT: Analyze extension, contact point, and power generation. Give 2-3 specific techniques.
FINISH: Analyze completion, balance, and recovery. Give 2-3 technical improvements.

Format response as: PREPARATION: [feedback]. BALL_TOSS: [feedback]. LOADING: [feedback]. CONTACT: [feedback]. FINISH: [feedback].`;

        const systemPrompts: Record<string, string> = {
            serve: servePrompt,

            forehand: `You are a certified professional tennis coach providing detailed technical analysis of a forehand stroke. Analyze the motion data and provide specific feedback for each phase:

UNIT_TURN: Analyze shoulder rotation, split-step timing, and early unit-turn preparation. Give 2-3 specific corrections.
RACKET_DROP: Analyze the low-to-high loop arc, wrist layback (lag), racket head drop below hip, and preparation timing. Give 2-3 technical improvements.
CONTACT: Analyze strike zone (in front of leading hip), weight transfer, arm extension, and racket face control. Give 2-3 specific techniques.
FOLLOW_THROUGH: Analyze high finish over opposite shoulder, hip rotation completion, balance, and recovery. Give 2-3 technical points.

Format response as: UNIT_TURN: [feedback]. RACKET_DROP: [feedback]. CONTACT: [feedback]. FOLLOW_THROUGH: [feedback].`,

            backhand: `You are a certified professional tennis coach providing detailed technical analysis of a backhand stroke. Analyze the motion data and provide specific feedback for each phase:

UNIT_TURN: Analyze shoulder rotation, split-step timing, and early unit-turn preparation. Give 2-3 specific corrections.
RACKET_DROP: Analyze the racket head drop below the hitting shoulder (creating lag), compact preparation path, and wrist position. Give 2-3 technical improvements.
CONTACT: Analyze strike zone (in front of body), both hands through impact (two-handed), arm extension, and wrist firmness. Give 2-3 specific techniques.
FOLLOW_THROUGH: Analyze high finish position, hip rotation completion, balance, and recovery. Give 2-3 technical points.

Format response as: UNIT_TURN: [feedback]. RACKET_DROP: [feedback]. CONTACT: [feedback]. FOLLOW_THROUGH: [feedback].`
        };

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${googleApiKey}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                contents: [{
                    parts: [{
                        text: `${systemPrompts[motionType]}\n\nAnalyze this data and respond with similar JSON: ${userDescription}`
                    }]
                }],
                generationConfig: {
                    temperature: 1.0,
                    maxOutputTokens: 512
                }
            }),
        });

        if (!response.ok) {
            const bodyText = await response.text().catch(() => '');
            const details = bodyText ? ` - ${bodyText.slice(0, 500)}` : '';
            throw new Error(`Gemini API error: ${response.status} ${response.statusText}${details}`);
        }

        const data = await response.json();
        const content = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (content) {
            let coaching = content.trim();
            if (coaching.startsWith('```')) {
                coaching = coaching.replace(/^```[a-z]*\s*/, '').replace(/\s*```$/, '');
            }

            const percentMatch = coaching.match(/(100|[1-9]?\d)(?:\s*\/\s*100|%|\s+out\s+of\s+100)/i);
            const labeledScoreMatch = coaching.match(/(?:overall|similarity|score)\s*[:=-]?\s*(100|[1-9]?\d)\b/i);
            const parsedScore = percentMatch
                ? parseInt(percentMatch[1], 10)
                : labeledScoreMatch
                    ? parseInt(labeledScoreMatch[1], 10)
                    : NaN;
            const comparisonFallback = comparisonData?.overallScore;
            const comparisonScore = typeof comparisonFallback === 'number'
                ? Math.max(0, Math.min(100, Math.round(comparisonFallback)))
                : null;
            const overallScore = comparisonScore ??
                (Number.isFinite(parsedScore)
                    ? Math.max(0, Math.min(100, parsedScore))
                    : 75);

            const scoreFromComparisonWindow = (start: number, end: number, fallback: number = overallScore): number => {
                const fs = comparisonData?.frameScores;
                if (!fs || fs.length === 0) return fallback;
                const s = Math.max(0, Math.floor(start));
                const e = Math.min(fs.length, Math.ceil(end));
                const slice = fs.slice(s, e);
                if (slice.length === 0) return fallback;
                const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
                return Math.max(0, Math.min(100, Math.round(avg)));
            };

            const parsePhaseFeedback = (phaseKey: string): string => {
                const regex = new RegExp(`${phaseKey.toUpperCase()}:\\s*([^.]*(?:\\.[^A-Z]*)*?)(?=\\s*[A-Z]+:|$)`, 'i');
                const match = coaching.match(regex);
                if (match && match[1]) {
                    const feedback = match[1].trim();
                    if (!feedback.includes('•') && !feedback.includes('-')) {
                        return feedback.split('.').filter((s: string) => s.trim().length > 10)
                            .map((s: string) => `• ${s.trim()}`)
                            .slice(0, 3)
                            .join('\n');
                    }
                    return feedback;
                }
                return '';
            };

            let phases: Record<string, { score: number; feedback: string }>;

            if (motionType === 'serve') {
                phases = {
                    preparation: {
                        score: scoreFromComparisonWindow(0, 10),
                        feedback: parsePhaseFeedback('preparation') || "• Establish wider stance for improved stability and balance\n• Position feet at 45-degree angle to baseline for optimal power transfer\n• Maintain relaxed grip pressure while ensuring proper continental grip positioning"
                    },
                    ball_toss: {
                        score: scoreFromComparisonWindow(10, 20),
                        feedback: parsePhaseFeedback('ball_toss') || "• Focus on consistent toss height approximately 12-18 inches above contact point\n• Place ball slightly in front of body and to the right for power positioning\n• Develop smooth, repeatable toss motion with minimal wrist involvement"
                    },
                    loading: {
                        score: scoreFromComparisonWindow(20, 30),
                        feedback: parsePhaseFeedback('loading') || "• Achieve proper trophy position with elbow elevated and racquet behind head\n• Coordinate shoulder rotation with racquet preparation for kinetic chain efficiency\n• Maintain proper timing between toss release and backswing completion"
                    },
                    contact: {
                        score: scoreFromComparisonWindow(30, 40),
                        feedback: parsePhaseFeedback('contact') || "• Extend fully upward at contact with complete arm extension\n• Execute proper wrist snap and pronation for maximum racquet head speed\n• Strike ball at peak of reach for optimal power and placement control"
                    },
                    finish: {
                        score: scoreFromComparisonWindow(40, 50),
                        feedback: parsePhaseFeedback('finish') || "• Complete motion with racquet finishing across body naturally\n• Land on front foot with controlled balance and ready position\n• Maintain proper deceleration to prevent injury and prepare for next shot"
                    }
                };
            } else {
                phases = {
                    unit_turn: {
                        score: scoreFromComparisonWindow(0, 15),
                        feedback: parsePhaseFeedback('unit_turn') || "• Initiate shoulder turn the moment the ball leaves opponent's racket\n• Fire the unit turn off every split-step for optimal court position\n• Coordinate upper and lower body rotation to fully load the kinetic chain"
                    },
                    racket_drop: {
                        score: scoreFromComparisonWindow(15, 30),
                        feedback: parsePhaseFeedback('racket_drop') || "• Allow racket head to drop below hip level creating natural wrist layback (lag)\n• Drive the elbow forward as a 'windshield wiper' during acceleration into contact\n• Maintain a relaxed grip through the drop to maximize snap and topspin at contact"
                    },
                    contact: {
                        score: scoreFromComparisonWindow(30, 40),
                        feedback: parsePhaseFeedback('contact') || "• Strike the ball 18-24 inches in front of your leading hip for a clean contact point\n• Drive upward with your legs through contact to transfer ground force into the ball\n• Maintain a firm wrist at impact — let the arm extend fully before the windshield-wiper finish"
                    },
                    follow_through: {
                        score: scoreFromComparisonWindow(40, 50),
                        feedback: parsePhaseFeedback('follow_through') || "• Complete a high wrap-around finish over the opposite shoulder\n• Continue rotating your hips through to finish the kinetic chain and add pace\n• Return immediately to ready position — recover the racket to neutral in under 0.5 seconds"
                    }
                };
            }

            const phaseValues = Object.values(phases)
                .map(p => p?.score)
                .filter((v): v is number => typeof v === 'number' && isFinite(v));
            const normalizedOverall = phaseValues.length > 0
                ? Math.round(phaseValues.reduce((a, b) => a + b, 0) / phaseValues.length)
                : overallScore;

            const result: AnalysisFeedback = {
                isDemo: false,
                overallScore: normalizedOverall,
                phases: phases,
                tips: [],
                richTips: buildRichTips(phases, motionType, normalizedOverall),
                encouragement: "Through dedicated practice and attention to these technical details, your stroke mechanics will continue to develop and improve."
            };

            return result;
        }
    } catch (error) {
        console.log('Using fallback feedback (API unavailable or error)', error);
        if (comparisonData) return generateFallbackFeedback(comparisonData, motionType, sport);
    }

    return generateDemoFeedback(motionType);
}

// Extract actionable tips from Gemini's coaching feedback
export function extractTipsFromFeedback(feedback: string, motionType: 'serve' | 'forehand' | 'backhand'): string[] {
    const tips: string[] = [];

    const drillPatterns = [
        /\d+\.\s*([^.!?]+(?:drill|practice|focus|work on|try)[^.!?]*[.!?])/gi,
        /[-•]\s*([^.!?]+(?:drill|practice|focus|work on|try)[^.!?]*[.!?])/gi,
        /(?:drill|practice|tip)[^:]*:\s*([^.!?]+[.!?])/gi
    ];

    for (const pattern of drillPatterns) {
        const matches = [...feedback.matchAll(pattern)];
        matches.forEach(match => {
            const tip = match[1].trim().replace(/[.!?]+$/, '');
            if (tip.length > 10 && tip.length < 100) {
                tips.push(tip);
            }
        });
    }

    if (tips.length === 0) {
        const sentences = feedback.split(/[.!?]+/).filter(s => s.trim().length > 20);
        for (const sentence of sentences.slice(0, 3)) {
            const cleanSentence = sentence.trim();
            if (cleanSentence && cleanSentence.length < 80) {
                tips.push(cleanSentence);
            }
        }
    }

    if (tips.length === 0) {
        const fallbackTips: Record<string, string[]> = {
            serve: [
                "Practice your ball toss against a wall for consistency",
                "Focus on the trophy pose - elbow up, racket behind head",
                "Drive up with your legs and snap your wrist at contact"
            ],
            forehand: [
                "Turn your shoulders early on every ball",
                "Practice hitting with a straight arm for power",
                "Finish with your racket over your opposite shoulder"
            ],
            backhand: [
                "Keep your non-dominant hand on the racket longer",
                "Step into the ball with your opposite foot",
                "Drive through the ball with your core rotation"
            ]
        };
        return fallbackTips[motionType] ?? [];
    }

    return tips.slice(0, 3);
}
