/**
 * PHASE_DISPLAY_NAMES
 * 
 * Unified phase naming system providing:
 * - Technical names (snake_case): Used in phase definitions and code
 * - Display names: Professional coaching terms for UI display
 * 
 * This ensures consistency across:
 * - CalibrationService.PHASE_DEFINITIONS (snake_case)
 * - VideoTutor feedback generation (uses snake_case keys)
 * - UI rendering (professional display names)
 */

export const PHASE_DISPLAY_NAMES: Record<string, string> = {
    // Common phases
    'unit_turn': 'Unit Turn',
    'racket_drop': 'Racket Drop',
    'contact': 'Contact',
    'follow_through': 'Follow Through',

    // Serve-specific phases
    'preparation': 'Preparation',
    'ball_toss': 'Ball Toss',
    'loading': 'Loading',
    'finish': 'Finish',

    // Setup phases (dink, drop, lob)
    'setup': 'Setup',
};

/**
 * Get display name for a phase (technical snake_case to coaching-friendly format)
 */
export function getPhaseDisplayName(technicalName: string): string {
    return PHASE_DISPLAY_NAMES[technicalName] ||
        // Fallback: convert snake_case to Title Case
        technicalName
            .split('_')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
}
