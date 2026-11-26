# Dhruv Tales — Pre-Launch Deployment Checklist

> **Status:** Ready for pre-launch review. **Not publicly deployed.**
> Do not expose Dhruv Tales to public users or collect real payments until every item in **Required Pre-Launch Decisions** and **Firebase & Cloud Setup** is completed.

---

## 1. What Is REAL vs SIMULATED Today

| Capability | Current Status | Details |
| :--- | :--- | :--- |
| **Authentication** | **REAL** | Firebase Authentication (`GoogleAuthProvider` active; Email/Password wired in UI and ready once enabled in Firebase Console). |
| **Database & Persistence** | **REAL** | Cloud Firestore (`ai-studio-dhruvtales-f37a8591-ea84-4cb5-a280-729bcd4480c6` in project `dhruv-tales`) across 14 collections with fallback local seed catalog for offline/unseeded previews. |
| **RBAC & Security Rules** | **REAL** | `firestore.rules` enforces default-deny, role checks (`user` / `creator` / `admin`), creator ownership, immutable fields, and append-only `auditLogs`. |
| **Audio / Video Playback & Switching** | **REAL** | HTML5 `<audio>` & `<video>`, shared player state, exact position/speed/play-state sync, Media Session API, PiP, fullscreen, and keyboard shortcuts. |
| **Interactive Branching & Constellation** | **REAL** | Timestamp/end-of-episode choice cards, Firestore `userChoices` persistence, glowing Star Map light trail, List View alternative, and Replay from Choice. |
| **Creator Studio & Admin Dashboard** | **REAL** | Firestore CRUD for stories, episodes, choices, categories, users, creator requests, and immutable audit logs. |
| **Internationalization (EN / हिंदी)** | **REAL** | Complete bilingual UI with `localStorage` + Firestore persistence and single-line Indian language extensibility. |
| **PWA Shell & Offline Fallback** | **REAL** | Web App Manifest, 192px/512px/maskable/Apple icons, Workbox precache + SPA `navigateFallback`, and install prompt. |
| **Media Hosting & DRM** | **SIMULATED** | `DemoMediaProvider` serves local bundled samples (`/demo-media/`) and browser `blob:` URLs (`isProductionProtected = false`). **Not production DRM/CDN.** |
| **Subscriptions & Payments** | **SIMULATED** | `MockPaymentProvider` simulates Pole Star Monthly (₹99) & Annual (₹799) plans in Firestore (`isSimulated: true`). **No real money is charged.** |
| **AI APIs** | **NONE** | Zero AI API calls or imports anywhere in `src/`. (Note: `@google/genai` remains an unused template dependency in `package.json` and can be removed before production.) |

---

## 2. Firebase & Google Cloud Settings Requiring Your Review

No remote Firebase or Google Cloud settings were changed during Phase 5. Before going live, review and apply these changes explicitly:

1. **Deploy Compound Firestore Indexes (`firestore.indexes.json`)**
   - **Why:** Queries in `CreatorStudioPage`, `AdminDashboardPage`, `LibraryPage`, and `catalogService` filter + sort across two fields (e.g., `stories` by `creatorOwnerUid + updatedAt`, `listeningHistory` by `userId + updatedAt`, `userChoices` by `userId + chosenAt`).
   - **Command:** `firebase deploy --only firestore:indexes`
2. **Verify & Deploy Latest `firestore.rules`**
   - **Why:** Ensures the live database matches the audited `firestore.rules` file in this repository.
   - **Command:** `firebase deploy --only firestore:rules`
3. **Enable Email/Password Sign-In (Optional)**
   - **Why:** The Profile screen includes Login / Sign-up forms for Email/Password in addition to Google Sign-In. If you want email accounts active, enable **Authentication → Sign-in method → Email/Password** in Firebase Console.
4. **Authorized Domains for Firebase Auth**
   - **Why:** Add your custom production domain (e.g., `dhruvtales.com`) under **Firebase Console → Authentication → Settings → Authorized domains** so Google Sign-In works outside `localhost` / `web.app`.
5. **Firebase App Check (Recommended before public launch)**
   - **Why:** Protects Firestore and future backend media/payment endpoints from automated abuse using reCAPTCHA Enterprise (web) and Play Integrity / App Attest (Capacitor mobile).
6. **Billing / Blaze Plan & Budget Alerts**
   - **Why:** Cloud Functions (needed for production signed media URLs and payment webhooks) and automated Firestore backups require the Blaze pay-as-you-go plan. Set monthly GCP budget alerts (e.g., 50% / 80% / 100%) before opening public registration.

---

## 3. Environment & Build Configuration

- [ ] Copy `.env.example` to `.env.local` (or inject via CI/CD secrets) and verify no private API keys or service account JSONs exist in `VITE_*` variables or `src/`.
- [ ] Confirm `firebase-applet-config.json` points to the intended production Firebase project and database ID.
- [ ] Remove unused `@google/genai` from `package.json` (template leftover; zero imports in `src/`).
- [ ] Run the full test, lint, and production build suite:
  ```bash
  npx eslint firestore.rules
  npx tsx --test firestore.rules.test.ts src/services/access/episodeAccess.test.ts src/services/interactive/storyGraph.test.ts src/services/payments/paymentProvider.test.ts src/services/studio/studioAnalytics.test.ts src/utils/validation.test.ts
  npm run lint
  npm run build
  ```

---

## 4. Firebase Hosting, Custom Domain & SSL

- [ ] Install Firebase CLI (`npm install -g firebase-tools`) and sign in (`firebase login`).
- [ ] Initialize Hosting targeting `dist` as a Single-Page App (`firebase.json`):
  ```json
  {
    "hosting": {
      "public": "dist",
      "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
      "rewrites": [{ "source": "**", "destination": "/index.html" }],
      "headers": [
        {
          "source": "/assets/**",
          "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }]
        },
        {
          "source": "/manifest.webmanifest",
          "headers": [{ "key": "Cache-Control", "value": "public, max-age=3600" }]
        }
      ]
    },
    "firestore": {
      "rules": "firestore.rules",
      "indexes": "firestore.indexes.json"
    }
  }
  ```
- [ ] Deploy preview channel first (`firebase hosting:channel:deploy staging`) and test on real Android + iOS devices.
- [ ] Connect your custom domain in **Firebase Console → Hosting → Add custom domain**, configure DNS A/TXT records, and wait for automatic Google-managed SSL certificate provisioning.
- [ ] Enable HSTS and verify `https://` redirect works cleanly.

---

## 5. Firestore Backup & Disaster Recovery Plan

- [ ] Enable **Point-in-Time Recovery (PITR)** on the Firestore database (allows restoring any timestamp within the last 7 days).
- [ ] Configure **Scheduled Firestore Backups** (daily snapshots retained for 14–30 days; weekly snapshots retained for 90 days) in **Google Cloud Console → Firestore → Backups**.
- [ ] Configure a dedicated GCS export bucket with lifecycle rules and uniform bucket-level access for long-term archival exports (`gcloud firestore export`).
- [ ] Test a restore into a staging database before launch day.

---

## 6. Required Pre-Launch Decisions & Blockers

### A. Media Storage, CDN & Playback Authorization (BLOCKING for real content)
- [ ] Choose your production media storage provider (e.g., **Google Cloud Storage + Cloud CDN**, **Cloudflare R2**, or **Mux**).
- [ ] Replace `DemoMediaProvider` in `src/services/media/index.ts` with a real `MediaProvider` implementation (e.g., completing `GcsProvider.ts`).
- [ ] Implement a **server-side Cloud Function / API endpoint** that verifies the user's Firebase ID token, checks episode access (`free`, `daily_unlock`, or verified `premium` subscription), and mints **short-lived signed URLs** (e.g., 5–15 min TTL) or HLS/DASH encrypted tokens.
- [ ] Configure CORS, Range-request support (`Accept-Ranges: bytes` for audio/video scrubbing), and upload size/MIME validation on the storage bucket.

### B. Real Payment Gateway Integration (BLOCKING before charging money)
- [ ] Choose a production payment gateway (e.g., **Razorpay** for UPI/cards in India, **Stripe**, or Google Play / Apple In-App Purchase for Capacitor mobile builds).
- [ ] Implement a backend checkout & **webhook handler** that verifies cryptographic webhook signatures before writing `subscriptions/{uid}` and updating `users/{uid}.subscriptionTier`.
- [ ] Update `firestore.rules` so clients can **read** their own `subscriptions/{uid}` document, while **only the backend Admin SDK** can activate or extend paid plans (removing direct client-side `subscriptionTier` upgrades used by the Phase 4 mock).

### C. Legal, Compliance & Policy Pages (BLOCKING for public launch & app stores)
- [ ] **Privacy Policy** (disclosing Firebase Auth, Firestore listening history/preferences, analytics, and DPDP Act India / GDPR account deletion rights).
- [ ] **Terms of Service** (creator content ownership, licensing, prohibited content, and takedown policy).
- [ ] **Refund & Cancellation Policy** (clear INR billing terms, renewal cadence, and cancellation process).
- [ ] **Copyright / DMCA & Grievance Officer Contact** (required under Indian IT Rules 2021 for digital media platforms).
- [ ] **Content Rating & Age Appropriateness Guidelines** (especially for Kids & Horror categories).

---

## 7. Post-Launch Monitoring

- [ ] Enable Google Cloud Monitoring alerts for Firestore read/write spikes, authentication failures, and Hosting 5xx rates.
- [ ] Review `/admin` → **Audit Logs** regularly for role changes and content moderation activity.
- [ ] Verify offline PWA update behavior after shipping each new build.
