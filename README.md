# Dhruv Tales (ध्रुव टेल्स)

A nocturnal, editorial **bilingual (Hindi & English) serialized audio, video, and interactive storytelling web application** built with React 19, TypeScript, Tailwind CSS v4, Vite, and Firebase (Authentication + Cloud Firestore).

> **Important Boundaries**
> - **Zero AI APIs:** Dhruv Tales contains no LLM or AI API calls anywhere in `src/` or `api/`.
> - **Interchangeable Media Storage:** All media resolution and uploads pass through `MediaProvider` (`DriveMediaProvider` for low-traffic testing via `/api/media/*`, with `DemoMediaProvider` fallback — **not** production DRM).
> - **Demo Coin Payments Only:** Coin package purchases run through `MockPaymentProvider` (`isSimulated: true`) with no real money until a production gateway (e.g., Razorpay) plugs in.
> - **Browser-Based `deviceId` Limits:** Single-device enforcement uses a browser-local `deviceId` stored in `localStorage`. See the **Single-Device Enforcement** section below for an honest list of what it can and cannot detect.

---

## Architecture Overview

- **Frontend:** React 19 + TypeScript + React Router v7 with route-level code splitting (`React.lazy` + `Suspense`) and memoized catalog cards/artwork.
- **Styling & Accessibility:** Tailwind CSS v4, Fraunces + Plus Jakarta Sans + Noto Sans Devanagari typography, WCAG AA dark palette (`#0B0B0E` / `#141418` / `#E5A93C` / `#F5F3EE`), global `:focus-visible` rings, skip link, `prefers-reduced-motion` support, and a full semantic List View alternative for the Interactive Story Constellation.
- **Shared Player Engine:** Single `AudioPlayerContext` coordinating the mini-player, expanded full player, responsive HTML5 `VideoPlayer`, seamless Audio ⇄ Video switching (preserving exact timestamp, speed, and play/pause state), Media Session API controls, debounced Firestore resume sync (~10s + on pause/exit), and interactive choice-point pausing.
- **Data & Auth:** Firebase Authentication + Cloud Firestore across 14 collections, enforced by `firestore.rules` (default deny, RBAC, creator ownership, immutable fields, append-only audit logs) and compound queries backed by `firestore.indexes.json`.
- **PWA & Capacitor Ready:** Configured with `vite-plugin-pwa` (Workbox precaching, SPA `navigateFallback`, icons, install prompt) and safe-area inset CSS helpers for mobile WebView wrapping.

---

## Folder Structure

```text
├── public/
│   ├── demo-media/               # Bundled sample audio/video files for DemoMediaProvider
│   ├── icon.svg                  # Source Pole Star vector icon
│   ├── pwa-192x192.png           # PWA install icon (192×192)
│   ├── pwa-512x512.png           # PWA install icon (512×512)
│   ├── pwa-maskable-512x512.png  # Adaptive maskable icon
│   └── apple-touch-icon.png      # iOS home-screen icon
├── src/
│   ├── assets/                   # Bundled editorial story cover & hero artwork
│   ├── components/               # AppShell, AudioPlayerBar, VideoPlayer, StoryConstellation,
│   │                             # StoryArtwork, StoryCard, StoryCarousel, RoleGuard, ErrorBoundary
│   ├── hooks/                    # useAuthAndActivity, useAudioPlayer, useLanguage, usePwaInstall
│   ├── i18n/                     # en.json, hi.json, index.ts (single-line extensible registry)
│   ├── pages/                    # Lazy-loaded routes: Home, Search, StoryDetails, Library,
│   │                             # Profile, Subscription, CreatorStudio, AdminDashboard
│   ├── services/
│   │   ├── access/               # Pure episode access & daily unlock quota rules + unit tests
│   │   ├── firebase/             # client, authService, catalogService, activityService,
│   │   │                         # studioService, adminService, seedData, seedService, errorHandler
│   │   ├── interactive/          # Pure story constellation graph & branch helpers + unit tests
│   │   ├── media/                # MediaProvider interface, DemoMediaProvider, Drive/YouTube/Gcs stubs
│   │   ├── payments/             # PaymentProvider interface, MockPaymentProvider, gateway stubs + tests
│   │   └── studio/               # Pure creator analytics & episode reorder/choice validators + tests
│   ├── types/                    # Shared TypeScript domain interfaces
│   └── utils/                    # URL scheme sanitization & safe error formatting + unit tests
├── firestore.rules               # Default-deny Firestore security rules
├── firestore.rules.test.ts       # Automated RBAC & rules verification suite
├── firestore.indexes.json        # Compound Firestore index definitions
├── firebase-blueprint.json       # Canonical 14-collection JSON schema
├── DEPLOYMENT_CHECKLIST.md       # Pre-launch Firebase, Hosting, backup & compliance guide
└── walkthrough.md                # Phase 5 security review & verification evidence
```

---

## Firestore Schema

| Collection | Access Summary | Purpose |
| :--- | :--- | :--- |
| `/users/{userId}` | Owner read/update (non-privileged fields only); Admin read/role | Private profile, `phoneNumber`, RBAC role (`user` / `creator` / `admin`), and server-managed `warningCount`, `banned`, `activeDevice`, `lastSeen` (blocked from client edits) |
| `/sessions/{sessionId}` | Owner or Admin read; strictly server-written (`allow write: if false`) | Immutable log of single-device registrations, concurrent-device violations, bans, logouts, and admin enforcement actions |
| `/wallets/{userId}` | Owner or Admin read; strictly server-written (`allow write: if false`) | Server-authoritative coin balance (`balance`, `lifetimePurchased`, `lifetimeSpent`) |
| `/coinTransactions/{txId}` | Owner or Admin read; strictly server-written | Immutable coin ledger (`purchase`, `spend`, `admin_adjust`, `bonus`, `refund`) |
| `/episodeUnlocks/{unlockId}` | Owner or Admin read; strictly server-written | Permanent per-user coin episode unlocks |
| `/coinPackages/{packageId}` | Public read; Admin CRUD | Admin-defined coin top-up packs (name, coins, bonusCoins, priceInr, active) |
| `/platformSettings/{settingId}` | Public read; Admin write | Platform-wide settings such as daily free episode toggle & daily quota |
| `/admins/{adminId}` | Self read; Admin manage | Trusted admin UID allowlist |
| `/categories/{categoryId}` | Public read; Admin CRUD | Bilingual story genres/categories |
| `/creators/{creatorId}` | Public read; Owner/Admin write | Public storyteller/studio profiles |
| `/stories/{storyId}` | Published public read; Owner/Admin write | Story catalog metadata, visibility, interactive flag, Admin `priceOverrideCoins` |
| `/episodes/{episodeId}` | Public metadata read; Owner/Admin write (`priceCoins` immutable for creators after create) | Episode number, duration, `priceCoins`, `audioRef`, `videoMediaRef`, `choicePoint` |
| `/listeningHistory/{id}` | Listener, owning creator, or Admin read; Listener write | Resume position, completion flag, denormalized `storyOwnerUid` for creator analytics |
| `/bookmarks/{id}` | Owner-only read/write | Story bookmarks, story favorites, and creator follows |
| `/dailyUnlocks/{id}` | Owner-only read/create | Daily free-episode unlock claims (admin-configurable limit) |
| `/interactiveChoices/{id}` | Public read; Owner/Admin write | Optional standalone branching choice metadata |
| `/userChoices/{id}` | Owner-only read/write | Per-user branch selections illuminating the constellation trail |
| `/creatorRequests/{id}` | Applicant/Admin read; Applicant create; Admin review | "Become a Creator" applications |
| `/siteSettings/{settingId}` | Public read (`main`); Admin write (`delete: if false`) | Live editable branding, logo, colors, footer, hero banners, homepage sections, enabled languages, and legal pages (`/legal/:slug`) |
| `/auditLogs/{id}` | Admin-only read & create (no update/delete) | Immutable audit trail for every Admin Dashboard & CMS action |

---

## Extending `MediaProvider`

All media resolution goes through `src/services/media/MediaProvider.ts`:

```ts
export interface MediaProvider {
  readonly id: MediaProviderType;
  readonly label: string;
  readonly isConfigured: boolean;
  readonly isProductionProtected?: boolean;
  checkAccess(mediaRef: MediaRef, user: MediaAccessUser | null): Promise<MediaAccessCheckResult>;
  getPlaybackUrl(mediaRef: MediaRef, user: MediaAccessUser | null): Promise<MediaPlaybackResolution>;
  upload(file: File, metadata?: MediaUploadMetadata): Promise<MediaRef>;
}
```

To plug in a real production storage backend (e.g., Google Cloud Storage, Cloudflare R2, or Mux):
1. Implement `MediaProvider` in `src/services/media/GcsProvider.ts` (or a new file) with `isProductionProtected = true`.
2. In `getPlaybackUrl(mediaRef, user)`, send the user's Firebase ID token to your backend endpoint, which validates entitlement and returns a **short-lived signed playback URL** (never embed storage signing secrets in the browser).
3. In `upload(file, metadata)`, request a pre-signed upload URL from your backend, upload the file directly to object storage, and return `{ provider: 'gcs', id: objectKey, type: 'audio' | 'video' }`.
4. Register the provider in `src/services/media/index.ts`.

---

## Google Drive Media Provider (`DriveMediaProvider` — Testing & Low-Traffic Setup)

Dhruv Tales includes `DriveMediaProvider` (`src/services/media/DriveProvider.ts`) backed by three Vercel TypeScript serverless functions in `/api/media/`:

- `POST /api/media/authorize` — Verifies the Firebase ID token via `firebase-admin`, loads the episode, user profile, subscription, and `dailyUnlocks` from Cloud Firestore, runs the shared `canAccessEpisode()` rule, and returns a **5-minute HMAC-signed** `/api/media/stream?token=...` URL (never a raw Drive link).
- `GET /api/media/stream` — Verifies the HMAC token & expiry, resolves the Google Drive file ID from Firestore on the server, streams byte ranges (`206 Partial Content`, `Accept-Ranges: bytes`, `Cache-Control: private, no-store`) capped at **3 MB per chunk** to stay safely inside Vercel serverless response limits.
- `POST /api/media/import-folder` — Creator/Admin only. Scans a shared Drive folder and creates draft episodes in Firestore, merging audio & video files of the same episode number into one episode.

### Step-by-Step Setup

1. **Enable Google Drive API & Create a Drive Service Account (Google Cloud Console):**
   - Select or create a Google Cloud project and enable **Google Drive API**.
   - Go to **IAM & Admin → Service Accounts → Create Service Account** (e.g., `dhruv-tales-drive-reader`).
   - Open the service account → **Keys → Add Key → Create new key (JSON)**. Keep the downloaded JSON file strictly outside the Git repository.
   - Note the service account's email address (`...@<project>.iam.gserviceaccount.com`).
2. **Share Your Media Folder in Google Drive:**
   - Create a folder in Google Drive for your story's episodes.
   - Click **Share**, add the Drive service account email with **Viewer** access (never make the folder "Anyone with the link").
   - Copy the folder ID from the URL (`https://drive.google.com/drive/folders/<FOLDER_ID>`).
3. **Prepare Firebase Admin Credentials:**
   - In **Firebase Console → Project Settings → Service Accounts**, click **Generate new private key** (requires a standard user-owned Firebase/Google Cloud project).
   - Keep the JSON key outside Git.
4. **Configure Server-Side Environment Variables in Vercel:**
   - In **Vercel Project Settings → Environment Variables** (never use `VITE_` prefix and never commit secrets):
     - `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON` — Single-line or base64-encoded Drive service account JSON.
     - `FIREBASE_SERVICE_ACCOUNT_JSON` — Single-line or base64-encoded Firebase Admin service account JSON (or individual `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`).
     - `FIREBASE_DATABASE_ID` — Optional; set to your named Firestore database ID if not using `(default)` (auto-reads `firestoreDatabaseId` from `firebase-applet-config.json` when omitted).
     - `MEDIA_SIGNING_SECRET` — Random 32+ byte secret (generate via `openssl rand -hex 32`).
   - Redeploy on Vercel so `/api/media/*` picks up the new variables.
5. **Import Episodes in Creator Studio:**
   - Upload episode files into the shared Google Drive folder using the naming convention below.
   - Open **Creator Studio → Episodes & Choices**, select your story, click **Import from Drive folder**, and paste the folder ID or URL.

### Drive Folder File Naming Convention

Files must follow `EP##_audio.<ext>` and/or `EP##_video.<ext>` (case-insensitive):

```text
EP01_audio.mp3   ┐  merged into ONE draft Episode 1
EP01_video.mp4   ┘  with both audioRef & videoMediaRef (Audio ⇄ Video enabled)
EP02_audio.mp3      creates draft Episode 2 (audio-only)
EP03_video.mp4      creates draft Episode 3 (video-only)
```

- Supported audio extensions: `.mp3`, `.m4a`, `.wav`, `.ogg`, `.aac`, `.flac`, `.opus`, `.webm`.
- Supported video extensions: `.mp4`, `.webm`, `.mov`, `.m4v` (both **9:16 portrait** and **16:9 landscape** formats are supported and played in their uploaded aspect ratio).
- Existing episode numbers on the story are automatically **skipped** (never overwritten), and non-matching files are listed under **Invalid**.

### Important Limits & Boundaries

- **Testing & Low Traffic Only:** Google Drive imposes strict per-file and per-account download bandwidth quotas and is **not** a CDN or media streaming host. High concurrency will trigger `429` quota errors. Migrate to Cloudflare R2, GCS + Cloud CDN, or Mux before public launch.
- **Not Production-Grade Content Protection:** Short-lived signed proxy URLs prevent casual link sharing and hide Drive IDs from the frontend, but this is **not** DRM (Widevine/FairPlay) and cannot prevent a determined user from saving streamed bytes.
- **Vercel Hobby Plan:** Vercel's Hobby plan is strictly **non-commercial** and enforces serverless function execution/payload limits (hence the 3 MB per-chunk byte-range cap). Upgrade to a commercial plan or dedicated streaming host before monetizing.

---

## Single-Device Enforcement & Ban Flow (Server-Side)

Dhruv Tales enforces **one active device per user account** across **all sign-in methods** (Google, Email/Password, and Phone Auth) using Vercel TypeScript serverless functions and the Firebase Admin SDK:

- `POST /api/session/register { deviceId, deviceInfo }` — Runs an atomic Firestore transaction on `users/{uid}` and logs every event to the immutable `sessions` collection:
  - First sign-in or same `deviceId`: registers/refreshes `activeDevice` and `lastSeen`.
  - Different `deviceId` while another device is active: **blocks the new login** (`409 device_conflict`), increments `warningCount`, leaves the existing `activeDevice` intact, shows `"Warning X of 3: this account is already in use on another device"`, and signs out the new device immediately.
  - At **3 warnings**: sets `banned = true`, `isDisabled = true`, clears `activeDevice`, disables the Firebase Auth account (`updateUser(uid, { disabled: true })`), revokes refresh tokens (`revokeRefreshTokens(uid)`), and returns `403 account_banned` so the client displays the **Account Banned** screen with a support contact placeholder (`support@dhruvtales.example`).
- `POST /api/session/logout { deviceId }` — Releases `activeDevice` on voluntary sign-out (only if the calling device owns the lock).
- `POST /api/session/admin { targetUid, action, warningCount?, reason? }` — Admin-only endpoint supporting `ban`, `unban` (restores Firebase Auth & lets Admin set `warningCount` to `0`, `1`, or `2`), `reset_warnings`, and `force_logout` (clears `activeDevice` + revokes refresh tokens). Every action writes both an `auditLogs` entry and a `sessions` entry.
- **All `/api/*` Routes Block Banned Users:** `verifyFirebaseBearerToken()` calls `verifyIdToken(token, true)` (checking revocation/disabled state) and inspects `users/{uid}.banned` / `isDisabled`, while `/api/media/stream` also checks `users/{uid}` before streaming bytes.
- **Firestore Rules Protection:** `firestore.rules` blocks non-admin clients from writing `warningCount`, `banned`, `bannedAt`, `banReason`, `activeDevice`, `lastSeen`, or any document in `/sessions/{sessionId}`.

### Honest Limitations of Browser-Based `deviceId`

`deviceId` is a random identifier generated in the browser and persisted in `localStorage`. Because it is browser-based, **it cannot detect every kind of account sharing**:

- Clearing browser storage/cookies, switching to Private/Incognito mode, or using a second browser profile on the same physical laptop generates a new `deviceId` (which can trigger false warnings if the user did not sign out first).
- Conversely, if two people share credentials **sequentially** (Person A signs out cleanly before Person B signs in), `activeDevice` is released on sign-out and will not flag a concurrent violation.
- A user who manually copies the `dhruv_tales_device_id_v1` value from `localStorage` onto another browser can spoof the same `deviceId`. Stronger guarantees require native device attestation (App Check / Play Integrity / DeviceCheck) and active playback heartbeat leases.

### Firebase Phone Auth Setup & Billing Impact

The Phone OTP sign-in code path is implemented in `ProfilePage.tsx` and `authService.ts` (`RecaptchaVerifier` + `signInWithPhoneNumber`), and shares the exact same per-user single-device enforcement. Before enabling it for real users:

1. Open **Firebase Console → Authentication → Sign-in method** and enable **Phone**.
2. Add your production domain(s) (e.g., `your-app.vercel.app`) under **Authentication → Settings → Authorized domains**.
3. **Billing Impact:** Firebase Phone Auth requires the **Blaze (pay-as-you-go)** plan to send real SMS verification messages (free Spark projects cannot send real SMS). Google Cloud Identity Platform charges per SMS beyond the small free daily tier (rates vary by country, including India). For free development/testing without SMS charges, add **Phone numbers for testing** inside Firebase Console → Authentication → Sign-in method → Phone.

---

## Admin CMS, Live Site Settings & Analytics

Dhruv Tales includes a full **Admin CMS & Analytics Panel** (`/admin`) plus a user-facing **"My Coins" Spending Insights** panel inside `/wallet`:

- **`POST /api/admin/cms`** — Strictly Admin-only server endpoint (verifies Firebase ID token + Admin role) supporting full CRUD for stories, episodes (including coin price), creators, users, and live `siteSettings`, plus safe **soft-delete & restore** (`isDeleted`, `deletedAt`, `deletedByUid`) for stories and episodes. Every mutation writes an immutable entry to `auditLogs`.
- **`GET /api/admin/analytics`** — Strictly Admin-only paginated server aggregation (`PAGE_SIZE = 500`, `MAX_PAGES = 20`) over `coinTransactions` and `listeningHistory`. Supports date-range presets (`7d`, `30d`, `90d`, `all`, `custom`), `daily` / `weekly` / `monthly` time series, spend breakdowns by story, episode, genre, creator, and language, top spenders/stories/creators, unlock-vs-play conversion, per-user deep dive (`?userId=<uid>`), and formula-injection-safe CSV export.
- **Live Site Settings (`siteSettings/main`)** — Admin edits to app name, logo URL, theme colors, hero banners, homepage section order/visibility/story assignments, Editor's Picks, enabled languages, footer copy, and legal pages (`/legal/terms`, `/legal/privacy`, `/legal/refund`) save to Firestore and reflect immediately without redeploying.
- **Required Firestore Indexes (`firestore.indexes.json`):** Deploy the updated `firestore.rules` and `firestore.indexes.json` (including composite indexes on `coinTransactions (uid ASC, createdAt DESC)`, `coinTransactions (type ASC, createdAt DESC)`, `sessions (uid ASC, createdAt DESC)`, and `episodeUnlocks (uid ASC, unlockedAt DESC)`) manually when ready.

---

## Extending `PaymentProvider` (Coin Economy)

All coin package purchases go through `src/services/payments/PaymentProvider.ts` (currently wired to `MockPaymentProvider` — **Demo payments only**):

1. Create a concrete class implementing `PaymentProvider` (e.g., Razorpay) and point checkout to a server-side Vercel `/api` order route.
2. Process payment confirmation exclusively via **verified server webhooks** crediting `wallets/{uid}` and appending to `coinTransactions/{txId}` with the Firebase Admin SDK.
3. Keep `wallets`, `coinTransactions`, and `episodeUnlocks` strictly read-only for clients in `firestore.rules`.

---

## Adding a New Indian Language

Adding Marathi (`mr`), Gujarati (`gu`), Tamil (`ta`), Bengali (`bn`), or any other language takes **two steps**:

1. Create `src/i18n/mr.json` matching the keys in `src/i18n/en.json` (missing keys automatically fall back to English).
2. Add **one line** to `LANGUAGE_CONFIG` in `src/i18n/index.ts`:
   ```ts
   import mr from './mr.json';
   // inside LANGUAGE_CONFIG:
   { code: 'mr', label: 'Marathi', nativeLabel: 'मराठी', messages: mr },
   ```

The language switcher, Profile preference dropdown, and `localStorage` / Firestore persistence automatically include the new language.

---

## Wrapping as Native Android & iOS Apps with Capacitor

Dhruv Tales already uses safe-area CSS insets (`.safe-top`, `.safe-bottom`, `.mini-player-mobile-offset`), `viewport-fit=cover`, ≥44px touch targets, and static Vite output (`dist/`):

```bash
# 1. Install Capacitor
npm install @capacitor/core
npm install -D @capacitor/cli

# 2. Initialize pointing at Vite's build output
npx cap init "Dhruv Tales" "com.dhruvtales.app" --web-dir dist

# 3. Add native platforms
npm install @capacitor/android @capacitor/ios
npx cap add android
npx cap add ios

# 4. Build web bundle and sync into native projects
npm run build
npx cap sync
```

**Native notes before store submission:**
- Configure `capacitor.config.ts` with `server.androidScheme: 'https'` so Firebase Auth and Media Session APIs behave cleanly.
- Use native Google Sign-In plugin (e.g., `@capacitor-firebase/authentication`) because embedded WebViews block standard OAuth popups.
- Configure background audio playback capabilities (`UIBackgroundModes: audio` on iOS; foreground media service on Android) and native In-App Purchases where required by App Store / Play Store billing policies.

---

## Local Development & Verification

```bash
# Start local dev server on port 3000
npm run dev

# Type-check & lint
npm run lint
npx eslint firestore.rules

# Run all unit & Firestore security rules tests
npx tsx --test \
  firestore.rules.test.ts \
  src/services/access/episodeAccess.test.ts \
  src/services/interactive/storyGraph.test.ts \
  src/services/payments/paymentProvider.test.ts \
  src/services/studio/studioAnalytics.test.ts \
  src/utils/validation.test.ts

# Production bundle build
npm run build
```

---

## Known Limitations

- **Demo Media Only (when Drive is unconfigured):** `DemoMediaProvider` serves local bundled samples and session-only `blob:` URLs (uploaded files in Creator Studio demo mode do not survive a full browser reload until a cloud `MediaProvider` is connected).
- **Demo Coin Payments Only:** Coin purchases run through `MockPaymentProvider` with zero real money; integrate Razorpay/webhook verification before live monetization.
- **Browser-Based `deviceId`:** Single-device detection relies on `localStorage` and cannot catch sequential credential sharing or spoofed `localStorage` tokens.
- **Email/Password & Phone Auth Console Toggles:** Both UI flows are implemented, but require enabling their respective providers in Firebase Console → Authentication → Sign-in method (Phone Auth also requires Blaze billing for live SMS).
- **Compound Indexes & Updated Rules Not Auto-Deployed:** `firestore.rules` and `firestore.indexes.json` in this repo must be reviewed and deployed manually when you are ready.
