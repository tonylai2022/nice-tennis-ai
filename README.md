# Nice Tennis AI CRM

Nice Tennis AI CRM is a coach-first client relationship management system for tennis lessons. It helps coaches plan sessions, capture training evidence, review video, approve feedback, and share progress reports with players and parents.

The product supports the workflow behind a modern academy:

1. Prepare a lesson around the player's goals and current priorities.
2. Capture drills, coaching notes, and video during or after the lesson.
3. Use motion analysis to support the coach's evaluation.
4. Publish a coach-approved lesson report and next-step plan.
5. Build a longitudinal player profile that parents and academies can review.

MotionTutor does not replace a coach's professional judgement. AI analysis organizes evidence and drafts useful feedback; the coach remains responsible for the final evaluation and published guidance.

## What Exists Today

- **Tennis analysis** — supports serves, forehands, backhands, volleys, overheads, and more.
- **Video capture and review** — upload or record player video, compare it against pro references, and use split-screen or ghost-overlay playback.
- **On-device motion analysis** — YOLO, MediaPipe, and ONNX Runtime Web power pose and biomechanical analysis in the browser.
- **Live coaching** — real-time webcam feedback for selected tennis skills.
- **Coach-ready feedback** — phase-based observations, movement metrics, drill recommendations, and coach-profile calibration.
- **Branded reports** — generate professional PDF reports with coach or academy branding, annotated findings, and QR sharing.
- **Reference video library** — coaches and admins can manage reference clips through Supabase.
- **Mobile lesson capture** — responsive workflows for phone recordings, including HTTPS local-network testing.

## CRM Roadmap

The next product focus is the client and lesson-management layer that connects existing analysis to coaching operations. See [COACH_CRM_FEATURE_PLAN.md](COACH_CRM_FEATURE_PLAN.md) for the delivery plan, data model, permissions, and acceptance criteria.

| Capability | Outcome | Status |
|---|---|---|
| Player profiles | One record for goals, skill level, consent, history, and progress | Planned |
| Lesson plans and records | A repeatable prepare -> coach -> review -> publish workflow | Planned |
| Coach approval | AI-generated suggestions become visible externally only after coach review | Planned |
| Growth archive | Lesson reports, videos, assignments, and milestones in one timeline | Planned |
| Parent portal | Read-only access to approved reports, player cards, and training media | Planned |
| Academy dashboard | Coach workload, player follow-up, and progress visibility | Planned |

## Tech Stack

- React 18 + TypeScript + Vite
- Tailwind CSS
- MediaPipe Tasks Vision & ONNX Runtime Web (on-device inference)
- Supabase (currently optional — reference video library and cloud PDF storage; planned system of record for CRM data)

## Getting Started Locally

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or later
- npm (comes with Node)

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Copy the example env file and fill in your keys:

```bash
cp .env.example .env.local
```

Edit `.env.local` and set the values you need:

| Variable | Required | Description |
|---|---|---|
| `VITE_GEMINI_API_KEY` | Recommended | Google Gemini key for AI coaching feedback |
| `VITE_SUPABASE_URL` | Optional today | Supabase project URL for reference videos and CRM data |
| `VITE_SUPABASE_ANON_KEY` | Optional today | Supabase anon key |
| `VITE_ORT_WASM_BASE_URL` | Optional | Override ONNX Runtime WASM CDN URL |

> The analysis experience works without any keys: pose detection and comparison run fully in the browser. AI narrative feedback requires a Gemini key. CRM persistence and parent access will require Supabase configuration.

### 3. Start the dev server

```bash
npm run dev
```

Open [http://localhost:5173/login](http://localhost:5173/login) in your browser.

### 4. (Optional) Test on a mobile device

To access the app from your phone on the same Wi-Fi network, run:

```bash
npm run dev:mobile
```

This starts the server with HTTPS and exposes it on your local network. Accept the self-signed certificate warning on your phone, then navigate to the printed IP address.

## Route

The public root is intentionally blank. Sign in at `/login`; authenticated CRM pages live under `/dashboard`, with analysis and operations available at their dedicated sub-URLs.

## Project Structure

```
src/
├── App.tsx                   # Root app + routing
├── main.tsx                  # Vite entry point
├── index.css                 # Tailwind base styles
├── components/
│   ├── LiveCoachingTennis.tsx
│   ├── CameraRecorder.tsx
│   ├── ReferenceLibrary.tsx
│   ├── ReportDownload.tsx
│   └── ...
└── services/
    ├── MotionAnalysisRouter.ts   # Routes analysis to the right sport engine
    ├── motionAnalysis/           # Per-sport pose + phase analysis
    ├── VideoTutor.ts             # Feedback generation
    ├── ReferenceVideoService.ts  # Supabase reference video loading
    └── ReportGenerator.ts        # PDF report builder
```

## Build for Production

```bash
npm run build
```

Output is in `dist/`. Preview the production build locally with:

```bash
npm run preview
```

## Supabase Setup (Optional)

Supabase is used for two optional features:

- **Reference video library** — store pro reference clips that coaches or admins upload
- **PDF report sharing** — upload generated reports to the cloud so QR codes work on any device

It will become required when the CRM modules ship, providing authenticated accounts, player and lesson records, access policies, and secure media storage.

See [SUPABASE_SETUP.md](SUPABASE_SETUP.md) for step-by-step bucket and policy configuration.

## Video Capture Tips

- Keep clips to **30 seconds or less**
- Make sure the athlete is **fully in frame** throughout the stroke
- Film from the **side** for most stroke types
- Good lighting improves pose detection accuracy
