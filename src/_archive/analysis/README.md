# Analysis Pipeline (Scaffold)

This folder is a lightweight scaffold for the multi-stage pipeline described in the forehand-analysis prompt:

- **PoseDetector**: MediaPipe Pose Landmarker (heavy) or YOLO pose
- **RacketDetector**: SAM/U-Net segmentation -> racket axis
- **BallTracker**: TrackNetV2-style heatmap tracker
- **TemporalLocalizer**: TAL / Video Transformer (e.g., TimeSformer)
- **BiomechanicsEngine**: physics + constraints (lag-snap, sequencing)

The current app still uses the monolithic `MotionAnalysisService` in `src/services/MotionAnalysis.ts`.
These interfaces are here so we can progressively migrate without breaking UI contracts.
