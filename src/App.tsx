import React, { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ProtectedRoute } from './components/ProtectedRoute';
import { SessionEnforcementOverlays } from './components/SessionEnforcementOverlays';
import { AudioPlayerProvider } from './hooks/useAudioPlayer';
import { AppDataProvider } from './hooks/useAuthAndActivity';
import { LanguageProvider } from './hooks/useLanguage';

// Route-level code splitting so heavy workspaces (Studio, Admin, Details) load on demand
const HomePage = lazy(() =>
  import('./pages/HomePage').then((m) => ({ default: m.HomePage }))
);
const SearchPage = lazy(() =>
  import('./pages/SearchPage').then((m) => ({ default: m.SearchPage }))
);
const StoryDetailsPage = lazy(() =>
  import('./pages/StoryDetailsPage').then((m) => ({ default: m.StoryDetailsPage }))
);
const LibraryPage = lazy(() =>
  import('./pages/LibraryPage').then((m) => ({ default: m.LibraryPage }))
);
const WalletPage = lazy(() =>
  import('./pages/WalletPage').then((m) => ({ default: m.WalletPage }))
);
const ProfilePage = lazy(() =>
  import('./pages/ProfilePage').then((m) => ({ default: m.ProfilePage }))
);
const CreatorStudioPage = lazy(() =>
  import('./pages/CreatorStudioPage').then((m) => ({ default: m.CreatorStudioPage }))
);
const AdminDashboardPage = lazy(() =>
  import('./pages/AdminDashboardPage').then((m) => ({ default: m.AdminDashboardPage }))
);
const LegalPage = lazy(() =>
  import('./pages/LegalPage').then((m) => ({ default: m.LegalPage }))
);

const RouteLoadingFallback: React.FC = () => (
  <div
    role="status"
    aria-live="polite"
    aria-label="Loading page"
    className="max-w-7xl mx-auto px-4 sm:px-6 py-10 space-y-6 animate-pulse"
  >
    <div className="h-8 w-56 rounded-lg bg-[#141418]" />
    <div className="h-56 rounded-2xl bg-[#141418] border border-white/5" />
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
      {Array.from({ length: 4 }).map((_, idx) => (
        <div key={idx} className="aspect-[3/4] rounded-xl bg-[#141418]" />
      ))}
    </div>
  </div>
);

export default function App() {
  return (
    <ErrorBoundary>
      <LanguageProvider>
        <AppDataProvider>
          <AudioPlayerProvider>
            <BrowserRouter>
              <SessionEnforcementOverlays />
              <AppShell>
                <Suspense fallback={<RouteLoadingFallback />}>
                  <Routes>
                    <Route path="/" element={<HomePage />} />
                    <Route path="/search" element={<SearchPage />} />
                    <Route path="/story/:storyId" element={<StoryDetailsPage />} />
                    <Route path="/library" element={<LibraryPage />} />
                    <Route path="/wallet" element={<WalletPage />} />
                    <Route path="/profile" element={<ProfilePage />} />
                    <Route
                      path="/studio"
                      element={
                        <ProtectedRoute allowedRoles={['creator', 'admin']}>
                          <CreatorStudioPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/admin"
                      element={
                        <ProtectedRoute allowedRoles={['admin']}>
                          <AdminDashboardPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route path="/legal/:slug" element={<LegalPage />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Routes>
                </Suspense>
              </AppShell>
            </BrowserRouter>
          </AudioPlayerProvider>
        </AppDataProvider>
      </LanguageProvider>
    </ErrorBoundary>
  );
}
