// Demo and fallback feedback generation

import { MotionAnalysisService } from '../MotionAnalysisRouter';
import type { SkillType, ServeFeedback, RichTip } from './types';

// Build FIFA-style richTips from phase scores
export function buildRichTips(
    phases: Record<string, { score: number; feedback: string }>,
    motionType: SkillType,
    overallScore: number
): RichTip[] {
    const g = (key: string) => phases[key]?.score ?? overallScore;

    if (motionType === 'serve') {
        return [
            { label: 'Power', abbr: 'PWR', icon: '⚡', score: Math.round((g('loading') + g('contact')) / 2), detail: 'Drive from the ground up — leg push, hip uncoil, shoulder rotation, arm extension, wrist snap. Each segment multiplies racket-head speed at impact.' },
            { label: 'Accuracy', abbr: 'ACC', icon: '🎯', score: g('ball_toss'), detail: "Ball toss consistency is the single biggest accuracy lever. Aim 1 o'clock, full arm extension, zero wrist spin. Practice 50 tosses daily without swinging." },
            { label: 'Technique', abbr: 'TEC', icon: '🎾', score: g('loading'), detail: 'Trophy pose: elbow above shoulder, racket scratches the back. Hold it for 1 full second in shadow serves until the position is automatic and locked in.' },
            { label: 'Balance', abbr: 'BAL', icon: '⚖️', score: Math.round((g('preparation') + g('finish')) / 2), detail: 'Shoulder-width stance pre-serve, land on front foot at finish. An imbalanced platform transfers directly into an erratic and inconsistent ball toss.' },
            { label: 'Kinetic Chain', abbr: 'KIN', icon: '🔗', score: overallScore, detail: 'Ground → legs → hips → torso → shoulder → elbow → wrist — sequential energy transfer. A break at any single link costs significant racket-head speed.' },
            { label: 'Follow Through', abbr: 'FIN', icon: '🏃', score: g('finish'), detail: 'Racket finishes across the opposite hip, not downward. Land controlled on front foot. Cutting the follow-through short is the #1 cause of serve arm strain.' },
        ];
    }
    if (motionType === 'forehand') {
        return [
            { label: 'Power', abbr: 'PWR', icon: '⚡', score: Math.round((g('racket_drop') + g('contact')) / 2), detail: 'Power = racket lag + leg drive. The deeper the racket drops below your hip before contact, the more snap you generate. Drive your legs upward at impact.' },
            { label: 'Topspin', abbr: 'TOP', icon: '🌀', score: g('racket_drop'), detail: "Steep 6-to-12 o'clock brush on the ball at contact. Exaggerate the low-to-high swing path in slow-motion shadow swings until the motion is fully grooved." },
            { label: 'Timing', abbr: 'TIM', icon: '⏱', score: g('unit_turn'), detail: 'Unit turn triggers at split-step — not at the bounce. Full 90-degree shoulder coil before the ball crosses the service line = free power and shot options.' },
            { label: 'Contact', abbr: 'CON', icon: '🎯', score: g('contact'), detail: '18–24 inches in front of your leading hip. Firm wrist at impact. Drive upward with your legs through contact — let ground force generate the ball speed.' },
            { label: 'Balance', abbr: 'BAL', icon: '⚖️', score: Math.round((g('unit_turn') + g('follow_through')) / 2), detail: 'Weight transfers from back to front foot at contact — not before. Stay patient on the back foot, then push explosively through the shot at the right moment.' },
            { label: 'Follow Through', abbr: 'FIN', icon: '🏃', score: g('follow_through'), detail: 'Windshield-wiper wrap over the opposite shoulder. Head stays still through contact. Recover racket to neutral in under 0.5 seconds for the next shot.' },
        ];
    }
    if (motionType === 'backhand') {
        return [
            { label: 'Power', abbr: 'PWR', icon: '⚡', score: Math.round((g('racket_drop') + g('contact')) / 2), detail: 'Two-handed power: non-dominant arm drives 60% of the shot. Pull through with the top hand while the bottom hand guides. Think "left arm forehand" on backhand side.' },
            { label: 'Topspin', abbr: 'TOP', icon: '🌀', score: g('racket_drop'), detail: 'Drop racket head below hitting shoulder before the forward swing. Loose grip going into the drop, firm at impact. Steep upward brush = heavy topspin.' },
            { label: 'Timing', abbr: 'TIM', icon: '⏱', score: g('unit_turn'), detail: 'Backhand unit turn must complete before the ball crosses the service line. Use your split-step as the trigger to initiate shoulder rotation immediately.' },
            { label: 'Contact', abbr: 'CON', icon: '🎯', score: g('contact'), detail: 'Both hands drive through impact together in front of your leading hip. Firm wrists at contact — non-dominant hand release only after the ball has left the strings.' },
            { label: 'Balance', abbr: 'BAL', icon: '⚖️', score: Math.round((g('unit_turn') + g('follow_through')) / 2), detail: 'Cross-step with dominant foot (closed stance) for maximum rotation and stability. Keep your head and eyes completely level through the entire swing arc.' },
            { label: 'Follow Through', abbr: 'FIN', icon: '🏃', score: g('follow_through'), detail: 'High finish above the leading shoulder with both arms extending fully. The non-dominant hand can release mid-follow-through for a natural wrap-around finish.' },
        ];
    }
    // Generic: derive directly from available phase keys
    const phaseKeys = Object.keys(phases);
    const icons = ['⚡', '🎯', '🎾', '⚖️', '🔗', '🏃'];
    return phaseKeys.slice(0, 6).map((key, i) => ({
        label: key.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
        abbr: key.split('_').map((w: string) => w[0]?.toUpperCase() ?? '').join('').slice(0, 3),
        icon: icons[i] ?? '●',
        score: phases[key].score,
        detail: phases[key].feedback,
    }));
}

function enrichWithRichTips(result: ServeFeedback, motionType: SkillType): ServeFeedback {
    if (!result.richTips) {
        result.richTips = buildRichTips(result.phases, motionType, result.overallScore);
    }
    return result;
}

// Generate demo feedback (simulated for demo)
function _generateDemoFeedback(motionType: SkillType = 'serve'): ServeFeedback {
    if (motionType === 'serve') {
        const scores = {
            preparation: Math.floor(Math.random() * 30) + 70,
            ball_toss: Math.floor(Math.random() * 40) + 60,
            loading: Math.floor(Math.random() * 35) + 65,
            contact: Math.floor(Math.random() * 30) + 70,
            finish: Math.floor(Math.random() * 35) + 65,
        };
        const overall = Math.floor(
            (scores.preparation + scores.ball_toss + scores.loading + scores.contact + scores.finish) / 5
        );
        return {
            isDemo: true,
            overallScore: overall,
            phases: {
                preparation: { score: scores.preparation, feedback: "Good stance! Keep your weight on the balls of your feet." },
                ball_toss: { score: scores.ball_toss, feedback: "Toss is slightly too far forward. Aim for 1 o'clock." },
                loading: { score: scores.loading, feedback: "Great racket drop! This will generate good power." },
                contact: { score: scores.contact, feedback: "Excellent extension at contact point!" },
                finish: { score: scores.finish, feedback: "Nice follow-through across your body!" },
            },
            tips: ["Focus on a consistent ball toss", "Keep your eyes on the ball"],
            encouragement: "Great effort! Your serve is really coming together.",
            visualIssues: []
        };
    } else if (motionType === 'volley' || motionType === 'forehand_volley' || motionType === 'backhand_volley') {
        const scores = {
            preparation: Math.floor(Math.random() * 20) + 75,
            contact: Math.floor(Math.random() * 25) + 70,
            follow_through: Math.floor(Math.random() * 20) + 80,
        };
        const overall = Math.round((scores.preparation + scores.contact + scores.follow_through) / 3);
        const volleyType = motionType === 'forehand_volley' ? 'Forehand Volley' : motionType === 'backhand_volley' ? 'Backhand Volley' : 'Volley';
        return {
            isDemo: true,
            overallScore: overall,
            phases: {
                preparation: { score: scores.preparation, feedback: "Good ready position with racket up." },
                contact: { score: scores.contact, feedback: "Solid contact in front of your body." },
                follow_through: { score: scores.follow_through, feedback: "Controlled finish after contact." },
            },
            tips: ["Keep racket up and ready", "Step forward into the shot", "Use opponent's pace"],
            encouragement: `Excellent ${volleyType}! Your net play is improving.`,
            visualIssues: []
        };
    } else if (motionType === 'overhead') {
        const scores = {
            preparation: Math.floor(Math.random() * 30) + 65,
            contact: Math.floor(Math.random() * 30) + 65,
            follow_through: Math.floor(Math.random() * 20) + 80,
        };
        const overall = Math.round((scores.preparation + scores.contact + scores.follow_through) / 3);
        return {
            isDemo: true,
            overallScore: overall,
            phases: {
                preparation: { score: scores.preparation, feedback: "Good positioning under the ball. Point with non-hitting hand." },
                contact: { score: scores.contact, feedback: "Strong contact at peak extension. Drive down through ball." },
                follow_through: { score: scores.follow_through, feedback: "Powerful finish with controlled landing." },
            },
            tips: ["Get positioned early", "Point up with non-hitting hand", "Contact at highest point"],
            encouragement: "Powerful overhead! Work on positioning for consistency.",
            visualIssues: []
        };
    } else if (motionType === 'lob') {
        const scores = {
            preparation: Math.floor(Math.random() * 20) + 75,
            contact: Math.floor(Math.random() * 30) + 65,
            follow_through: Math.floor(Math.random() * 25) + 75,
        };
        const overall = Math.round((scores.preparation + scores.contact + scores.follow_through) / 3);
        return {
            isDemo: true,
            overallScore: overall,
            phases: {
                preparation: { score: scores.preparation, feedback: "Excellent disguise - setup looked identical to drive shot." },
                contact: { score: scores.contact, feedback: "Perfect paddle face angle for optimal trajectory. Contact under ball center." },
                follow_through: { score: scores.follow_through, feedback: "Strong high finish targeting 10-15 feet above net height." },
            },
            tips: ["Disguise shot until contact", "Open paddle face for arc", "Target deep baseline"],
            encouragement: 'Strategic lob! Excellent court awareness and execution depth.',
            visualIssues: []
        };
    } else if (motionType === 'drop') {
        const scores = {
            setup: Math.floor(Math.random() * 25) + 70,
            contact: Math.floor(Math.random() * 30) + 65,
            follow_through: Math.floor(Math.random() * 20) + 75,
        };
        const overall = Math.round((scores.setup + scores.contact + scores.follow_through) / 3);
        return {
            isDemo: true,
            overallScore: overall,
            phases: {
                setup: { score: scores.setup, feedback: "Perfect disguise - preparation identical to aggressive drive shot." },
                contact: { score: scores.contact, feedback: "Excellent brush technique under ball creating optimal backspin." },
                follow_through: { score: scores.follow_through, feedback: "Soft down-and-across finish with great kitchen placement." },
            },
            tips: ["Disguise as drive until contact", "Brush down for backspin", "Target soft kitchen landing"],
            encouragement: 'Masterful drop shot! Your touch is exceptionally well-developed.',
            visualIssues: []
        };
    } else {
        // Enhanced Forehand/Backhand with professional insights
        const scores = {
            unit_turn: Math.floor(Math.random() * 20) + 80,
            racket_drop: Math.floor(Math.random() * 30) + 70,
            contact: Math.floor(Math.random() * 30) + 70,
            follow_through: Math.floor(Math.random() * 20) + 80,
        };
        const overall = Math.round((scores.unit_turn + scores.racket_drop + scores.contact + scores.follow_through) / 4);
        const isBackhand = motionType === 'backhand';
        return {
            isDemo: true,
            overallScore: overall,
            phases: {
                unit_turn: {
                    score: scores.unit_turn,
                    feedback: isBackhand ?
                        "Excellent shoulder turn with proper two-handed grip positioning." :
                        "Strong early coil with full 90-degree shoulder rotation."
                },
                racket_drop: {
                    score: scores.racket_drop,
                    feedback: isBackhand ?
                        "Good compact racket drop with head below wrist before forward swing." :
                        "Smooth low-to-high loop with natural wrist layback creating lag."
                },
                contact: {
                    score: scores.contact,
                    feedback: isBackhand ?
                        "Solid contact with both hands through impact and firm wrist position." :
                        "Excellent strike in front of body with closed racket face and leg drive."
                },
                follow_through: {
                    score: scores.follow_through,
                    feedback: isBackhand ?
                        "Complete high finish with full extension and immediate recovery." :
                        "Perfect wrap-around finish over opposite shoulder with balance."
                }
            },
            tips: isBackhand ?
                ["Keep both hands on racket longer", "Step into shot with opposite foot", "Drive through with core rotation"] :
                ["Turn shoulders early on every ball", "Drive up with legs through contact", "Finish high over opposite shoulder"],
            encouragement: isBackhand ?
                "Outstanding backhand mechanics! Your two-handed control is excellent." :
                "Exceptional forehand technique! Your topspin and power generation are superb.",
            visualIssues: []
        };
    }
}

// Generate feedback based on real scores but without AI (Fallback) - ENHANCED with Pro Coach Insights
function _generateFallbackFeedback(
    comparison: { overallScore: number, frameScores: number[] },
    motionType: SkillType = 'serve',
    sport: 'tennis' = MotionAnalysisService.getSport()
): ServeFeedback {
    // Map 50 frames to phases (approximate)
    const getPhaseScore = (start: number, end: number) => {
        const slice = comparison.frameScores.slice(start, end);
        const sum = slice.reduce((a, b) => a + b, 0);
        return Math.round(sum / slice.length) || 0;
    };

    if (motionType === 'serve') {
        const scores = {
            preparation: getPhaseScore(0, 10),
            ball_toss: getPhaseScore(10, 20),
            loading: getPhaseScore(20, 30),
            contact: getPhaseScore(30, 40),
            finish: getPhaseScore(40, 50),
        };
        const normalizedOverall = Math.round((scores.preparation + scores.ball_toss + scores.loading + scores.contact + scores.finish) / 5);
        const getFeedback = (score: number, phase: string): string => {
            if (score >= 85) return `Excellent ${phase}! Professional-level form matching tour standards.`;
            if (score >= 75) {
                if (phase === 'preparation') return "Strong stance foundation visible. Refine grip pressure consistency.";
                if (phase === 'ball_toss') return "Good toss consistency shown. Ensure placement stays front of baseline.";
                if (phase === 'loading') return "Solid trophy position. Optimize shoulder-hip separation timing.";
                if (phase === 'contact') return "Strong contact evident. Increase arm extension at peak by 5-10%.";
                return "Good finish completion. Land with better balance control.";
            }
            if (phase === 'preparation') return "Reset stance fundamentals - width, angle, and weight distribution need work.";
            if (phase === 'ball_toss') return "Rebuild toss consistency - practice 20 tosses daily without racket.";
            if (phase === 'loading') return "Work on trophy position - elbow must be above shoulder at slot.";
            if (phase === 'contact') return "Extend to full reach at contact - currently abbreviating impact point.";
            return "Complete finish fully - prevents injury and improves consistency.";
        };
        return {
            isDemo: false,
            overallScore: normalizedOverall,
            phases: {
                preparation: { score: scores.preparation, feedback: getFeedback(scores.preparation, 'preparation') },
                ball_toss: { score: scores.ball_toss, feedback: getFeedback(scores.ball_toss, 'ball_toss') },
                loading: { score: scores.loading, feedback: getFeedback(scores.loading, 'loading') },
                contact: { score: scores.contact, feedback: getFeedback(scores.contact, 'contact') },
                finish: { score: scores.finish, feedback: getFeedback(scores.finish, 'finish') },
            },
            tips: ["Practice toss placement consistency", "Work on trophy position geometry", "Increase racket head speed with pronation"],
            encouragement: `Professional analysis complete! Overall score: ${normalizedOverall}%. Focus on the lower-scoring phases for rapid improvement.`
        };
    } else if (motionType === 'volley' || motionType === 'overhead' || motionType === 'lob' || motionType === 'drop') {
        const scores = {
            phase1: getPhaseScore(0, 15),
            phase2: getPhaseScore(15, 35),
            phase3: getPhaseScore(35, 50),
        };
        const phaseNames: Record<string, string[]> = {
            'volley': ['Ready Position', 'Punch Contact', 'Placement Recovery'],
            'overhead': ['Court Positioning', 'Contact Extension', 'Finish Control'],
            'lob': ['Disguise Setup', 'Trajectory Control', 'Deep Placement'],
            'drop': ['Drive Disguise', 'Spin Generation', 'Net Placement']
        };
        const names = phaseNames[motionType] || ['Preparation', 'Contact', 'Follow-through'];
        const getDetailedFeedback = (score: number, phaseName: string): string => {
            if (score >= 85) return `Outstanding ${phaseName.toLowerCase()}! Tour-level technique visible.`;
            if (score >= 75) {
                if (phaseName.includes('Ready')) return "Good ready position. Refine split-step timing with opponent's racket contact.";
                if (phaseName.includes('Punch')) return "Solid punch motion. Increase firmness at impact point.";
                if (phaseName.includes('Setup')) return "Strong kitchen line control. Enhance paddle angle consistency.";
                if (phaseName.includes('Soft')) return "Good touch control. Work on placement precision to target zones.";
                if (phaseName.includes('Disguise')) return "Effective disguise working. Maintain it through contact point.";
                if (phaseName.includes('Spin')) return "Good backspin generation. Increase brush-down motion slightly.";
                return "Good fundamentals present. Optimize for higher consistency.";
            }
            if (phaseName.includes('Ready')) return "Rebuild ready position - racket head up, weight forward on balls of feet.";
            if (phaseName.includes('Punch')) return "Practice punch volley drills - no follow-through, firm wrist only.";
            if (phaseName.includes('Setup')) return "Strengthen kitchen positioning - stay closer to net line, lower center.";
            if (phaseName.includes('Soft')) return "Develop soft touch - reduce arm motion, focus on finesse over power.";
            if (phaseName.includes('Disguise')) return "Work on shot disguise daily - motion must appear identical until contact.";
            if (phaseName.includes('Spin')) return "Master spin technique - brush down through ball systematically.";
            return "Rebuild core fundamentals for this skill through structured drills.";
        };
        return {
            isDemo: false,
            overallScore: comparison.overallScore,
            phases: {
                phase1: { score: scores.phase1, feedback: getDetailedFeedback(scores.phase1, names[0]) },
                phase2: { score: scores.phase2, feedback: getDetailedFeedback(scores.phase2, names[1]) },
                phase3: { score: scores.phase3, feedback: getDetailedFeedback(scores.phase3, names[2]) },
            },
            tips: [`Master ${motionType} technique through targeted practice`, 'Video yourself for form analysis', 'Compare against pro reference footage'],
            encouragement: `Detailed ${motionType} analysis complete! Score: ${comparison.overallScore}%. Review each phase feedback for improvement areas.`
        };
    } else {
        // Enhanced Forehand/Backhand with professional insights
        const scores = {
            unit_turn: getPhaseScore(0, 15),
            racket_drop: getPhaseScore(15, 30),
            contact: getPhaseScore(30, 40),
            follow_through: getPhaseScore(40, 50),
        };
        const getFeedback = (score: number, phase: string, isBackhand: boolean): string => {
            if (score >= 85) {
                if (phase === 'unit_turn') return isBackhand ? "Excellent coil! Full shoulder rotation primes the kinetic chain perfectly." : "Excellent unit turn! Full 90-degree shoulder rotation loaded and ready.";
                if (phase === 'racket_drop') return isBackhand ? "Excellent racket drop! Natural lag below the hitting shoulder creates ideal power." : "Excellent racket drop! Natural wrist layback creates optimal lag for topspin and pace.";
                if (phase === 'contact') return isBackhand ? "Outstanding contact! Both hands driving through with full extension and firm wrist." : "Outstanding contact! Ball struck well in front with a full arm extension and leg drive.";
                return isBackhand ? "Outstanding finish! Complete high wrap-over with quick recovery to ready position." : "Outstanding follow-through! High wrap-around over the opposite shoulder with excellent balance.";
            }
            if (score >= 75) {
                if (phase === 'unit_turn') return isBackhand ? "Good shoulder turn. Initiate the coil a split-second earlier off your split-step." : "Strong early coil visible. Fire the unit turn the moment the ball leaves opponent's racket.";
                if (phase === 'racket_drop') return isBackhand ? "Solid racket drop. Let the head fall slightly lower below the wrist before driving forward." : "Good preparation loop. Drop the racket head deeper — below hip level — to maximise lag and topspin.";
                if (phase === 'contact') return isBackhand ? "Both hands through well. Strike 2-4 inches further in front of your body for a cleaner contact point." : "Good strike zone. Extend further in front of your leading hip and drive your legs upward through contact.";
                return isBackhand ? "High finish strong. Recover your racket to ready position 0.5 seconds faster between shots." : "Wrap-around finish good. Keep hips rotating through to complete the kinetic chain and improve consistency.";
            }
            if (phase === 'unit_turn') return isBackhand ? "Rebuild: Initiate shoulder turn the moment the ball leaves your opponent's racket — late coil kills power." : "Rebuild: Full shoulder turn is essential — practice shadow coil drills, turning 90 degrees off every split-step.";
            if (phase === 'racket_drop') return isBackhand ? "Focus: Let the racket head drop below the wrist before the forward swing — shadow swing at half-speed to feel the natural lag." : "Rebuild: Drop the racket head past hip level in a full low-to-high arc — the lag you create here is the source of topspin and power.";
            if (phase === 'contact') return isBackhand ? "Focus: Contact the ball 18-24 inches in front of your body with both hands — no elbow collapse at impact." : "Focus: Meet the ball 18-24 inches in front of your leading hip — an early contact point eliminates arm push and adds pace.";
            return isBackhand ? "Finish: Drive all the way to a high follow-through over the shoulder — an abbreviated finish bleeds pace and consistency." : "Finish: Complete a full high wrap over the opposite shoulder — stopping short reduces topspin, pace, and recovery position.";
        };
        const isBackhand = motionType === 'backhand';
        return {
            isDemo: false,
            overallScore: comparison.overallScore,
            phases: {
                unit_turn: { score: scores.unit_turn, feedback: getFeedback(scores.unit_turn, 'unit_turn', isBackhand) },
                racket_drop: { score: scores.racket_drop, feedback: getFeedback(scores.racket_drop, 'racket_drop', isBackhand) },
                contact: { score: scores.contact, feedback: getFeedback(scores.contact, 'contact', isBackhand) },
                follow_through: { score: scores.follow_through, feedback: getFeedback(scores.follow_through, 'follow_through', isBackhand) },
            },
            tips: isBackhand ?
                ["Practice two-handed sync drills", "Work on backhand slice variation", "Develop backhand down-the-line consistency"] :
                ["Use topspin on rallies for consistency", "Practice inside-out forehand", "Work on forehand approach shot depth"],
            encouragement: `${isBackhand ? 'Backhand' : 'Forehand'} analysis complete! Score: ${comparison.overallScore}%. Continue drilling the highlighted improvement areas.`
        };
    }
}

// Public wrappers that auto-enrich with richTips
export function generateDemoFeedback(motionType: SkillType = 'serve'): ServeFeedback {
    return enrichWithRichTips(_generateDemoFeedback(motionType), motionType);
}

export function generateFallbackFeedback(
    comparison: { overallScore: number, frameScores: number[] },
    motionType: SkillType = 'serve',
    sport: 'tennis' = MotionAnalysisService.getSport()
): ServeFeedback {
    return enrichWithRichTips(_generateFallbackFeedback(comparison, motionType, sport), motionType);
}
