import React, { useRef, useEffect } from 'react';

export const PoseFallbackCanvas: React.FC<{
    landmarks: any[];
    visualCue?: { targetIndex: number; cueType: string; color?: string };
    color: 'rose' | 'emerald';
}> = ({ landmarks, visualCue, color }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !landmarks?.length) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const width = canvas.width;
        const height = canvas.height;

        ctx.fillStyle = '#0a0a0a';
        ctx.fillRect(0, 0, width, height);

        const connections = [
            [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
            [11, 23], [12, 24], [23, 24],
            [23, 25], [25, 27], [24, 26], [26, 28],
            [0, 1], [1, 2], [2, 3], [3, 7], [0, 4], [4, 5], [5, 6], [6, 8],
            [9, 10], [11, 12]
        ];

        ctx.strokeStyle = color === 'rose' ? '#f43f5e' : '#10b981';
        ctx.lineWidth = 2;

        for (const [a, b] of connections) {
            if (landmarks[a] && landmarks[b]) {
                ctx.beginPath();
                ctx.moveTo(landmarks[a].x * width, landmarks[a].y * height);
                ctx.lineTo(landmarks[b].x * width, landmarks[b].y * height);
                ctx.stroke();
            }
        }

        ctx.fillStyle = color === 'rose' ? '#fb7185' : '#34d399';
        for (let i = 0; i < Math.min(landmarks.length, 33); i++) {
            const lm = landmarks[i];
            if (lm && !(visualCue && i === visualCue.targetIndex)) {
                ctx.beginPath();
                ctx.arc(lm.x * width, lm.y * height, 4, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        if (visualCue && landmarks[visualCue.targetIndex]) {
            const target = landmarks[visualCue.targetIndex];
            ctx.strokeStyle = visualCue.color || (color === 'rose' ? '#ef4444' : '#22c55e');
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(target.x * width, target.y * height, 20, 0, Math.PI * 2);
            ctx.stroke();
        }
    }, [landmarks, visualCue, color]);

    return (
        <canvas
            ref={canvasRef}
            width={320}
            height={180}
            className="w-full h-auto bg-black"
            style={{ aspectRatio: '16/9' }}
        />
    );
};
