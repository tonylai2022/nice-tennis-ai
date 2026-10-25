import React, { useState } from 'react';
import { LogoUpload } from './LogoUpload';

/**
 * ReportSettings - Manage report customization settings
 * 
 * Features:
 * - Custom logo upload for reports
 * - Report branding preferences
 * - Export/import settings
 */

interface ReportSettingsProps {
    onClose?: () => void;
}

export const ReportSettings: React.FC<ReportSettingsProps> = ({ onClose }) => {
    const [currentLogo, setCurrentLogo] = useState<string | null>(null);
    const [includeTimingData, setIncludeTimingData] = useState(true);
    const [includeFrameSnapshots, setIncludeFrameSnapshots] = useState(true);
    const [includeMovementMetrics, setIncludeMovementMetrics] = useState(true);
    const [showSuccessMessage, setShowSuccessMessage] = useState(false);

    const handleLogoChange = (logoDataUrl: string | null) => {
        setCurrentLogo(logoDataUrl);

        // Save other settings to localStorage
        localStorage.setItem('report-settings', JSON.stringify({
            includeTimingData,
            includeFrameSnapshots,
            includeMovementMetrics
        }));

        // Show success message
        setShowSuccessMessage(true);
        setTimeout(() => setShowSuccessMessage(false), 3000);
    };

    const handleSettingChange = (setting: string, value: boolean) => {
        const settings = {
            includeTimingData,
            includeFrameSnapshots,
            includeMovementMetrics,
            [setting]: value
        };

        // Update state
        switch (setting) {
            case 'includeTimingData':
                setIncludeTimingData(value);
                break;
            case 'includeFrameSnapshots':
                setIncludeFrameSnapshots(value);
                break;
            case 'includeMovementMetrics':
                setIncludeMovementMetrics(value);
                break;
        }

        // Save to localStorage
        localStorage.setItem('report-settings', JSON.stringify(settings));

        // Show success message
        setShowSuccessMessage(true);
        setTimeout(() => setShowSuccessMessage(false), 3000);
    };

    // Load settings from localStorage on mount
    React.useEffect(() => {
        const savedSettings = localStorage.getItem('report-settings');
        if (savedSettings) {
            try {
                const settings = JSON.parse(savedSettings);
                setIncludeTimingData(settings.includeTimingData ?? true);
                setIncludeFrameSnapshots(settings.includeFrameSnapshots ?? true);
                setIncludeMovementMetrics(settings.includeMovementMetrics ?? true);
            } catch (e) {
                console.error('Failed to load report settings:', e);
            }
        }
    }, []);

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6">
            <div className="max-w-4xl mx-auto">
                {/* Header */}
                <div className="mb-8">
                    <div className="flex items-center justify-between mb-2">
                        <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                            <span>⚙️</span>
                            Report Settings
                        </h1>
                        {onClose && (
                            <button
                                onClick={onClose}
                                className="text-slate-400 hover:text-white transition-colors"
                            >
                                ✕
                            </button>
                        )}
                    </div>
                    <p className="text-slate-400">
                        Customize your professional analysis reports
                    </p>
                </div>

                {/* Success Message */}
                {showSuccessMessage && (
                    <div className="mb-6 bg-emerald-500/20 border border-emerald-500/50 rounded-lg p-4 animate-fade-in">
                        <div className="flex items-center gap-2 text-emerald-400">
                            <span>✓</span>
                            <span className="font-medium">Settings saved successfully!</span>
                        </div>
                    </div>
                )}

                <div className="space-y-6">
                    {/* Logo Section */}
                    <div className="card p-6">
                        <LogoUpload
                            onLogoChange={handleLogoChange}
                            currentLogo={currentLogo}
                        />
                    </div>

                    {/* Report Content Settings */}
                    <div className="card p-6">
                        <h3 className="text-lg font-semibold text-white mb-4">
                            Report Content
                        </h3>
                        <p className="text-sm text-slate-400 mb-6">
                            Choose which advanced features to include in your reports
                        </p>

                        <div className="space-y-4">
                            {/* Timing Data Toggle */}
                            <div className="flex items-start justify-between p-4 bg-slate-800/50 rounded-lg border border-slate-700">
                                <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="text-xl">⏱️</span>
                                        <h4 className="font-medium text-white">Detailed Timing Analysis</h4>
                                    </div>
                                    <p className="text-sm text-slate-400">
                                        Include frame-by-frame timing data, phase durations, and velocity metrics
                                    </p>
                                </div>
                                <label className="relative inline-flex items-center cursor-pointer ml-4">
                                    <input
                                        type="checkbox"
                                        checked={includeTimingData}
                                        onChange={(e) => handleSettingChange('includeTimingData', e.target.checked)}
                                        className="sr-only peer"
                                    />
                                    <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-emerald-500/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                                </label>
                            </div>

                            {/* Frame Snapshots Toggle */}
                            <div className="flex items-start justify-between p-4 bg-slate-800/50 rounded-lg border border-slate-700">
                                <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="text-xl">📸</span>
                                        <h4 className="font-medium text-white">Frame-by-Frame Visual Comparison</h4>
                                    </div>
                                    <p className="text-sm text-slate-400">
                                        Include annotated frame snapshots with key points and corrections
                                    </p>
                                </div>
                                <label className="relative inline-flex items-center cursor-pointer ml-4">
                                    <input
                                        type="checkbox"
                                        checked={includeFrameSnapshots}
                                        onChange={(e) => handleSettingChange('includeFrameSnapshots', e.target.checked)}
                                        className="sr-only peer"
                                    />
                                    <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-emerald-500/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                                </label>
                            </div>

                            {/* Movement Metrics Toggle */}
                            <div className="flex items-start justify-between p-4 bg-slate-800/50 rounded-lg border border-slate-700">
                                <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="text-xl">📊</span>
                                        <h4 className="font-medium text-white">Movement Metrics & Biomechanics</h4>
                                    </div>
                                    <p className="text-sm text-slate-400">
                                        Include joint angles, body alignment, balance scores, and biomechanical data
                                    </p>
                                </div>
                                <label className="relative inline-flex items-center cursor-pointer ml-4">
                                    <input
                                        type="checkbox"
                                        checked={includeMovementMetrics}
                                        onChange={(e) => handleSettingChange('includeMovementMetrics', e.target.checked)}
                                        className="sr-only peer"
                                    />
                                    <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-emerald-500/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                                </label>
                            </div>
                        </div>
                    </div>

                    {/* Premium Features Info */}
                    <div className="card p-6 bg-gradient-to-br from-purple-500/10 to-blue-500/10 border-purple-500/30">
                        <div className="flex items-start gap-4">
                            <span className="text-4xl">🏆</span>
                            <div>
                                <h3 className="text-lg font-semibold text-white mb-2">
                                    Professional-Grade Reports
                                </h3>
                                <p className="text-sm text-slate-300 mb-4">
                                    These comprehensive reports include everything a professional coach or athlete needs:
                                </p>
                                <ul className="space-y-2 text-sm text-slate-400">
                                    <li className="flex items-start gap-2">
                                        <span className="text-purple-400">✓</span>
                                        <span>Biomechanical analysis with precise joint angle measurements</span>
                                    </li>
                                    <li className="flex items-start gap-2">
                                        <span className="text-purple-400">✓</span>
                                        <span>Frame-by-frame breakdown with visual annotations</span>
                                    </li>
                                    <li className="flex items-start gap-2">
                                        <span className="text-purple-400">✓</span>
                                        <span>Timing analysis for optimizing movement patterns</span>
                                    </li>
                                    <li className="flex items-start gap-2">
                                        <span className="text-purple-400">✓</span>
                                        <span>Custom branding with your academy or coaching logo</span>
                                    </li>
                                    <li className="flex items-start gap-2">
                                        <span className="text-purple-400">✓</span>
                                        <span>Professional PDF format suitable for player portfolios</span>
                                    </li>
                                </ul>
                                <div className="mt-4 p-3 bg-purple-500/10 rounded-lg border border-purple-500/30">
                                    <p className="text-xs text-purple-300">
                                        <strong>💼 Perfect for:</strong> Tennis academies, private coaches,
                                        performance centers, and serious players tracking their progress
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex gap-4 justify-end">
                        {onClose && (
                            <button
                                onClick={onClose}
                                className="btn btn-primary"
                            >
                                Save & Close
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ReportSettings;
