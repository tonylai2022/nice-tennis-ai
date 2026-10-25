import React, { useEffect, useState } from 'react';
import { ReportGeneratorService, ReportData } from '../services/ReportGenerator';

interface ReportDownloadProps {
  reportData: ReportData;
  onClose?: () => void;
}

export const ReportDownload: React.FC<ReportDownloadProps> = ({ reportData, onClose }) => {
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [shareableUrl, setShareableUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const generateReport = async () => {
      try {
        setLoading(true);
        setError(null);

        const result = await ReportGeneratorService.createReport(reportData);

        if (mounted) {
          setQrCode(result.qrCodeDataUrl);
          setPdfUrl(result.pdfUrl);
          setShareableUrl(result.shareableUrl);
          setFileName(result.fileName);
        }
      } catch (err) {
        console.error('Report generation failed:', err);
        if (mounted) {
          setError('Failed to generate report. Please try again.');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    generateReport();

    return () => {
      mounted = false;
      // Clean up blob URL when component unmounts
      if (pdfUrl) {
        ReportGeneratorService.revokePDFUrl(pdfUrl);
      }
    };
  }, [reportData]);

  const handleDownload = () => {
    if (pdfUrl && fileName) {
      ReportGeneratorService.downloadPDF(pdfUrl, fileName);
    }
  };

  if (loading) {
    return (
      <div className="card p-8 text-center">
        <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-emerald-500 border-r-transparent"></div>
        <p className="mt-4 text-slate-400">Generating your report...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card p-8 text-center">
        <div className="text-red-500 text-xl mb-4">⚠️</div>
        <p className="text-red-400">{error}</p>
        {onClose && (
          <button className="btn btn-secondary mt-4" onClick={onClose}>
            Close
          </button>
        )}
      </div>
    );
  }

  const sportEmoji = reportData.sport === 'tennis' ? '🎾' : '🏓';

  return (
    <div className="card">
      <div className="bg-gradient-to-r from-emerald-500/20 to-blue-500/20 p-6 border-b border-slate-700/50">
        <div className="flex items-center gap-3">
          <span className="text-4xl">{sportEmoji}</span>
          <div>
            <h2 className="text-2xl font-bold text-white">Analysis Report Ready!</h2>
            <p className="text-slate-300 text-sm mt-1">
              Your {reportData.sport} {reportData.strokeType} analysis is complete
            </p>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* Download Section */}
        <div>
          <h3 className="text-lg font-semibold text-white mb-3">📥 Download Options</h3>
          <div className="grid gap-4 md:grid-cols-2">
            {/* Direct Download */}
            <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
              <div className="text-center">
                <div className="text-3xl mb-2">💾</div>
                <p className="text-sm text-slate-400 mb-3">Direct Download</p>
                <button
                  onClick={handleDownload}
                  className="btn btn-primary w-full"
                >
                  Download PDF Report
                </button>
                <p className="text-xs text-slate-500 mt-2">{fileName}</p>
              </div>
            </div>

            {/* QR Code Download */}
            <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
              <div className="text-center">
                <div className="text-3xl mb-2">📱</div>
                <p className="text-sm text-slate-400 mb-3">Scan to Download</p>
                {qrCode ? (
                  <>
                    <div className="bg-white p-3 rounded-lg inline-block">
                      <img
                        src={qrCode}
                        alt="QR Code for report download"
                        className="w-32 h-32"
                      />
                    </div>
                    <p className="text-xs text-slate-500 mt-3">
                      {shareableUrl
                        ? 'Scan with your phone camera'
                        : '⚠️ Cloud storage not configured'}
                    </p>
                    {!shareableUrl && (
                      <p className="text-xs text-amber-400 mt-2">
                        QR code uses local URL - works only on same device
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-slate-500">Generating QR code...</p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Report Preview Info */}
        <div className="bg-emerald-500/10 rounded-xl p-4 border border-emerald-500/30">
          <h4 className="text-sm font-semibold text-emerald-400 mb-2">📊 Professional Report Includes</h4>
          <div className="grid gap-3 md:grid-cols-2 text-sm text-slate-300">
            <div>
              <p className="font-semibold text-emerald-300 mb-2">Core Analysis:</p>
              <ul className="space-y-1">
                <li className="flex items-start gap-2">
                  <span className="text-emerald-400">•</span>
                  <span>Overall performance score ({reportData.feedback.overallScore}/100)</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-emerald-400">•</span>
                  <span>Detailed phase-by-phase breakdown</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-emerald-400">•</span>
                  <span>Visual scoring bars for each phase</span>
                </li>
              </ul>
            </div>
            <div>
              <p className="font-semibold text-emerald-300 mb-2">Advanced Metrics:</p>
              <ul className="space-y-1">
                <li className="flex items-start gap-2">
                  <span className="text-emerald-400">⏱️</span>
                  <span>Timing analysis with frame numbers</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-emerald-400">📸</span>
                  <span>Frame-by-frame visual comparison</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-emerald-400">📊</span>
                  <span>Movement metrics & joint angles</span>
                </li>
              </ul>
            </div>
            <div className="md:col-span-2">
              <p className="font-semibold text-emerald-300 mb-2">Coaching Insights:</p>
              <ul className="space-y-1">
                <li className="flex items-start gap-2">
                  <span className="text-emerald-400">💡</span>
                  <span>Quick coaching tips & drills</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-emerald-400">✨</span>
                  <span>Personalized encouragement</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-emerald-400">🎯</span>
                  <span>Key points & corrections for each frame</span>
                </li>
              </ul>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-emerald-500/30">
            <p className="text-xs text-slate-400 flex items-center gap-2">
              <span className="text-emerald-400">✓</span>
              Professional PDF format - Perfect for coaches, trainers & academies
            </p>
          </div>
        </div>

        {/* Sharing Tip */}
        <div className="bg-blue-500/10 rounded-xl p-4 border border-blue-500/30">
          <div className="flex items-start gap-3">
            <span className="text-2xl">💡</span>
            <div>
              <h4 className="text-sm font-semibold text-blue-400 mb-1">Pro Tip</h4>
              <p className="text-xs text-slate-400">
                Share this report with your coach or training partner! The QR code makes it easy
                to transfer to mobile devices for review during practice sessions.
              </p>
            </div>
          </div>
        </div>

        {/* Close Button */}
        {onClose && (
          <div className="text-center pt-4 border-t border-slate-700/50">
            <button
              onClick={onClose}
              className="btn btn-secondary"
            >
              Close & Continue
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ReportDownload;
