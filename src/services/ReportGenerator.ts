import jsPDF from 'jspdf';
import QRCode from 'qrcode';
import type { ServeFeedback, RichTip } from './VideoTutor';
import { supabase } from '../lib/supabase';

/**
 * ReportGenerator - Generate PDF analysis reports with QR code download
 * 
 * Features:
 * - Professional PDF report with analysis results
 * - QR code for easy mobile download
 * - Shareable report URL via Supabase Storage
 * - Tennis branding
 */

export interface TimingData {
  phaseName: string;
  startFrame: number;
  endFrame: number;
  durationMs: number;
  velocityMetrics?: {
    peakVelocity?: number;
    averageVelocity?: number;
    accelerationPhases?: string[];
  };
}

export interface FrameSnapshot {
  frameNumber: number;
  timestamp: number;
  imageDataUrl: string;
  referenceImageDataUrl?: string;
  description: string;
  annotations?: {
    keyPoints?: string[];
    corrections?: string[];
    issueIndex?: number;
    phaseName?: string;
    score?: number;
    visualIssue?: string;
  };
}

export interface MovementMetrics {
  averageSpeed: number;
  peakSpeed: number;
  consistency: number;
  smoothness: number;
}

export interface ReportData {
  sport: 'tennis';
  strokeType: string;
  analysisDate: Date;
  feedback: ServeFeedback;
  userName?: string;
  videoMetadata?: {
    userVideoName?: string;
    referenceVideoName?: string;
  };
  timingData?: TimingData[];
  frameSnapshots?: FrameSnapshot[];
  movementMetrics?: MovementMetrics;
  customLogo?: string; // Base64 or URL
}

export class ReportGeneratorService {
  static async generatePDF(data: ReportData): Promise<Blob> {
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 20;
    const contentWidth = pageWidth - (margin * 2);
    let yPos = margin;

    // Helper to add new page if needed
    const checkPageBreak = (neededSpace: number = 20) => {
      if (yPos + neededSpace > pageHeight - margin) {
        doc.addPage();
        yPos = margin;
      }
    };

    // Add header with optional custom logo
    if (data.customLogo) {
      try {
        doc.addImage(data.customLogo, 'PNG', margin, yPos, 30, 10);
        yPos += 15;
      } catch (logoError) {
        console.warn('Failed to add custom logo:', logoError);
      }
    } else {
      doc.setFontSize(18);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(16, 185, 129);
      doc.text('Motion Tutor', margin, yPos + 5);
      yPos += 15;
    }

    // Title
    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(60, 60, 60);
    const title = `${data.sport.toUpperCase()} ${data.strokeType.toUpperCase()} ANALYSIS`;
    doc.text(title, margin, yPos + 10);
    yPos += 15;

    // Report metadata
    doc.setFontSize(10);
    doc.setTextColor(120, 120, 120);
    doc.text(`Generated: ${data.analysisDate.toLocaleDateString()}`, margin, yPos);
    if (data.userName) {
      doc.text(`Player: ${data.userName}`, pageWidth - margin - 50, yPos, { align: 'right' });
    }
    yPos += 15;

    // Line separator
    doc.setDrawColor(200, 200, 200);
    doc.line(margin, yPos, pageWidth - margin, yPos);
    yPos += 10;

    // Overall Score (large section)
    doc.setFillColor(248, 250, 252);
    const scoreBoxHeight = 25;
    doc.roundedRect(margin, yPos, contentWidth, scoreBoxHeight, 3, 3, 'F');

    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(60, 60, 60);
    doc.text('OVERALL PERFORMANCE', margin + 10, yPos + 8);

    const scoreColor: [number, number, number] = data.feedback.overallScore >= 80 ? [16, 185, 129] : data.feedback.overallScore >= 60 ? [251, 191, 36] : [239, 68, 68];
    doc.setFontSize(24);
    doc.setTextColor(scoreColor[0], scoreColor[1], scoreColor[2]);
    doc.text(`${data.feedback.overallScore}%`, pageWidth - margin - 30, yPos + 15);

    yPos += scoreBoxHeight + 15;

    // Quick insights
    if (data.feedback.phases && Object.keys(data.feedback.phases).length > 0) {
      const phases = Object.entries(data.feedback.phases);
      const insights: string[] = [];

      const strongPhase = phases.reduce((max, [name, details]) => {
        return details.score > max[1].score ? [name, details] : max;
      });
      const weakPhase = phases.reduce((min, [name, details]) => {
        return details.score < min[1].score ? [name, details] : min;
      });

      insights.push(`💪 Strongest: ${strongPhase[0].replace(/_/g, ' ')} (${strongPhase[1].score}/100)`);
      insights.push(`⚡ Focus on ${weakPhase[0].replace(/_/g, ' ')} (${weakPhase[1].score}/100)`);

      if (insights.length > 0) {
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(60, 60, 60);
        insights.forEach((insight) => {
          doc.text(insight, margin + 5, yPos);
          yPos += 5;
        });
        yPos += 10;
      }
    }

    return doc.output('blob');
  }

  static async generateQRCode(pdfUrl: string): Promise<string> {
    try {
      const qrDataUrl = await QRCode.toDataURL(pdfUrl, {
        width: 300,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        },
        errorCorrectionLevel: 'M'
      });
      return qrDataUrl;
    } catch (error) {
      console.error('QR Code generation failed:', error);
      throw error;
    }
  }

  static async uploadPDF(pdfBlob: Blob, fileName: string): Promise<string | null> {
    if (!supabase) {
      console.warn('Supabase not configured, using local blob URL');
      return null;
    }

    try {
      const { data, error } = await supabase.storage
        .from('reports')
        .upload(fileName, pdfBlob, {
          cacheControl: '3600',
          upsert: true,
          contentType: 'application/pdf'
        });

      if (error) {
        console.error('Supabase upload error:', error);
        return null;
      }

      const { data: urlData } = supabase.storage
        .from('reports')
        .getPublicUrl(data.path);

      return urlData.publicUrl;
    } catch (error) {
      console.error('Failed to upload PDF to Supabase:', error);
      return null;
    }
  }

  static async createReport(data: ReportData): Promise<{
    pdfBlob: Blob;
    pdfUrl: string;
    qrCodeDataUrl: string;
    fileName: string;
    shareableUrl: string | null;
  }> {
    const pdfBlob = await this.generatePDF(data);
    const fileName = `motion-analysis-${data.sport}-${data.strokeType}-${Date.now()}.pdf`;

    const pdfUrl = URL.createObjectURL(pdfBlob);
    const shareableUrl = await this.uploadPDF(pdfBlob, fileName);
    const qrCodeDataUrl = await this.generateQRCode(shareableUrl || pdfUrl);

    return {
      pdfBlob,
      pdfUrl,
      qrCodeDataUrl,
      fileName,
      shareableUrl
    };
  }

  static downloadPDF(pdfUrl: string, fileName: string): void {
    const link = document.createElement('a');
    link.href = pdfUrl;
    link.download = fileName;
    link.click();
  }

  static revokePDFUrl(pdfUrl: string): void {
    if (pdfUrl.startsWith('blob:')) {
      URL.revokeObjectURL(pdfUrl);
    }
  }

  /**
   * Generate a standalone "Shot Quality Analysis" PDF from richTips + phases.
   * Returns a blob URL + filename ready for download.
   */
  static async generateShotAnalysisPDF(
    feedback: ServeFeedback,
    motionType: string,
    sport: 'tennis'
  ): Promise<{ pdfUrl: string; fileName: string }> {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const PW = doc.internal.pageSize.getWidth();   // 210
    const PH = doc.internal.pageSize.getHeight();  // 297
    const M = 15;
    const CW = PW - M * 2; // 180
    let y = 0;

    const checkBreak = (needed: number) => {
      if (y + needed > PH - M - 8) { doc.addPage(); y = M; }
    };

    const scoreRGB = (s: number): [number, number, number] =>
      s >= 85 ? [16, 185, 129] : s >= 70 ? [245, 158, 11] : [239, 68, 68];

    // ── Green header bar ────────────────────────────────────
    doc.setFillColor(16, 185, 129);
    doc.rect(0, 0, PW, 14, 'F');
    doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(255, 255, 255);
    doc.text('MotionTutor', M, 9);
    doc.setFontSize(8); doc.setFont('helvetica', 'normal');
    doc.text('Tennis', PW - M, 9, { align: 'right' });
    y = 20;

    // ── Title ────────────────────────────────────────────────
    doc.setFontSize(17); doc.setFont('helvetica', 'bold'); doc.setTextColor(30, 30, 50);
    doc.text(`${motionType.replace(/_/g, ' ').toUpperCase()} ANALYSIS`, PW / 2, y, { align: 'center' });
    y += 6;
    doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(130, 130, 150);
    doc.text(`Shot Quality Analysis  ·  ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`, PW / 2, y, { align: 'center' });
    y += 7;

    // ── Divider ──────────────────────────────────────────────
    doc.setDrawColor(225, 225, 235); doc.setLineWidth(0.3);
    doc.line(M, y, PW - M, y); y += 7;

    // ── Overall score card ───────────────────────────────────
    const sc = feedback.overallScore;
    const sRGB = scoreRGB(sc);
    doc.setFillColor(247, 248, 252);
    doc.roundedRect(M, y, CW, 22, 2, 2, 'F');
    doc.setFontSize(7); doc.setFont('helvetica', 'bold'); doc.setTextColor(130, 130, 150);
    doc.text('OVERALL PERFORMANCE', M + 6, y + 6);
    doc.setFontSize(26); doc.setFont('helvetica', 'bold'); doc.setTextColor(sRGB[0], sRGB[1], sRGB[2]);
    doc.text(`${sc}`, M + 6, y + 18);
    doc.setFontSize(10); doc.text('/ 100', M + 23, y + 18);
    if (feedback.encouragement) {
      const lines = doc.splitTextToSize(feedback.encouragement, CW - 55);
      doc.setFontSize(7.5); doc.setFont('helvetica', 'italic'); doc.setTextColor(80, 80, 100);
      doc.text(lines.slice(0, 3), M + 54, y + 8);
    }
    y += 30;

    // ── FIFA-style rating section ─────────────────────────────
    const richTips = feedback.richTips as RichTip[] | undefined;
    if (richTips && richTips.length > 0) {
      checkBreak(70);

      doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(80, 80, 100);
      doc.text('SHOT QUALITY RATING', M, y); y += 5;

      // Radar chart
      const RS = 54; // radar box size mm
      const cx = M + RS / 2 + 1;
      const cy = y + RS / 2;
      const r = RS * 0.37;
      const n = richTips.length;
      const angles = richTips.map((_, i) => (i * 2 * Math.PI / n) - Math.PI / 2);

      const toRel = (pts: number[][]): [number, number][] =>
        pts.slice(1).map((p, i) => [p[0] - pts[i][0], p[1] - pts[i][1]] as [number, number]);

      // Grid rings
      for (const lv of [0.25, 0.5, 0.75, 1.0]) {
        const gp = angles.map(a => [cx + r * lv * Math.cos(a), cy + r * lv * Math.sin(a)]);
        doc.setDrawColor(210, 215, 230); doc.setLineWidth(0.25);
        doc.lines(toRel(gp), gp[0][0], gp[0][1], [1, 1], 'D', true);
      }
      // Axes
      doc.setDrawColor(210, 215, 230); doc.setLineWidth(0.25);
      angles.forEach(a => doc.line(cx, cy, cx + r * Math.cos(a), cy + r * Math.sin(a)));

      // Data polygon
      const dp = richTips.map((t, i) => [
        cx + r * (t.score / 100) * Math.cos(angles[i]),
        cy + r * (t.score / 100) * Math.sin(angles[i]),
      ]);
      doc.setFillColor(175, 178, 235);
      doc.setDrawColor(99, 102, 241); doc.setLineWidth(0.8);
      doc.lines(toRel(dp), dp[0][0], dp[0][1], [1, 1], 'FD', true);

      // Vertex dots
      richTips.forEach((t, i) => {
        const [dx, dy] = dp[i];
        const c = scoreRGB(t.score);
        doc.setFillColor(c[0], c[1], c[2]);
        doc.circle(dx, dy, 1.2, 'F');
      });

      // Axis labels
      angles.forEach((a, i) => {
        const lx = cx + r * 1.3 * Math.cos(a);
        const ly = cy + r * 1.3 * Math.sin(a);
        doc.setFontSize(6.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(110, 110, 130);
        doc.text(richTips[i].abbr, lx, ly + 1.5, { align: 'center' });
      });

      // FIFA attribute boxes (right of radar)
      const gLeft = M + RS + 7;
      const gW = CW - RS - 7;
      const cols = 3;
      const boxW = gW / cols - 2;
      const boxH = 16;
      const gap = 2.5;
      richTips.forEach((t, i) => {
        const col = i % cols, row = Math.floor(i / cols);
        const bx = gLeft + col * (boxW + gap);
        const by = y + row * (boxH + gap);
        const c = scoreRGB(t.score);
        doc.setFillColor(244, 245, 250);
        doc.roundedRect(bx, by, boxW, boxH, 1.5, 1.5, 'F');
        doc.setFontSize(13); doc.setFont('helvetica', 'bold'); doc.setTextColor(c[0], c[1], c[2]);
        doc.text(`${t.score}`, bx + 3.5, by + 9.5);
        doc.setFontSize(6); doc.setFont('helvetica', 'bold'); doc.setTextColor(110, 110, 130);
        doc.text(t.abbr, bx + 3.5, by + 13.5);
        // Mini bar
        const bW = boxW - 7;
        doc.setFillColor(215, 215, 228); doc.rect(bx + 3.5, by + 14.8, bW, 1.2, 'F');
        doc.setFillColor(c[0], c[1], c[2]); doc.rect(bx + 3.5, by + 14.8, bW * (t.score / 100), 1.2, 'F');
      });

      y += Math.max(RS, Math.ceil(richTips.length / cols) * (boxH + gap)) + 7;

      // Attribute coaching notes
      checkBreak(12);
      doc.setDrawColor(225, 225, 235); doc.setLineWidth(0.3);
      doc.line(M, y, PW - M, y); y += 6;
      doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(80, 80, 100);
      doc.text('ATTRIBUTE COACHING NOTES', M, y); y += 6;

      richTips.forEach((t) => {
        checkBreak(22);
        const c = scoreRGB(t.score);
        // Label + score
        doc.setFontSize(8.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(30, 30, 50);
        doc.text(t.label, M, y);
        doc.setTextColor(c[0], c[1], c[2]);
        doc.text(`${t.score}%`, PW - M, y, { align: 'right' });
        // Bar
        const bW2 = CW * 0.5;
        const bX2 = M + 35;
        doc.setFillColor(215, 215, 228); doc.rect(bX2, y - 2.5, bW2, 2.2, 'F');
        doc.setFillColor(c[0], c[1], c[2]); doc.rect(bX2, y - 2.5, bW2 * (t.score / 100), 2.2, 'F');
        y += 5;
        // Detail text
        const dl = doc.splitTextToSize(t.detail, CW);
        doc.setFontSize(7.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(90, 90, 110);
        doc.text(dl, M, y);
        y += dl.length * 3.8 + 4;
      });
    }

    // ── Phase breakdown ──────────────────────────────────────
    if (Object.keys(feedback.phases).length > 0) {
      checkBreak(14);
      doc.setDrawColor(225, 225, 235); doc.setLineWidth(0.3);
      doc.line(M, y, PW - M, y); y += 6;
      doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(80, 80, 100);
      doc.text('PHASE BREAKDOWN', M, y); y += 6;

      Object.entries(feedback.phases).forEach(([name, data]) => {
        checkBreak(16);
        const ph = data as { score: number; feedback: string };
        const c = scoreRGB(ph.score);
        const displayName = name.replace(/_/g, ' ').replace(/\b\w/g, (ch: string) => ch.toUpperCase());
        doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(30, 30, 50);
        doc.text(displayName, M, y);
        doc.setTextColor(c[0], c[1], c[2]); doc.text(`${ph.score}%`, PW - M, y, { align: 'right' });
        const bW3 = CW * 0.5;
        doc.setFillColor(215, 215, 228); doc.rect(M + 38, y - 2, bW3, 2, 'F');
        doc.setFillColor(c[0], c[1], c[2]); doc.rect(M + 38, y - 2, bW3 * (ph.score / 100), 2, 'F');
        y += 5;
        const clean = ph.feedback.replace(/•\s*/g, '').replace(/\n/g, ' ').trim();
        if (clean) {
          const fl = doc.splitTextToSize(clean, CW);
          doc.setFontSize(7); doc.setFont('helvetica', 'normal'); doc.setTextColor(105, 105, 125);
          doc.text(fl.slice(0, 3), M, y);
          y += Math.min(fl.length, 3) * 3.5 + 3;
        }
      });
    }

    // ── Footer on every page ─────────────────────────────────
    const total = doc.getNumberOfPages();
    for (let i = 1; i <= total; i++) {
      doc.setPage(i);
      doc.setFontSize(7); doc.setFont('helvetica', 'normal'); doc.setTextColor(165, 165, 185);
      doc.text('Generated by MotionTutor · motiontutor.app', PW / 2, PH - 5, { align: 'center' });
      if (total > 1) doc.text(`${i} / ${total}`, PW - M, PH - 5, { align: 'right' });
    }

    const blob = doc.output('blob');
    const pdfUrl = URL.createObjectURL(blob);
    const fileName = `motiontutor-${sport}-${motionType.replace(/_/g, '-')}-shot-analysis.pdf`;
    return { pdfUrl, fileName };
  }
}