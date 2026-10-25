# Nice Tennis AI CRM

Nice Tennis AI CRM is a coach-first workspace for managing tennis students, lessons, and coaching feedback. This MVP focuses on the CRM workflow and its media review tools; the previous standalone analysis, live-coaching, calibration, and admin-library screens are archived.

## MVP Features

- **Coach and student workspace** — schedules, student profiles, lesson records, homework, assessments, and growth portfolios.
- **Feedback authoring** — save coach notes and publish approved feedback with supporting media.
- **Media workbench** — attach or record video and photos, review movement, annotate frames, and use pose-analysis suggestions.
- **Mobile support** — responsive CRM pages, camera recording, and an install prompt for supported devices.

AI suggestions are supporting evidence, not a substitute for a coach's professional judgement. Coaches remain responsible for reviewing and approving feedback before sharing it.

## Tech Stack

- React 18 + TypeScript + Vite
- Tailwind CSS
- MediaPipe Tasks Vision (on-device pose analysis)
- Supabase (authentication, CRM data, and media storage)

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
| `VITE_GEMINI_API_KEY` | Optional | Google Gemini key for AI coaching feedback |
| `VITE_SUPABASE_URL` | Required for CRM | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Required for CRM | Supabase anon key |

> The CRM requires Supabase configuration. AI feedback features also need a Gemini key.

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

Sign in at `/` or `/login`. Authenticated CRM pages live under `/dashboard` and its sub-routes.

## Project Structure

```
src/
├── App.tsx                   # Root app + routing
├── main.tsx                  # Vite entry point
├── index.css                 # Tailwind base styles
├── components/
│   ├── AppHeader.tsx
│   ├── CoachCRMHome.tsx
│   ├── CoachMediaWorkbench.tsx
│   ├── CameraRecorder.tsx
│   ├── NotFoundPage.tsx
│   ├── PwaInstallPrompt.tsx
│   └── ...                   # Active CRM UI dependencies
└── services/
    ├── CoachCRMService.ts     # Authentication and CRM data
    └── pose/                  # On-device pose support
```

Retired features are kept under `src/_archive` and are excluded from the MVP TypeScript entry-point check.

## Build for Production

```bash
npm run build
```

Output is in `dist/`. Preview the production build locally with:

```bash
npm run preview
```

## Supabase Setup (Optional)

Supabase provides authentication and CRM persistence for the MVP.

See [SUPABASE_SETUP.md](SUPABASE_SETUP.md) for step-by-step bucket and policy configuration.

## Video Capture Tips

- Keep clips to **30 seconds or less**
- Make sure the athlete is **fully in frame** throughout the stroke
- Film from the **side** for most stroke types
- Good lighting improves pose detection accuracy
