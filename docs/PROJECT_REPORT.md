# Dhruv Tales — Complete Project Report (A to Z)

> **Audit Scope:** Full read-only inspection of `src/`, `api/`, `firestore.rules`, `firestore.indexes.json`, `firebase-blueprint.json`, `firebase-applet-config.json`, `package.json`, `vite.config.ts`, `vercel.json`, `.env.example`, `.gitignore`, `README.md`, and `DEPLOYMENT_CHECKLIST.md`.  
> **Important Note:** This report reflects **only what actually exists in the codebase right now**. No application code was modified, no automated or manual test pass is claimed here, and no Firebase or Google Cloud settings were changed.

---

## 1. What Dhruv Tales Is

### Purpose & Concept
**Dhruv Tales (ध्रुव टेल्स)** is a bilingual (**Hindi & English**) serialized storytelling web application built for Indian audiences. Listeners and viewers can browse serialized stories across genres, play episodes in **audio or video**, switch seamlessly between audio and video mid-episode without losing their place, unlock paid episodes using an in-app **Coin wallet**, and shape branching plots in **interactive "choose-your-path" stories**.

### Target Audience
1. **Listeners & Viewers (`user` role):** People who enjoy Indian audio dramas, vertical (9:16) or widescreen (16:9) narrative videos, and interactive stories in Hindi, English, or bilingual formats on phones and laptops.
2. **Storytellers & Studios (`creator` role):** Independent writers, voice artists, and audio/video studios who apply to publish their own series, upload episodes (or batch-import from Google Drive), set episode coin prices once, and track listener performance.
3. **Platform Administrators (`admin` role):** Site operators who approve creator applications, manage user roles and account bans, curate stories, configure coin packages and episode pricing, manage genres, and audit every administrative action.

### Visual Identity & Design Theme (Pole Star / Constellations)
- Named after **Dhruv** (the Pole Star / guiding star), the interface uses a **nocturnal editorial dark theme**:
  - Deep night-sky backgrounds (`#0B0B0E` canvas, `#141418` cards, `#1C1C22` elevated panels)
  - Warm starlight gold accents (`#E5A93C` and `#F3C669`) and warm cream typography (`#F5F3EE`)
  - Editorial typography pairing **Fraunces** (display headings), **Plus Jakarta Sans** (body), **Noto Sans Devanagari** (crisp Hindi script), and **JetBrains Mono** (timers and tabular numbers)
- **Interactive Story Constellation:** Interactive stories include an interactive **Star Map** where each episode is a star and the listener's chosen path glows like a golden constellation trail. A full text **List View** is also provided for accessibility.

---

## 2. Tech Stack & Architecture

| Layer | Technology in Codebase | How It Works (Simple Explanation) |
| :--- | :--- | :--- |
| **Frontend (UI)** | React 19, TypeScript, Tailwind CSS v4, React Router v7, Lucide Icons, Motion | Single-Page Application (SPA) bundled with **Vite 8**. Heavy pages (`StoryDetails`, `CreatorStudio`, `AdminDashboard`, etc.) are lazy-loaded so the initial page loads faster. |
| **Authentication** | Firebase Authentication (`firebase` v13.4) | Handles user sign-in via Google (active), plus Email/Password and Phone OTP code paths (require enabling in Firebase Console). |
| **Database** | Cloud Firestore (`ai-studio-dhruvtales-f37a8591-ea84-4cb5-a280-729bcd4480c6` in project `dhruv-tales`) | Stores user profiles, stories, episodes, categories, creators, listening progress, bookmarks, coin wallets, ledgers, unlocks, sessions, and audit logs across **19 collections**. |
| **Backend API** | Vercel TypeScript Serverless Functions (`/api/*`, `@vercel/node`, `firebase-admin` v14.5) | **11 serverless endpoints** run securely on Vercel servers (never in the browser) to enforce coin wallet math, episode unlocks, creator price locking, single-device bans, and signed Google Drive streaming. |
| **Hosting & Routing** | Vercel (`vercel.json`) | Routes all non-`/api/*` web paths to `index.html` for React Router SPA navigation while letting `/api/*` run as serverless functions. |
| **PWA (Installable Web App)** | `vite-plugin-pwa` (Workbox) | Generates a Web App Manifest, caches app shell assets and Google Fonts, shows an offline banner, and offers an "Install App" prompt (plus iOS Safari "Add to Home Screen" instructions). CSS safe-area insets are included for future native wrapping (Capacitor). |
| **Languages (i18n)** | Custom JSON registry (`src/i18n/index.ts`, `en.json`, `hi.json`) | Lightweight translation dictionary with automatic English fallback and one-line registration for additional Indian languages. |
| **Media Abstraction** | `MediaProvider` interface (`src/services/media/`) | Keeps playback and storage decoupled from UI. Currently supports `DemoMediaProvider` (bundled/local demo files) and `DriveMediaProvider` (signed proxy to Google Drive for low-traffic testing). `GcsProvider` and `YouTubeProvider` are unimplemented stubs. |
| **Payment Abstraction** | `PaymentProvider` interface (`src/services/payments/`) | Keeps checkout decoupled from wallet logic. Currently wired to `MockPaymentProvider` (demo checkout, no real money). `RazorpayStubPaymentProvider` is a placeholder that throws an error until a real gateway is built. |
| **AI APIs** | **None** | Verified **zero AI / LLM imports or API calls** anywhere in `src/` or `api/`. (Note: `@google/genai` still sits unused in `package.json` from the starter template.) |

### How Local Preview vs. Vercel Deployment Behaves
- **On Vercel (with server env vars configured):** All 11 `/api/*` serverless functions execute with Firebase Admin SDK — coin purchases/unlocks write to Firestore atomically, single-device enforcement tracks sessions and bans violators, and Google Drive files stream through signed 5-minute proxy URLs.
- **In Local Vite-Only Preview (`npm run dev`):** Vite serves only the frontend; `/api/*` routes return HTML/404. The app gracefully degrades:
  - Coin wallet operations automatically fall back to a browser-local **`localStorage` demo store** (never writing wallets to Firestore from the browser).
  - Single-device registration (`/api/session/register`) sees the API is unavailable and skips enforcement.
  - Drive streaming (`/api/media/authorize`) and Admin wallet adjustments (`/api/coins/admin-adjust`) display clear messages explaining they require Vercel serverless functions.

---

## 3. Feature Inventory (REAL vs. SIMULATED vs. PARTLY BUILT vs. NOT BUILT)

Status legend:
- **REAL:** Works against Firebase Auth / Cloud Firestore / Vercel `/api/*` serverless backend.
- **SIMULATED:** Uses demo/mock behavior (no real money or no production cloud media CDN).
- **PARTLY BUILT:** Some underlying code/helpers exist, or only a subset of functionality is implemented.
- **NOT BUILT:** Not implemented in the live app.

### 3.1 Accounts, Sign-In & Roles
| Feature | Status | Details from Codebase |
| :--- | :--- | :--- |
| User roles (`user`, `creator`, `admin`) | **REAL** | Stored in `users/{uid}.role` and enforced in `ProtectedRoute.tsx`, `firestore.rules`, and `/api/*`. Bootstrap admin email (`vaishushroff@gmail.com`) is recognized in rules and APIs. |
| Google Sign-In | **REAL** | Active via Firebase `GoogleAuthProvider` (`signInWithPopup` with account chooser). |
| Email & Password Sign-Up / Login | **REAL (needs Console toggle)** | Full UI, validation, and email verification banner (`resendVerificationEmail` + refresh button) exist in `ProfilePage.tsx`. Requires enabling **Email/Password** in Firebase Console. |
| Phone OTP Sign-In | **REAL (needs Console toggle + Blaze plan)** | Full UI (`RecaptchaVerifier` + `signInWithPhoneNumber` + 6-digit OTP verification) in `ProfilePage.tsx`. Requires enabling **Phone** in Firebase Console (and Blaze billing for real SMS, or Console test phone numbers for free testing). |
| Profile Editing (name, bio, language, audio/video preference) | **REAL** | Verified users save to `users/{uid}`. Restricted fields (`role`, `banned`, `warningCount`, `activeDevice`) cannot be edited by the user. |
| Account Deletion | **REAL** | Deletes user's Firestore data and Firebase Auth account (with confirmation modal; handles `requires-recent-login`). |
| "Become a Creator" Application | **REAL** | Standard users submit studio name, handle, language, pitch, and optional sample link (`creatorRequests/{uid}`). Admins approve/reject; rejected users can resubmit. |

### 3.2 Home, Discovery Sections, Search & Filters
| Feature | Status | Details from Codebase |
| :--- | :--- | :--- |
| Featured Hero Banner | **REAL** | Displays the story marked `isFeatured` (or first story) with Play/Resume and View Details buttons. Hardcoded single-story hero (not yet multi-banner CMS driven). |
| Discovery Carousels (Continue Listening, Browse Genres, Trending Now, Editor's Picks, Popular Stories, Recently Added) | **REAL** | Populated from Cloud Firestore (with automatic fallback to 12 local seed stories / 8 genres / 6 creators / 70 episodes if Firestore is empty or offline). |
| Search & Filters (`/search`) | **REAL** | 200ms debounced keyword search (matches EN/HI titles, synopses, creator names), Genre buttons, Language filter (`All / Hindi / English`), Creator dropdown, Sort (`Popular / Highest Rated / Recently Added`), URL query param sync, and "Load More" pagination (10 per page). |
| Admin-Editable Homepage Sections & Multi-Slide Hero Banners | **PARTLY BUILT (Not Wired)** | `src/services/siteSettings/siteSettingsService.ts` and types in `src/types/index.ts` exist as standalone helper files, but `HomePage.tsx`, `AppShell.tsx`, `AdminDashboardPage.tsx`, and `firestore.rules` do **not** read or edit `siteSettings` yet. |

### 3.3 Story Pages & Episodes
| Feature | Status | Details from Codebase |
| :--- | :--- | :--- |
| Story Detail Page (`/story/:storyId`) | **REAL** | Shows poster artwork, genre, language, rating, play count, creator follow button, Bookmark, Favorite, Synopsis, Interactive Constellation (when interactive), Episode list with duration, format indicator (`Audio & Video`), coin price / unlocked status, and progress bar. |
| Local Audio/Video File Tester on Story Page | **SIMULATED** | Lets anyone load a local audio/video file from their device into the player using a temporary browser `blob:` URL (does not upload to any server). |
| Story & Episode Soft-Delete / Trash Restore | **NOT BUILT** | Optional fields (`isDeleted`, `deletedAt`, `deletedByUid`) were added to TypeScript interfaces in `src/types/index.ts`, but **no UI, Firestore rules, or delete/restore logic uses them yet**. Current deletes in Admin and Creator Studio are permanent hard deletes. |

### 3.4 Audio Player, Video Player, Switching, Resume & Speed
| Feature | Status | Details from Codebase |
| :--- | :--- | :--- |
| Persistent Mini-Player & Expanded Full Player (`AudioPlayerBar.tsx`) | **REAL** | Stays active while navigating across pages; supports play/pause, ±15s skip, scrub bar, next/previous episode, playback speed (`0.75x`, `1x`, `1.25x`, `1.5x`, `1.75x`, `2x`), and Media Session API (lock-screen/hardware controls). |
| Adaptive Video Player (`VideoPlayer.tsx` + `PortraitVideoFrame.tsx`) | **REAL** | Automatically detects each uploaded/played video's native aspect ratio and renders **9:16 portrait** videos in a centered portrait frame and **16:9 landscape** videos in a widescreen frame, fitting cleanly on phones and short laptop screens. Includes auto-hiding controls, fullscreen, Picture-in-Picture (PiP), captions (`<track>`), mute/volume, and keyboard shortcuts (`Space`, `←/→`, `↑/↓`, `M`, `F`). |
| Seamless Audio ⇄ Video Switching | **REAL** | Episodes with both `audioRef` and `videoMediaRef` (3 hybrid seed stories + any Drive/Studio dual-media episode) switch mid-playback while preserving exact timestamp, playback speed, and play/pause state. |
| Resume Position & Debounced Cloud Save | **REAL** | Saves playback progress to `listeningHistory` roughly every 10 seconds, on pause, on episode switch, and on page exit; resumes from saved position after refresh (plus localStorage fallback cache). |

### 3.5 Bookmarks, Follows, History & Continue Listening
| Feature | Status | Details from Codebase |
| :--- | :--- | :--- |
| Story Bookmarks, Favorites & Creator Follows | **REAL** | Saved in Firestore `bookmarks` collection (`story_bookmark`, `story_favorite`, `creator_follow`) for signed-in verified users, with instant optimistic UI and rollback on Firestore failure. Guests save in `localStorage`. |
| Listening History & Continue Listening | **REAL** | Appears as the "Continue Listening" carousel on Home and as a timestamped History tab in `/library` with completion % and one-tap Resume. |
| Library Page (`/library`) | **REAL** | 5 tabs: Listening History, Bookmarks, Favorites, Following (with Unfollow button), and Unlocked Episodes (permanent coin unlocks + daily free unlocks). |

### 3.6 Interactive Stories & Branching Choices
| Feature | Status | Details from Codebase |
| :--- | :--- | :--- |
| Choice-Point Pausing & Choice Overlay (`ChoiceOverlay.tsx`) | **REAL** | Automatically pauses audio/video playback at a configured timestamp (`triggerAtSec`) or episode end (`triggerAtEnd`) and presents 2–3 bilingual story choices. |
| Interactive Story Constellation (`StoryConstellation.tsx`) | **REAL** | Visual Star Map highlighting the user's chosen path + accessible List View + "Replay from Choice" (prunes downstream choices cleanly). 2 interactive seed stories included (`story-kaalchakra`, `story-bengaluru-code`). |
| Choice Persistence | **REAL** | Saved per user in Firestore `userChoices` collection (guest fallback in `localStorage`). |

### 3.7 Coin System (Replaced Subscriptions)
*Note: The earlier Pole Star subscription system has been completely removed from the codebase and replaced with the Coin Economy.*

| Feature | Status | Details from Codebase |
| :--- | :--- | :--- |
| Server-Authoritative Coin Wallet (`wallets/{uid}`) | **REAL (on Vercel)** / **SIMULATED fallback locally** | Balance changes happen ONLY via Vercel `/api/coins/*` using Firebase Admin SDK. `firestore.rules` blocks all client writes to `wallets`, `coinTransactions`, and `episodeUnlocks`. In Vite-only local preview without `/api`, falls back to browser `localStorage`. |
| Immutable Coin Ledger (`coinTransactions`) | **REAL (on Vercel)** / **SIMULATED fallback locally** | Records every `purchase`, `spend`, `admin_adjust`, `bonus`, and `refund` with `amount`, `balanceAfter`, `episodeId`, `storyId`, `creatorId`, `createdAt`, and `note`. Filterable on `/wallet`. |
| Paid Episode Unlock (`POST /api/coins/unlock`) | **REAL (on Vercel)** / **SIMULATED fallback locally** | Atomic Firestore transaction checks effective price (story override or episode price), checks balance (returns HTTP `402` if short), deducts coins, logs ledger entry, and writes permanent `episodeUnlocks/{uid}_{episodeId}`. Idempotent (never double-charges). |
| Buying Coin Packages (`POST /api/coins/purchase`) | **SIMULATED (Demo Payments Only)** | Uses `MockPaymentProvider` (`isSimulated: true`) with an explicit "Demo Payments Only — No Real Money Charged" checkout modal and receipt banner. Credits real Firestore wallet on Vercel (or local demo wallet in Vite preview). |
| Admin-Defined Coin Packages (`coinPackages`) | **REAL** | 4 default packages (`Starter Pouch ₹49`, `Storyteller Pack ₹129`, `Constellation Chest ₹299`, `Patron Vault ₹699`), fully creatable/editable/toggleable/deletable by Admin in `/admin`. |
| Daily Free Episode Unlocks (`dailyUnlocks` + `platformSettings/economy`) | **REAL** | Admin can toggle Daily Free Episodes ON/OFF and set daily quota (0–20/day). Users see remaining daily free unlocks on Story Detail and can claim inside the Unlock modal. |
| User "My Coins" Spending Analytics Dashboard | **NOT BUILT** | `/wallet` shows balance, lifetime totals, packages, and filterable transaction list, but does **not** yet render a "spending by story" or "spending over time" chart (helper function exists in `api/_lib/analyticsEngine.ts` but is not wired to UI). |

### 3.8 Creator Studio & Pricing Rules
| Feature | Status | Details from Codebase |
| :--- | :--- | :--- |
| Story Management (Create, Edit, Publish/Draft, Delete) | **REAL** | Creators create/edit/delete **only their own** stories (enforced in Firestore rules). Cannot self-assign curation flags (`isFeatured`, `isTrending`, `isEditorsPick`) or `priceOverrideCoins`. |
| Episode Management (Create, Edit, Reorder Up/Down, Delete, Interactive Choice Builder) | **REAL** | Creators build episodes with bilingual title/description, duration, audio/video slots, optional interactive choice points (2–3 options), and ending flag. |
| Set-Once Creator Pricing Rule | **REAL** | Creators set `priceCoins` (0 = free) **once** when creating an episode. After creation, the price input is locked in UI, blocked in `firestore.rules` (`incoming().priceCoins == existing().priceCoins`), and rejected with `403` by `POST /api/coins/pricing`. |
| Google Drive Folder Batch Import (`DriveFolderImportModal.tsx`) | **REAL (on Vercel)** | Calls `POST /api/media/import-folder` to scan a shared Drive folder for `EP##_audio.<ext>` and `EP##_video.<ext>`, merging matching audio+video into one draft episode, skipping existing episode numbers, and listing invalid filenames. |
| Local File Upload in Studio | **SIMULATED** | Uses `DemoMediaProvider` (`blob:` URL in browser memory — lost on full browser reload) and includes live 9:16 / 16:9 video preview matching listener framing. |
| Creator Analytics Tab | **REAL** | Computes total plays, completions, completion rate, and per-episode breakdown from Firestore `listeningHistory` docs matching `storyOwnerUid`. |

### 3.9 Admin Panel (`/admin`)
| Feature | Status | Details from Codebase |
| :--- | :--- | :--- |
| Users Management (Role change `user/creator/admin`, Enable/Disable, Ban, Unban + set warnings, Reset Warnings, Force Logout) | **REAL** | Live in `/admin` → **Users** tab. Ban/unban/reset/force-logout call `POST /api/session/admin` (Firebase Admin SDK disables Auth user & revokes tokens). |
| Creator Applications Review | **REAL** | Live in `/admin` → **Creator Requests** tab. Approve promotes user to `creator` + creates verified `creators` doc; Reject saves review note. |
| Stories & Episodes Moderation + Pricing | **REAL** | Live in `/admin` → **Stories & Episodes** tab. Admin can toggle visibility (`published/draft/archived`), toggle `Featured`, `Editor's Pick`, `Trending`, set/clear story-level `priceOverrideCoins`, edit any episode's `priceCoins` anytime, and permanently delete stories/episodes. |
| Coins & Economy Management | **REAL** | Live in `/admin` → **Coins & Economy** tab. Toggle Daily Free Episodes + daily limit; full CRUD on Coin Packages; manual Admin Wallet Adjustment (`bonus`, `refund`, `admin_adjust` via `POST /api/coins/admin-adjust`). |
| Creators Tab | **PARTLY BUILT** | Live in `/admin` → **Creators** tab, but currently supports **only** toggling the `Verified` badge. Creating, editing bio/handle/language, or deleting creators from Admin UI is **NOT BUILT**. |
| Categories / Genres Management | **REAL** | Live in `/admin` → **Categories** tab. Full Create, Edit (EN/HI names, slug, sort order, accent color), Active toggle, and Delete. |
| Immutable Audit Logs | **REAL** | Live in `/admin` → **Audit Logs** tab. Every admin action writes an append-only `auditLogs` record (rules forbid update/delete). |
| Admin Create/Edit Full Story & Episode Metadata | **NOT BUILT** | Admin can moderate flags, visibility, prices, and delete stories/episodes, but cannot create or edit full story/episode copy or media refs inside `/admin` (must use `/studio` for own stories). |
| Full Site CMS (Editable App Name, Logo, Colors, Banners, Homepage Section Order/Visibility, Languages, Footer, Legal Pages) | **PARTLY BUILT (Not Wired)** | `src/services/siteSettings/siteSettingsService.ts` exists as a standalone pure module, but there is **no Admin UI tab**, **no `/api/admin/cms` endpoint**, **no `siteSettings` Firestore rule**, and **no frontend wiring** yet. |

### 3.10 Analytics Dashboards
| Feature | Status | Details from Codebase |
| :--- | :--- | :--- |
| Creator Studio Listening Analytics | **REAL** | Available inside `/studio` → **Analytics** tab (reads listener progress for creator's own stories). |
| Admin Analytics Dashboard (Coins purchased/spent/outstanding, Daily/Weekly/Monthly charts, Spend by Story/Episode/Genre/Creator/Language, Top Spenders/Creators, Conversion, Date-Range Filters, CSV Export, Per-User Inspector) | **PARTLY BUILT (Not Wired)** | Pure calculation & CSV export math exists in `api/_lib/analyticsEngine.ts` (with unit tests in `api/_lib/analyticsEngine.test.ts`), **but** there is **no `/api/admin/analytics` API route** (`api/admin/` directory is empty) and **no Admin Analytics UI tab** (`src/components/admin/` directory is empty). |
| User "My Coins" Spending Insights Dashboard | **NOT BUILT** | Pure helper `computeUserMyCoinsAnalytics` exists in `api/_lib/analyticsEngine.ts`, but is **not rendered** on `WalletPage.tsx`. |

### 3.11 Single-Device Enforcement, Warnings & Bans
| Feature | Status | Details from Codebase |
| :--- | :--- | :--- |
| Device Registration (`POST /api/session/register`) | **REAL (on Vercel)** | Generates a random browser `deviceId` in `localStorage`. On login (Google, Email, or Phone), registers ONE `activeDevice` on `users/{uid}` and logs to `sessions`. |
| Concurrent Login Conflict & 3-Strike Auto-Ban | **REAL (on Vercel)** | Different `deviceId` while another device is active returns `409 device_conflict`, increments `warningCount` (`Warning 1 of 3`, `Warning 2 of 3`), shows warning modal (`SessionEnforcementOverlays.tsx`), and signs out the new device. On strike 3, sets `banned = true`, disables Firebase Auth user, revokes refresh tokens, returns `403 account_banned`, and shows the Account Banned screen with support contact placeholder (`support@dhruvtales.example`). |
| Voluntary Logout Lock Release (`POST /api/session/logout`) | **REAL (on Vercel)** | Releases `activeDevice` lock when the active device signs out cleanly. |
| Server-Wide Ban Blocking | **REAL (on Vercel)** | `verifyFirebaseBearerToken()` checks revoked tokens + `users/{uid}.banned` across all `/api/*` endpoints; `/api/media/stream` also checks `users/{uid}` before streaming bytes. |
| Admin Ban / Unban / Reset Warnings / Force Logout (`POST /api/session/admin`) | **REAL (on Vercel)** | Re-enables Firebase Auth on unban, lets admin choose new warning count (`0`, `1`, or `2`), revokes refresh tokens on ban/force-logout, and writes both `sessions` and `auditLogs`. |

### 3.12 Languages (i18n)
| Feature | Status | Details from Codebase |
| :--- | :--- | :--- |
| Bilingual UI (`en` & `hi`) | **REAL** | Top-bar switcher (`EN / हिंदी`) persists to `localStorage` and (for signed-in users) `users/{uid}.preferredLanguage`. Bilingual story/episode/category titles & synopses switch dynamically. |
| Adding More Indian Languages | **REAL (Code-level, 2 steps)** | Create `src/i18n/<code>.json` matching `en.json` keys and add one line to `LANGUAGE_CONFIG` in `src/i18n/index.ts`. Header automatically switches from a toggle button to a dropdown once >2 languages are registered. (Admin UI toggle for languages is **NOT BUILT**.) |

### 3.13 Media Storage & Signed Playback
| Feature | Status | Details from Codebase |
| :--- | :--- | :--- |
| `DemoMediaProvider` | **SIMULATED** | Serves bundled `/demo-media/` MP4/WebM samples, synthesized Web Audio fallback tones for audio demos, and session-only `blob:` URLs for local file picks. |
| `DriveMediaProvider` + `/api/media/authorize` + `/api/media/stream` | **REAL (Testing / Low-Traffic Only)** | Frontend stores only `{ provider: "drive", id: <fileId>, type }`. Authorize checks Firebase token + shared `canAccessEpisode()` logic + unlocks and returns a **5-minute HMAC-SHA256 signed** `/api/media/stream?token=...` URL (never a raw Drive URL). Stream supports `206 Partial Content` byte ranges capped at **3 MB per chunk** with `Cache-Control: private, no-store`. **Not production DRM or CDN.** |
| `GcsProvider` & `YouTubeProvider` | **NOT BUILT** | Stub classes only (`isImplemented = false`); all methods throw "not implemented". |

### 3.14 Security, PWA, Responsive Layout & Accessibility
| Feature | Status | Details from Codebase |
| :--- | :--- | :--- |
| Firestore Security Rules (`firestore.rules`) | **REAL (in repo — manual deploy required)** | 720 lines, default-deny safety net, strict field whitelists & size caps on all 19 collections, PII isolation on `users`, server-only protection on `wallets`/`coinTransactions`/`episodeUnlocks`/`sessions` and ban/device fields, immutable `auditLogs`, creator price-lock rule. |
| Server-Side Checks & Secret Hygiene | **REAL** | Secrets live strictly in server-side env vars (`.env.example`); `.gitignore` blocks `.env*` and service-account JSON key files. Zero secrets in `src/` or `VITE_*`. |
| PWA (Manifest, Service Worker, Offline Banner, Install Prompt) | **REAL** | `vite-plugin-pwa` builds manifest + Workbox SW; icons (`192`, `512`, `maskable`, `apple-touch-icon`) exist in `public/`; offline status banner with Retry button in `AppShell.tsx`. |
| Responsive Layout & Accessibility | **REAL** | Mobile 5-tab bottom navigation (`<768px`), desktop top nav (`>=768px`), `>=44px` touch targets, skip-to-main link, visible gold keyboard focus rings, `prefers-reduced-motion` support, ARIA roles/labels, and Constellation List View fallback. |

---

## 4. Data Model (All 19 Firestore Collections)

Defined in `firebase-blueprint.json` and secured in `firestore.rules`:

| # | Collection Path | What It Stores | Who Can Read | Who Can Write |
| :--- | :--- | :--- | :--- | :--- |
| 1 | `/users/{userId}` | Private profile (`email`, `phoneNumber`, `displayName`, `bio`, `preferredLanguage`, `preferredFormat`), RBAC `role`, `isDisabled`, and server-only device/ban fields (`warningCount`, `banned`, `bannedAt`, `banReason`, `activeDevice`, `lastSeen`). | Owner or Admin | Verified owner (non-privileged profile fields only), Admin, or Server Admin SDK (device/ban fields). |
| 2 | `/admins/{adminId}` | Trusted Admin UID allowlist (`uid`, `grantedAt`). | Self or Admin | Admin only. |
| 3 | `/categories/{categoryId}` | Bilingual genres (`slug`, `nameEn`, `nameHi`, descriptions, `accentHex`, `sortOrder`, `isActive`). | Public (active) or Admin (all) | Admin only. |
| 4 | `/creators/{creatorId}` | Public storyteller/studio profiles (`ownerUid`, `name`, `handle`, bilingual bios, `language`, `followersCount`, `storiesCount`, `verified`). | Public | Admin (full CRUD) or owning Creator (profile fields only, cannot self-verify). |
| 5 | `/stories/{storyId}` | Story metadata (`slug`, bilingual title/synopsis, `genreId`, `language`, `creatorId`, cover theme/URLs, `rating`, `totalPlays`, `episodeCount`, curation flags, `visibility`, `format`, `isInteractive`, Admin-only `priceOverrideCoins`). | Public (published), owning Creator, or Admin | Owning Creator (no curation flags or price override) or Admin. |
| 6 | `/episodes/{episodeId}` | Episode metadata (`storyId`, `episodeNumber`, bilingual title/description, `durationSec`, `priceCoins`, `mediaRef`, `audioRef`, `videoMediaRef`, `choicePoint`, `isEnding`). | Public | Owning Creator (`priceCoins` set once on create, immutable on update) or Admin (anytime). |
| 7 | `/wallets/{userId}` | Server-authoritative Coin Wallet (`balance`, `lifetimePurchased`, `lifetimeSpent`, `updatedAt`). | Owner or Admin | **Server Admin SDK ONLY** (`allow create, update, delete: if false` in rules). |
| 8 | `/coinTransactions/{txId}` | Immutable Coin Ledger (`uid`, `type`, `amount`, `balanceAfter`, `episodeId`, `storyId`, `creatorId`, `createdAt`, `note`). | Owner or Admin | **Server Admin SDK ONLY**. |
| 9 | `/episodeUnlocks/{unlockId}` | Permanent paid episode unlocks (`uid`, `episodeId`, `storyId`, `creatorId`, `pricePaidCoins`, `transactionId`, `unlockedAt`). | Owner or Admin | **Server Admin SDK ONLY**. |
| 10 | `/coinPackages/{packageId}` | Admin-defined coin top-up bundles (`name`, `nameHi`, `coins`, `bonusCoins`, `priceInr`, `active`, `sortOrder`). | Public (active) or Admin (all) | Admin only. |
| 11 | `/platformSettings/{settingId}` | Global economy settings (`economy` doc: `dailyFreeEnabled`, `dailyFreeLimit`). | Public (`get` on `economy`) or Admin | Admin only (no delete). |
| 12 | `/listeningHistory/{historyId}` | Per-user playback position (`userId`, `storyId`, `storyOwnerUid`, `episodeId`, `episodeNumber`, `positionSec`, `durationSec`, `completed`, `updatedAt`). | Listener, owning Creator (analytics), or Admin | Verified Listener (own docs only). |
| 13 | `/bookmarks/{bookmarkId}` | User bookmarks, favorites, and creator follows (`userId`, `targetType`, `targetId`, `createdAt`). | Owner or Admin | Verified Owner (create/delete; no update). |
| 14 | `/dailyUnlocks/{unlockId}` | Daily free-episode unlock claims (`userId`, `storyId`, `episodeId`, `unlockDate` `YYYY-MM-DD`). | Owner or Admin | Verified Owner (create/delete; no update). |
| 15 | `/interactiveChoices/{choiceId}` | Optional standalone interactive branching choice definitions. | Public | Admin only. |
| 16 | `/userChoices/{userChoiceId}` | Per-user chosen branch trail (`userId`, `storyId`, `episodeId`, `choicePointId`, `optionId`, bilingual labels, `nextEpisodeId`, `chosenAt`). | Owner or Admin | Verified Owner. |
| 17 | `/creatorRequests/{requestId}` | "Become a Creator" applications (`userId`, studio details, `pitch`, `status`, `reviewNote`, `reviewedByUid`). | Applicant or Admin | Verified Applicant (create as `pending` / resubmit if `rejected`) or Admin (approve/reject/delete). |
| 18 | `/auditLogs/{logId}` | Immutable Admin action log (`actorUid`, `actorEmail`, `action`, `targetCollection`, `targetId`, `summary`, `createdAt`). | Admin only | Admin create-only (`update` and `delete` forbidden) + Server Admin SDK. |
| 19 | `/sessions/{sessionId}` | Immutable single-device session & violation log (`uid`, `deviceId`, `deviceInfo`, `eventType`, `warningCountAfter`, `bannedAfter`, `note`, `createdAt`). | Owner or Admin | **Server Admin SDK ONLY**. |

*Not yet in Firestore rules or schema:* `siteSettings` (for editable branding, banners, homepage sections, footer, and legal pages) is **not** created in `firestore.rules` or `firebase-blueprint.json` yet.

---

## 5. Pages, Routes & API Endpoints

### Frontend Routes (`src/App.tsx`)
| Route | Page Component | Who Can Access | Purpose |
| :--- | :--- | :--- | :--- |
| `/` | `HomePage` | Everyone (Guest, User, Creator, Admin) | Featured hero, Continue Listening, Genre grid, Trending, Editor's Picks, Popular, Recently Added. |
| `/search` | `SearchPage` | Everyone | Keyword search, Genre/Language/Creator filters, sorting, and Load More pagination. |
| `/story/:storyId` | `StoryDetailsPage` | Everyone | Story overview, creator follow, bookmark/favorite, interactive constellation, episode list, coin unlock modal, local media tester. |
| `/library` | `LibraryPage` | Everyone (guest uses localStorage; signed-in syncs Firestore) | Listening History, Bookmarks, Favorites, Following, and Unlocked Episodes. |
| `/wallet` | `WalletPage` | Everyone (guest runs local demo; signed-in uses server API on Vercel) | Coin balance, lifetime stats, Demo Coin Package purchase modal, and filterable transaction ledger. |
| `/profile` | `ProfilePage` | Everyone | Sign in (Google, Email/Password, Phone OTP), Email verification, Profile editing, Device/Warning status, Become a Creator form, Admin Catalog Seeder, and Delete Account. |
| `/studio` | `CreatorStudioPage` | **`creator` or `admin` only** (`ProtectedRoute`) | Manage own stories, episodes, interactive choices, Google Drive folder import, video preview, and Creator Analytics. |
| `/admin` | `AdminDashboardPage` | **`admin` only** (`ProtectedRoute`) | Users (roles/bans/warnings/sessions), Creator Requests, Stories & Episodes moderation/pricing, Coins & Economy, Creators verify toggle, Categories CRUD, Audit Logs. |
| `*` (any unknown URL) | Redirect → `/` | Everyone | Fallback redirect to Home. |

*Missing routes:* There are currently **no `/legal/*` routes** (Terms of Service, Privacy Policy, Refund Policy).

### Backend Vercel Serverless API Routes (`/api/*`)
| Endpoint | Method | Auth / Role Required | Purpose |
| :--- | :--- | :--- | :--- |
| `/api/media/authorize` | `POST` | Optional Bearer token (required for paid/private episodes); blocks banned users | Verifies access (`canAccessEpisode` + unlocks) and mints a 5-minute HMAC-signed stream URL. |
| `/api/media/stream` | `GET`, `HEAD` | Valid 5-minute signed `?token=...`; checks `users/{uid}` ban flag | Streams Google Drive file bytes in ≤3 MB `206 Partial Content` chunks without exposing Drive links. |
| `/api/media/import-folder` | `POST` | Bearer token + `creator` (story owner) or `admin` | Scans a shared Drive folder and creates draft episodes from `EP##_audio.*` / `EP##_video.*`. |
| `/api/coins/wallet` | `GET` | Bearer token (not banned) | Returns user's wallet, transaction ledger, permanent unlocks, active coin packages, and economy settings. |
| `/api/coins/purchase` | `POST` | Bearer token (not banned) | Runs simulated `MockPaymentProvider` checkout and atomically credits `wallets/{uid}` + `coinTransactions`. |
| `/api/coins/unlock` | `POST` | Bearer token (not banned) | Atomically deducts coins, records ledger spend, and creates permanent `episodeUnlocks` doc (returns `402` if insufficient balance). |
| `/api/coins/pricing` | `POST` | Bearer token + `admin` (rejects `creator` edits on existing episodes with `403`) | Updates episode `priceCoins` or story `priceOverrideCoins` and writes an `auditLogs` entry. |
| `/api/coins/admin-adjust` | `POST` | Bearer token + `admin` | Credits/debits a user's wallet (`admin_adjust`, `bonus`, `refund`) and writes `coinTransactions` + `auditLogs`. |
| `/api/session/register` | `POST` | Bearer token (allows ban check) | Enforces 1 active device per account, increments warnings (1–3), auto-bans & disables Auth at 3, logs to `sessions`. |
| `/api/session/logout` | `POST` | Bearer token | Releases `activeDevice` lock for the signing-out device and logs to `sessions`. |
| `/api/session/admin` | `POST` | Bearer token + `admin` | Executes `ban`, `unban`, `reset_warnings`, or `force_logout`, updates Firebase Auth + Firestore + `sessions` + `auditLogs`. |

*Note:* `/api/admin/` directory currently exists but is **empty** (no `/api/admin/analytics` or `/api/admin/cms` route exists yet).

---

## 6. Environment Variables (Names Only — No Secret Values)

| Variable Name | Scope | Where Used | Purpose |
| :--- | :--- | :--- | :--- |
| `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON` | **Server-only** (Vercel) | `api/_lib/driveClient.ts` | Authenticates `/api/media/stream` and `/api/media/import-folder` with Google Drive API (single-line or base64 JSON). |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | **Server-only** (Vercel) | `api/_lib/firebaseAdmin.ts` | Option A (recommended): Firebase Admin SDK credentials used by all `/api/*` routes. |
| `FIREBASE_PROJECT_ID` | **Server-only** (Vercel) | `api/_lib/firebaseAdmin.ts` | Option B alternative to JSON blob: Firebase project ID for Admin SDK. |
| `FIREBASE_CLIENT_EMAIL` | **Server-only** (Vercel) | `api/_lib/firebaseAdmin.ts` | Option B alternative to JSON blob: service account email for Admin SDK. |
| `FIREBASE_PRIVATE_KEY` | **Server-only** (Vercel) | `api/_lib/firebaseAdmin.ts` | Option B alternative to JSON blob: service account private key for Admin SDK. |
| `FIREBASE_DATABASE_ID` | **Server-only** (Vercel, optional) | `api/_lib/firebaseAdmin.ts` | Named Firestore database ID. Falls back to `firestoreDatabaseId` inside `firebase-applet-config.json` if omitted. |
| `MEDIA_SIGNING_SECRET` | **Server-only** (Vercel) | `api/_lib/mediaToken.ts` | 32+ byte secret used to sign and verify 5-minute HMAC-SHA256 `/api/media/stream` tokens. |
| `DISABLE_HMR` | **Build/Dev only** (non-secret) | `vite.config.ts` | Disables Vite HMR/file watching in managed preview environments. |

**Public (`VITE_`) Variables:** Currently **none** (`0` `VITE_*` variables are referenced in `src/`). Public Firebase Web SDK identifiers (`projectId`, `appId`, `apiKey`, `authDomain`, `firestoreDatabaseId`, etc.) are loaded directly from `firebase-applet-config.json` in `src/services/firebase/config.ts`. These are standard client-side Firebase web app identifiers (not private server credentials), and security relies on `firestore.rules` and Firebase Auth.

---

## 7. Known Limitations, Bugs & Risks (Honest Assessment)

1. **Unfinished / Unwired Code Artifacts in Repo:**
   - `api/_lib/analyticsEngine.ts` and `src/services/siteSettings/siteSettingsService.ts` (plus their unit test files and extra interfaces in `src/types/index.ts`) exist on disk, and empty folders `api/admin/` and `src/components/admin/` exist, **but none of these are wired into any live API route, page, or `firestore.rules`**.
2. **Stale Pre-Launch Checklist Document:**
   - `DEPLOYMENT_CHECKLIST.md` has not been updated since an earlier phase — it still describes "14 collections" and "Pole Star Monthly/Annual subscriptions", which have been removed and replaced by the 19-collection Coin Economy and Single-Device Enforcement.
3. **Unused Packages in `package.json`:**
   - `@google/genai` and `express` (plus `@types/express`) remain in `package.json` from the starter template even though neither is imported anywhere in `src/` or `api/`.
4. **Simulated Payments Only:**
   - Coin top-ups use `MockPaymentProvider` (`isSimulated: true`). No real money is collected, and anyone signed in can add unlimited demo coins until a real payment gateway with server-side webhook verification replaces `POST /api/coins/purchase`.
5. **Google Drive Streaming Is Not Production-Ready:**
   - Google Drive enforces strict download quotas (returns `429` under concurrent traffic), is not a global CDN, and signed proxy URLs are **not DRM** (determined users can capture streamed bytes). Also, Vercel's Hobby plan is non-commercial and limits response size (forcing a 3 MB per-chunk cap in `/api/media/stream`).
6. **Browser-Based Single-Device Identification Limits:**
   - `deviceId` lives in browser `localStorage`. Clearing browser data, opening Incognito/Private mode, or switching browsers on the **same** laptop creates a new `deviceId` and can trigger false warnings if the user did not sign out first. Conversely, sequential sharing (Person A logs out cleanly before Person B logs in) or copying `localStorage` values can bypass detection.
7. **Local Vite Preview vs. Production Behavior Gap:**
   - Running `npm run dev` (Vite-only) does not run Vercel `/api/*` serverless functions. Single-device enforcement, Drive streaming, and Admin wallet adjustments cannot be fully tested on plain Vite — they require `vercel dev` or a Vercel preview deployment with server env vars.
8. **Hard Deletes Without Trash / Soft-Delete:**
   - Deleting a story or episode in Admin or Creator Studio permanently removes the Firestore document immediately. There is no soft-delete or restore workflow yet.
9. **Manual Rules & Index Deployment Required + Missing Future Indexes:**
   - Neither `firestore.rules` nor `firestore.indexes.json` has been auto-deployed. In addition, `firestore.indexes.json` currently has 10 indexes, but does **not** yet include composite indexes for `coinTransactions (uid, createdAt)`, `sessions (uid, createdAt)`, or `episodeUnlocks (uid, unlockedAt)` if future sorted/paginated queries are added.
10. **Firestore Write Restrictions for Unverified Email Users:**
    - `firestore.rules` requires `isVerified()` (`email_verified == true` or verified phone number) for user profile, history, bookmark, and choice writes. Newly registered Email/Password users cannot cloud-sync until they verify their email (local browser cache is used in the meantime).
11. **Media Session / Demo Uploads Are Ephemeral:**
    - Local audio/video files uploaded in Creator Studio via `DemoMediaProvider` use browser `blob:` URLs that disappear after a page reload.

---

## 8. What Is Still Pending Before Public Launch

| Priority | Pending Item | Why It Matters |
| :--- | :--- | :--- |
| **Blocker** | **Real Payment Gateway (e.g., Razorpay) + Verified Webhooks** | Must replace `MockPaymentProvider` in `POST /api/coins/purchase` so coins are only credited after cryptographically verified payment settlement. |
| **Blocker** | **Legal & Compliance Pages** | Terms of Service, Privacy Policy (DPDP Act India / account deletion disclosures), Coins & Refund Policy, Copyright/DMCA notice, Content Rating guidelines, and Indian IT Rules 2021 Grievance Officer contact (currently zero legal pages exist in the app). |
| **Blocker** | **Production Media Storage & CDN Decision** | Replace Google Drive / `DemoMediaProvider` with GCS + Cloud CDN, Cloudflare R2, or Mux for scalable streaming, persistent uploads, and higher concurrency (and upgrade off Vercel Hobby before commercial use). |
| **Blocker** | **Deploy Latest `firestore.rules` & `firestore.indexes.json`** | Live Firestore must match the 19-collection ruleset and compound indexes before real users sign in. |
| **High** | **Finish Admin CMS & Analytics Dashboards** | Wire up the planned Site Settings CMS (`siteSettings`), soft-delete + restore for stories/episodes, full Creator/Story/Episode CRUD in Admin, Admin Analytics Dashboard (`/api/admin/analytics` + UI + CSV export), and user-facing "My Coins" spending insights. |
| **High** | **Firebase Console Auth & Billing Configuration** | Enable Email/Password and Phone sign-in methods if desired, add production domain(s) to Authorized Domains, upgrade to Blaze plan (required for live Phone SMS and backups), and configure GCP budget alerts. |
| **High** | **Firestore Backups & Disaster Recovery** | Enable Point-in-Time Recovery (PITR) and scheduled daily/weekly Firestore backups; test a restore in staging. |
| **Medium** | **Firebase App Check & Monitoring** | Enable App Check (reCAPTCHA Enterprise / Play Integrity) to curb automated abuse and configure error/quota alerts. |
| **Medium** | **Housekeeping** | Remove unused `@google/genai` and `express` from `package.json`, update `DEPLOYMENT_CHECKLIST.md`, replace placeholder support email (`support@dhruvtales.example`), and wire up or clean up unintegrated draft helper files. |
