import React, { useState, useRef } from 'react';

interface LogoUploadProps {
    onLogoChange: (logoDataUrl: string | null) => void;
    currentLogo?: string | null;
}

/**
 * LogoUpload - Component for uploading and managing custom report logos
 * 
 * Features:
 * - Upload logo images (PNG, JPG, SVG)
 * - Preview current logo
 * - Remove/clear logo
 * - Automatic image optimization
 * - Stores in localStorage for persistence
 */
export const LogoUpload: React.FC<LogoUploadProps> = ({ onLogoChange, currentLogo }) => {
    const [logoPreview, setLogoPreview] = useState<string | null>(currentLogo || null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const LOGO_STORAGE_KEY = 'motion-tutor-report-logo';
    const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB
    const TARGET_WIDTH = 200; // Target width for logo optimization

    const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setError(null);
        setIsProcessing(true);

        try {
            // Validate file type
            if (!file.type.startsWith('image/')) {
                throw new Error('Please select an image file (PNG, JPG, or SVG)');
            }

            // Validate file size
            if (file.size > MAX_FILE_SIZE) {
                throw new Error('Image must be smaller than 2MB');
            }

            // Read file as data URL
            const reader = new FileReader();

            reader.onload = async (e) => {
                try {
                    const dataUrl = e.target?.result as string;

                    // Optimize image
                    const optimizedDataUrl = await optimizeImage(dataUrl, file.type);

                    // Update preview
                    setLogoPreview(optimizedDataUrl);

                    // Store in localStorage
                    localStorage.setItem(LOGO_STORAGE_KEY, optimizedDataUrl);

                    // Notify parent
                    onLogoChange(optimizedDataUrl);

                    setIsProcessing(false);
                } catch (err) {
                    setError(err instanceof Error ? err.message : 'Failed to process image');
                    setIsProcessing(false);
                }
            };

            reader.onerror = () => {
                setError('Failed to read file');
                setIsProcessing(false);
            };

            reader.readAsDataURL(file);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to upload logo');
            setIsProcessing(false);
        }
    };

    const optimizeImage = (dataUrl: string, mimeType: string): Promise<string> => {
        return new Promise((resolve, reject) => {
            // Skip SVG optimization
            if (mimeType === 'image/svg+xml') {
                resolve(dataUrl);
                return;
            }

            const img = new Image();

            img.onload = () => {
                try {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');

                    if (!ctx) {
                        reject(new Error('Failed to get canvas context'));
                        return;
                    }

                    // Calculate new dimensions maintaining aspect ratio
                    const aspectRatio = img.height / img.width;
                    const newWidth = Math.min(img.width, TARGET_WIDTH);
                    const newHeight = newWidth * aspectRatio;

                    canvas.width = newWidth;
                    canvas.height = newHeight;

                    // Draw optimized image
                    ctx.drawImage(img, 0, 0, newWidth, newHeight);

                    // Convert to data URL with compression
                    const optimizedDataUrl = canvas.toDataURL('image/png', 0.9);
                    resolve(optimizedDataUrl);
                } catch (err) {
                    reject(err);
                }
            };

            img.onerror = () => {
                reject(new Error('Failed to load image'));
            };

            img.src = dataUrl;
        });
    };

    const handleRemoveLogo = () => {
        setLogoPreview(null);
        localStorage.removeItem(LOGO_STORAGE_KEY);
        onLogoChange(null);

        // Reset file input
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const handleBrowseClick = () => {
        fileInputRef.current?.click();
    };

    // Load logo from localStorage on mount
    React.useEffect(() => {
        const savedLogo = localStorage.getItem(LOGO_STORAGE_KEY);
        if (savedLogo && !logoPreview) {
            setLogoPreview(savedLogo);
            onLogoChange(savedLogo);
        }
    }, []);

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-lg font-semibold text-white">Report Logo</h3>
                    <p className="text-sm text-slate-400 mt-1">
                        Upload a custom logo to appear on your analysis reports
                    </p>
                </div>
            </div>

            {/* Logo Preview */}
            {logoPreview && (
                <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6">
                    <div className="flex items-center justify-between mb-3">
                        <span className="text-sm font-medium text-slate-300">Current Logo</span>
                        <button
                            onClick={handleRemoveLogo}
                            className="text-sm text-red-400 hover:text-red-300 transition-colors"
                            disabled={isProcessing}
                        >
                            Remove
                        </button>
                    </div>
                    <div className="flex items-center justify-center bg-white/5 rounded-lg p-4 min-h-[120px]">
                        <img
                            src={logoPreview}
                            alt="Logo preview"
                            className="max-h-[100px] max-w-full object-contain"
                        />
                    </div>
                </div>
            )}

            {/* Upload Button */}
            <div>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/jpg,image/svg+xml"
                    onChange={handleFileSelect}
                    className="hidden"
                    disabled={isProcessing}
                />

                <button
                    onClick={handleBrowseClick}
                    disabled={isProcessing}
                    className="btn btn-secondary w-full sm:w-auto"
                >
                    {isProcessing ? (
                        <>
                            <div className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-solid border-current border-r-transparent mr-2" />
                            Processing...
                        </>
                    ) : logoPreview ? (
                        '📷 Change Logo'
                    ) : (
                        '📷 Upload Logo'
                    )}
                </button>

                <p className="text-xs text-slate-500 mt-2">
                    Recommended: PNG or JPG, max 2MB, transparent background preferred
                </p>
            </div>

            {/* Error Message */}
            {error && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                    <p className="text-sm text-red-400">{error}</p>
                </div>
            )}

            {/* Info Box */}
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
                <div className="flex gap-2">
                    <span className="text-blue-400 flex-shrink-0">ℹ️</span>
                    <div className="text-sm text-blue-300">
                        <p className="font-medium mb-1">Logo Tips:</p>
                        <ul className="space-y-1 text-xs text-blue-200">
                            <li>• Use a square or horizontal logo for best results</li>
                            <li>• Transparent background works best on colored headers</li>
                            <li>• Logo will appear at the top of all generated reports</li>
                            <li>• Your logo is saved locally and persists across sessions</li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default LogoUpload;
