import type { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  computeAdminAnalyticsReport,
  computePerUserAnalytics,
  resolveDateRangeBounds,
} from '../../../api/_lib/analyticsEngine';
import type {
  AdminAnalyticsReport,
  AnalyticsDateRangePreset,
  AnalyticsTimeGranularity,
  AuditLogEntry,
  Category,
  CoinTransaction,
  CoinWallet,
  ContentLanguage,
  CoverTheme,
  Creator,
  Episode,
  ListeningHistoryEntry,
  PerUserAnalyticsDetail,
  SessionLogEntry,
  SiteSettings,
  Story,
  StoryFormat,
  StoryVisibility,
  UserProfile,
} from '../../types';
import {
  sanitizeSafeUrl,
  sanitizeSiteSettings,
  saveCachedSiteSettings,
} from '../siteSettings/siteSettingsService';
import { slugify } from '../studio/studioAnalytics';
import { resolveApiUrl } from '../api/apiClient';
import { writeAuditLog } from './adminService';
import { db, handleFirestoreError, OperationType } from './config';

function tsToMs(val: unknown): number {
  if (val instanceof Timestamp) return val.toMillis();
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'string') {
    const parsed = Date.parse(val);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

async function getBearerHeaders(user: User | null): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (user) {
    const token = await user.getIdToken();
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function tryServerCmsApi(
  user: User | null,
  action: string,
  payload: Record<string, unknown>
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; fallbackAllowed: boolean; error?: string }> {
  if (!user) return { ok: false, fallbackAllowed: false, error: 'Authentication required.' };
  try {
    const headers = await getBearerHeaders(user);
    const res = await fetch(resolveApiUrl('/api/admin/cms'), {
      method: 'POST',
      headers,
      body: JSON.stringify({ action, payload }),
    });
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      // Static-only host without a connected backend API
      return { ok: false, fallbackAllowed: true };
    }
    const data = (await res.json()) as Record<string, unknown>;
    if (res.ok) {
      return { ok: true, data };
    }
    if (res.status === 404 || res.status === 405 || res.status === 503) {
      return { ok: false, fallbackAllowed: true };
    }
    return {
      ok: false,
      fallbackAllowed: false,
      error: String(data.error ?? 'Admin CMS request failed.'),
    };
  } catch {
    return { ok: false, fallbackAllowed: true };
  }
}

export async function adminSaveSiteSettings(
  user: User | null,
  actor: UserProfile,
  settings: SiteSettings,
  summary = 'Updated live site settings'
): Promise<{ saved: SiteSettings; mode: 'server' | 'firestore'; log?: AuditLogEntry }> {
  const sanitized = sanitizeSiteSettings(settings);
  const apiRes = await tryServerCmsApi(user, 'site_settings_save', {
    settings: sanitized,
    summary,
  });

  if (apiRes.ok) {
    const saved = { ...sanitized, updatedAt: Date.now(), updatedByUid: actor.uid };
    saveCachedSiteSettings(saved);
    return { saved, mode: 'server' };
  }
  if (!apiRes.fallbackAllowed) {
    throw new Error(apiRes.error || 'Could not save site settings.');
  }

  try {
    await setDoc(doc(db, 'siteSettings', 'main'), {
      ...sanitized,
      updatedByUid: actor.uid,
      updatedAt: serverTimestamp(),
    });
    const log = await writeAuditLog(actor, 'site_settings_update', 'siteSettings', 'main', summary);
    const saved = { ...sanitized, updatedAt: Date.now(), updatedByUid: actor.uid };
    saveCachedSiteSettings(saved);
    return { saved, mode: 'firestore', log };
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, 'siteSettings/main');
  }
}

export interface AdminStoryFormInput {
  id?: string;
  title: string;
  titleHi: string;
  synopsis: string;
  synopsisHi: string;
  genreId: string;
  language: ContentLanguage;
  creatorId: string;
  creatorName: string;
  creatorOwnerUid: string;
  coverUrl?: string;
  coverTheme: CoverTheme;
  visibility: StoryVisibility;
  format: StoryFormat;
  isInteractive: boolean;
  isTrending: boolean;
  isEditorsPick: boolean;
  isPopular: boolean;
  isFeatured: boolean;
  priceOverrideCoins: number | null;
}

export async function adminSaveStoryCms(
  user: User | null,
  actor: UserProfile,
  form: AdminStoryFormInput,
  isEdit: boolean
): Promise<{ id: string; mode: 'server' | 'firestore' }> {
  const apiRes = await tryServerCmsApi(user, isEdit ? 'story_update' : 'story_create', {
    ...form,
  });
  if (apiRes.ok) {
    return { id: String(apiRes.data.id ?? form.id ?? ''), mode: 'server' };
  }
  if (!apiRes.fallbackAllowed) {
    throw new Error(apiRes.error || 'Could not save story.');
  }

  const title = form.title.trim().slice(0, 140);
  const titleHi = (form.titleHi.trim() || title).slice(0, 140);
  const synopsis = form.synopsis.trim().slice(0, 1200);
  const synopsisHi = (form.synopsisHi.trim() || synopsis).slice(0, 1200);
  const id = isEdit
    ? String(form.id)
    : `story-${slugify(title).slice(0, 32)}-${Date.now().toString(36)}`;
  const coverUrl = sanitizeSafeUrl(form.coverUrl);

  try {
    if (isEdit) {
      await updateDoc(doc(db, 'stories', id), {
        title,
        titleHi,
        synopsis,
        synopsisHi,
        genreId: form.genreId,
        language: form.language,
        creatorId: form.creatorId,
        creatorName: form.creatorName.slice(0, 100),
        coverTheme: form.coverTheme,
        coverUrl,
        visibility: form.visibility,
        format: form.format,
        isInteractive: form.isInteractive,
        isTrending: form.isTrending,
        isEditorsPick: form.isEditorsPick,
        isPopular: form.isPopular,
        isFeatured: form.isFeatured,
        priceOverrideCoins: form.priceOverrideCoins,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(doc(db, 'stories', id), {
        id,
        slug: slugify(title).slice(0, 80) || id,
        title,
        titleHi,
        synopsis,
        synopsisHi,
        genreId: form.genreId,
        language: form.language,
        creatorId: form.creatorId,
        creatorOwnerUid: form.creatorOwnerUid || actor.uid,
        creatorName: form.creatorName.slice(0, 100),
        coverUrl,
        coverTheme: form.coverTheme,
        rating: 4.8,
        totalPlays: 0,
        episodeCount: 0,
        isTrending: form.isTrending,
        isEditorsPick: form.isEditorsPick,
        isPopular: form.isPopular,
        isFeatured: form.isFeatured,
        visibility: form.visibility,
        format: form.format,
        isInteractive: form.isInteractive,
        priceOverrideCoins: form.priceOverrideCoins,
        isDeleted: false,
        deletedAt: null,
        deletedByUid: null,
        publishedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    await writeAuditLog(
      actor,
      isEdit ? 'story_update' : 'story_create',
      'stories',
      id,
      `${isEdit ? 'Updated' : 'Created'} story "${title}" (${form.visibility})`
    );
    return { id, mode: 'firestore' };
  } catch (err) {
    handleFirestoreError(err, isEdit ? OperationType.UPDATE : OperationType.CREATE, `stories/${id}`);
  }
}

export async function adminSoftDeleteStory(
  user: User | null,
  actor: UserProfile,
  story: Story,
  episodeIds: string[]
): Promise<void> {
  const apiRes = await tryServerCmsApi(user, 'story_soft_delete', {
    id: story.id,
    title: story.title,
  });
  if (apiRes.ok) return;
  if (!apiRes.fallbackAllowed) throw new Error(apiRes.error || 'Soft-delete failed.');

  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'stories', story.id), {
      isDeleted: true,
      visibility: 'archived',
      deletedAt: serverTimestamp(),
      deletedByUid: actor.uid,
      updatedAt: serverTimestamp(),
    });
    for (const epId of episodeIds) {
      batch.update(doc(db, 'episodes', epId), {
        isDeleted: true,
        deletedAt: serverTimestamp(),
        deletedByUid: actor.uid,
      });
    }
    await batch.commit();
    await writeAuditLog(
      actor,
      'story_soft_delete',
      'stories',
      story.id,
      `Moved story "${story.title}" and ${episodeIds.length} episode(s) to Trash`
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `stories/${story.id}`);
  }
}

export async function adminRestoreStory(
  user: User | null,
  actor: UserProfile,
  story: Story,
  episodeIds: string[]
): Promise<void> {
  const apiRes = await tryServerCmsApi(user, 'story_restore', {
    id: story.id,
    title: story.title,
  });
  if (apiRes.ok) return;
  if (!apiRes.fallbackAllowed) throw new Error(apiRes.error || 'Restore failed.');

  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'stories', story.id), {
      isDeleted: false,
      visibility: 'draft',
      deletedAt: null,
      deletedByUid: null,
      updatedAt: serverTimestamp(),
    });
    for (const epId of episodeIds) {
      batch.update(doc(db, 'episodes', epId), {
        isDeleted: false,
        deletedAt: null,
        deletedByUid: null,
      });
    }
    await batch.commit();
    await writeAuditLog(
      actor,
      'story_restore',
      'stories',
      story.id,
      `Restored story "${story.title}" and ${episodeIds.length} episode(s) from Trash as draft`
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `stories/${story.id}`);
  }
}

export interface AdminEpisodeFormInput {
  id?: string;
  storyId: string;
  creatorOwnerUid: string;
  episodeNumber: number;
  title: string;
  titleHi: string;
  description: string;
  descriptionHi: string;
  durationSec: number;
  priceCoins: number;
  provider: 'demo' | 'drive';
  mediaId: string;
  mediaType: 'audio' | 'video';
  videoDriveId?: string;
}

export async function adminSaveEpisodeCms(
  user: User | null,
  actor: UserProfile,
  form: AdminEpisodeFormInput,
  isEdit: boolean
): Promise<{ id: string }> {
  const apiRes = await tryServerCmsApi(user, isEdit ? 'episode_update' : 'episode_create', {
    ...form,
  });
  if (apiRes.ok) {
    return { id: String(apiRes.data.id ?? form.id ?? '') };
  }
  if (!apiRes.fallbackAllowed) {
    throw new Error(apiRes.error || 'Could not save episode.');
  }

  const id = isEdit
    ? String(form.id)
    : `ep-${form.storyId.slice(0, 24)}-${Date.now().toString(36)}`;
  const title = form.title.trim().slice(0, 160);
  const titleHi = (form.titleHi.trim() || title).slice(0, 160);
  const mediaRef = {
    provider: form.provider,
    id: (form.mediaId.trim() || id).slice(0, 1024),
    type: form.mediaType,
  };
  const videoMediaRef = form.videoDriveId?.trim()
    ? { provider: 'drive' as const, id: form.videoDriveId.trim().slice(0, 1024), type: 'video' as const }
    : form.mediaType === 'video'
      ? mediaRef
      : undefined;

  try {
    if (isEdit) {
      const updatePayload: Record<string, unknown> = {
        episodeNumber: Math.max(1, Math.floor(form.episodeNumber)),
        title,
        titleHi,
        description: form.description.trim().slice(0, 600),
        descriptionHi: (form.descriptionHi.trim() || form.description.trim()).slice(0, 600),
        durationSec: Math.max(1, Math.floor(form.durationSec)),
        priceCoins: Math.max(0, Math.floor(form.priceCoins)),
        mediaRef,
      };
      if (videoMediaRef) updatePayload.videoMediaRef = videoMediaRef;
      await updateDoc(doc(db, 'episodes', id), updatePayload);
    } else {
      const createPayload: Record<string, unknown> = {
        id,
        storyId: form.storyId,
        creatorOwnerUid: form.creatorOwnerUid || actor.uid,
        episodeNumber: Math.max(1, Math.floor(form.episodeNumber)),
        title,
        titleHi,
        description: form.description.trim().slice(0, 600),
        descriptionHi: (form.descriptionHi.trim() || form.description.trim()).slice(0, 600),
        durationSec: Math.max(1, Math.floor(form.durationSec)),
        priceCoins: Math.max(0, Math.floor(form.priceCoins)),
        mediaRef,
        isDeleted: false,
        deletedAt: null,
        deletedByUid: null,
        publishedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      };
      if (videoMediaRef) createPayload.videoMediaRef = videoMediaRef;
      await setDoc(doc(db, 'episodes', id), createPayload);
    }
    await writeAuditLog(
      actor,
      isEdit ? 'episode_update' : 'episode_create',
      'episodes',
      id,
      `${isEdit ? 'Updated' : 'Created'} Episode ${form.episodeNumber} "${title}" (${form.priceCoins} coins)`
    );
    return { id };
  } catch (err) {
    handleFirestoreError(err, isEdit ? OperationType.UPDATE : OperationType.CREATE, `episodes/${id}`);
  }
}

export async function adminSoftDeleteEpisode(
  user: User | null,
  actor: UserProfile,
  episode: Episode
): Promise<void> {
  const apiRes = await tryServerCmsApi(user, 'episode_soft_delete', {
    id: episode.id,
    title: episode.title,
  });
  if (apiRes.ok) return;
  if (!apiRes.fallbackAllowed) throw new Error(apiRes.error || 'Episode soft-delete failed.');

  try {
    await updateDoc(doc(db, 'episodes', episode.id), {
      isDeleted: true,
      deletedAt: serverTimestamp(),
      deletedByUid: actor.uid,
    });
    await writeAuditLog(
      actor,
      'episode_soft_delete',
      'episodes',
      episode.id,
      `Moved Episode ${episode.episodeNumber} "${episode.title}" to Trash`
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `episodes/${episode.id}`);
  }
}

export async function adminRestoreEpisode(
  user: User | null,
  actor: UserProfile,
  episode: Episode
): Promise<void> {
  const apiRes = await tryServerCmsApi(user, 'episode_restore', {
    id: episode.id,
    title: episode.title,
  });
  if (apiRes.ok) return;
  if (!apiRes.fallbackAllowed) throw new Error(apiRes.error || 'Episode restore failed.');

  try {
    await updateDoc(doc(db, 'episodes', episode.id), {
      isDeleted: false,
      deletedAt: null,
      deletedByUid: null,
    });
    await writeAuditLog(
      actor,
      'episode_restore',
      'episodes',
      episode.id,
      `Restored Episode ${episode.episodeNumber} "${episode.title}" from Trash`
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `episodes/${episode.id}`);
  }
}

export interface AdminCreatorFormInput {
  id?: string;
  ownerUid: string;
  name: string;
  handle: string;
  bioEn: string;
  bioHi: string;
  language: ContentLanguage;
  verified: boolean;
  accentPalette: string;
}

export async function adminSaveCreatorCms(
  user: User | null,
  actor: UserProfile,
  form: AdminCreatorFormInput,
  isEdit: boolean
): Promise<{ id: string }> {
  const apiRes = await tryServerCmsApi(user, isEdit ? 'creator_update' : 'creator_create', {
    ...form,
  });
  if (apiRes.ok) {
    return { id: String(apiRes.data.id ?? form.id ?? '') };
  }
  if (!apiRes.fallbackAllowed) throw new Error(apiRes.error || 'Could not save creator.');

  const name = form.name.trim().slice(0, 100);
  const rawHandle = form.handle.trim();
  const handle = (rawHandle.startsWith('@') ? rawHandle : `@${rawHandle || slugify(name)}`).slice(0, 60);
  const id = isEdit
    ? String(form.id)
    : `creator-${slugify(name).slice(0, 28)}-${Date.now().toString(36)}`;

  try {
    if (isEdit) {
      await updateDoc(doc(db, 'creators', id), {
        name,
        handle,
        bioEn: form.bioEn.trim().slice(0, 400),
        bioHi: (form.bioHi.trim() || form.bioEn.trim()).slice(0, 400),
        language: form.language,
        verified: Boolean(form.verified),
        accentPalette: (form.accentPalette || '#E5A93C').slice(0, 40),
      });
    } else {
      await setDoc(doc(db, 'creators', id), {
        id,
        ownerUid: form.ownerUid.trim() || actor.uid,
        name,
        handle,
        bioEn: form.bioEn.trim().slice(0, 400),
        bioHi: (form.bioHi.trim() || form.bioEn.trim()).slice(0, 400),
        language: form.language,
        followersCount: 0,
        storiesCount: 0,
        verified: Boolean(form.verified),
        accentPalette: (form.accentPalette || '#E5A93C').slice(0, 40),
      });
    }
    await writeAuditLog(
      actor,
      isEdit ? 'creator_update' : 'creator_create',
      'creators',
      id,
      `${isEdit ? 'Updated' : 'Created'} creator "${name}" (${handle})`
    );
    return { id };
  } catch (err) {
    handleFirestoreError(err, isEdit ? OperationType.UPDATE : OperationType.CREATE, `creators/${id}`);
  }
}

export async function adminDeleteCreatorCms(
  user: User | null,
  actor: UserProfile,
  creator: Creator
): Promise<void> {
  const apiRes = await tryServerCmsApi(user, 'creator_delete', {
    id: creator.id,
    name: creator.name,
  });
  if (apiRes.ok) return;
  if (!apiRes.fallbackAllowed) throw new Error(apiRes.error || 'Could not delete creator.');

  try {
    await deleteDoc(doc(db, 'creators', creator.id));
    await writeAuditLog(
      actor,
      'creator_delete',
      'creators',
      creator.id,
      `Deleted creator profile "${creator.name}" (${creator.handle})`
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `creators/${creator.id}`);
  }
}

export async function adminUpdateUserDisplayName(
  user: User | null,
  actor: UserProfile,
  target: UserProfile,
  displayName: string,
  bio: string
): Promise<void> {
  const apiRes = await tryServerCmsApi(user, 'user_update', {
    uid: target.uid,
    displayName,
    bio,
  });
  if (apiRes.ok) return;
  if (!apiRes.fallbackAllowed) throw new Error(apiRes.error || 'Could not update user.');

  try {
    await updateDoc(doc(db, 'users', target.uid), {
      displayName: displayName.trim().slice(0, 80),
      bio: bio.trim().slice(0, 300),
      updatedAt: serverTimestamp(),
    });
    await writeAuditLog(
      actor,
      'user_profile_admin_update',
      'users',
      target.uid,
      `Updated user ${target.email || target.uid} displayName to "${displayName.trim().slice(0, 80)}"`
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users/${target.uid}`);
  }
}

export interface AnalyticsQueryParams {
  preset: AnalyticsDateRangePreset;
  granularity: AnalyticsTimeGranularity;
  from?: string;
  to?: string;
}

export interface AnalyticsFallbackContext {
  users: UserProfile[];
  wallets: CoinWallet[];
  stories: Story[];
  episodes: Episode[];
  creators: Creator[];
  categories: Category[];
}

export async function fetchAdminAnalyticsReport(
  user: User | null,
  params: AnalyticsQueryParams,
  fallback: AnalyticsFallbackContext
): Promise<AdminAnalyticsReport> {
  if (user) {
    try {
      const qs = new URLSearchParams({
        range: params.preset,
        granularity: params.granularity,
      });
      if (params.preset === 'custom' && params.from) qs.set('from', params.from);
      if (params.preset === 'custom' && params.to) qs.set('to', params.to);
      const headers = await getBearerHeaders(user);
      const res = await fetch(resolveApiUrl(`/api/admin/analytics?${qs.toString()}`), {
        method: 'GET',
        headers,
      });
      const contentType = res.headers.get('content-type') ?? '';
      if (res.ok && contentType.includes('application/json')) {
        const data = (await res.json()) as { report?: AdminAnalyticsReport };
        if (data.report) return data.report;
      }
    } catch {
      // Fall through to client-side Firestore Admin fallback for local Vite preview
    }
  }

  // Client-side Admin fallback (strictly protected by isAdmin() in firestore.rules)
  const [txSnap, histSnap] = await Promise.all([
    getDocs(query(collection(db, 'coinTransactions'), limit(2000))).catch(() => null),
    getDocs(query(collection(db, 'listeningHistory'), limit(2000))).catch(() => null),
  ]);

  const transactions: CoinTransaction[] = txSnap
    ? txSnap.docs.map((d) => {
        const raw = d.data();
        return {
          id: String(raw.id ?? d.id),
          uid: String(raw.uid ?? ''),
          type: (raw.type as CoinTransaction['type']) ?? 'admin_adjust',
          amount: Number(raw.amount ?? 0),
          balanceAfter: Number(raw.balanceAfter ?? 0),
          episodeId: typeof raw.episodeId === 'string' ? raw.episodeId : null,
          storyId: typeof raw.storyId === 'string' ? raw.storyId : null,
          creatorId: typeof raw.creatorId === 'string' ? raw.creatorId : null,
          createdAt: tsToMs(raw.createdAt),
          note: String(raw.note ?? ''),
        };
      })
    : [];

  const history: ListeningHistoryEntry[] = histSnap
    ? histSnap.docs.map((d) => {
        const raw = d.data();
        return {
          id: String(raw.id ?? d.id),
          userId: String(raw.userId ?? ''),
          storyId: String(raw.storyId ?? ''),
          episodeId: String(raw.episodeId ?? ''),
          episodeNumber: Number(raw.episodeNumber ?? 1),
          positionSec: Number(raw.positionSec ?? 0),
          durationSec: Number(raw.durationSec ?? 0),
          completed: Boolean(raw.completed),
          updatedAt: tsToMs(raw.updatedAt),
        };
      })
    : [];

  const customStartMs = params.from ? Date.parse(params.from) : null;
  const customEndMs = params.to ? Date.parse(`${params.to}T23:59:59.999Z`) : null;

  return computeAdminAnalyticsReport({
    source: 'client-fallback',
    transactions,
    history,
    wallets: fallback.wallets,
    users: fallback.users,
    stories: fallback.stories,
    episodes: fallback.episodes,
    creators: fallback.creators,
    categories: fallback.categories,
    preset: params.preset,
    granularity: params.granularity,
    customStartMs,
    customEndMs,
    pagination: {
      transactionsScanned: transactions.length,
      historyScanned: history.length,
      truncated: (txSnap?.size ?? 0) >= 2000 || (histSnap?.size ?? 0) >= 2000,
    },
  });
}

export async function fetchPerUserAnalyticsDetail(
  user: User | null,
  targetUid: string,
  params: AnalyticsQueryParams,
  fallback: AnalyticsFallbackContext
): Promise<PerUserAnalyticsDetail> {
  if (user) {
    try {
      const qs = new URLSearchParams({
        userId: targetUid,
        range: params.preset,
      });
      if (params.preset === 'custom' && params.from) qs.set('from', params.from);
      if (params.preset === 'custom' && params.to) qs.set('to', params.to);
      const headers = await getBearerHeaders(user);
      const res = await fetch(resolveApiUrl(`/api/admin/analytics?${qs.toString()}`), {
        method: 'GET',
        headers,
      });
      const contentType = res.headers.get('content-type') ?? '';
      if (res.ok && contentType.includes('application/json')) {
        const data = (await res.json()) as { userDetail?: PerUserAnalyticsDetail };
        if (data.userDetail) return data.userDetail;
      }
    } catch {
      // Fall through to client-side Firestore Admin fallback
    }
  }

  const targetUser = fallback.users.find((u) => u.uid === targetUid);
  if (!targetUser) {
    throw new Error('User not found.');
  }
  const targetWallet = fallback.wallets.find((w) => w.uid === targetUid) ?? null;

  const [txSnap, histSnap, sessSnap] = await Promise.all([
    getDocs(query(collection(db, 'coinTransactions'), where('uid', '==', targetUid), limit(500))).catch(() => null),
    getDocs(query(collection(db, 'listeningHistory'), where('userId', '==', targetUid), limit(500))).catch(() => null),
    getDocs(query(collection(db, 'sessions'), where('uid', '==', targetUid), limit(200))).catch(() => null),
  ]);

  const transactions: CoinTransaction[] = txSnap
    ? txSnap.docs.map((d) => {
        const raw = d.data();
        return {
          id: String(raw.id ?? d.id),
          uid: String(raw.uid ?? targetUid),
          type: (raw.type as CoinTransaction['type']) ?? 'admin_adjust',
          amount: Number(raw.amount ?? 0),
          balanceAfter: Number(raw.balanceAfter ?? 0),
          episodeId: typeof raw.episodeId === 'string' ? raw.episodeId : null,
          storyId: typeof raw.storyId === 'string' ? raw.storyId : null,
          creatorId: typeof raw.creatorId === 'string' ? raw.creatorId : null,
          createdAt: tsToMs(raw.createdAt),
          note: String(raw.note ?? ''),
        };
      })
    : [];

  const history: ListeningHistoryEntry[] = histSnap
    ? histSnap.docs.map((d) => {
        const raw = d.data();
        return {
          id: String(raw.id ?? d.id),
          userId: String(raw.userId ?? targetUid),
          storyId: String(raw.storyId ?? ''),
          episodeId: String(raw.episodeId ?? ''),
          episodeNumber: Number(raw.episodeNumber ?? 1),
          positionSec: Number(raw.positionSec ?? 0),
          durationSec: Number(raw.durationSec ?? 0),
          completed: Boolean(raw.completed),
          updatedAt: tsToMs(raw.updatedAt),
        };
      })
    : [];

  const sessions: SessionLogEntry[] = sessSnap
    ? sessSnap.docs.map((d) => {
        const raw = d.data();
        return {
          id: String(raw.id ?? d.id),
          uid: String(raw.uid ?? targetUid),
          deviceId: typeof raw.deviceId === 'string' ? raw.deviceId : null,
          deviceInfo: raw.deviceInfo && typeof raw.deviceInfo === 'object' ? (raw.deviceInfo as SessionLogEntry['deviceInfo']) : null,
          eventType: (raw.eventType as SessionLogEntry['eventType']) ?? 'login_registered',
          warningCountAfter: Number(raw.warningCountAfter ?? 0),
          bannedAfter: Boolean(raw.bannedAfter),
          note: String(raw.note ?? ''),
          createdAt: tsToMs(raw.createdAt),
        };
      })
    : [];

  const customStartMs = params.from ? Date.parse(params.from) : null;
  const customEndMs = params.to ? Date.parse(`${params.to}T23:59:59.999Z`) : null;
  const { startMs, endMs } = resolveDateRangeBounds(params.preset, Date.now(), customStartMs, customEndMs);

  return computePerUserAnalytics({
    user: targetUser,
    wallet: targetWallet,
    transactions,
    history,
    sessions,
    stories: fallback.stories,
    episodes: fallback.episodes,
    startMs,
    endMs,
  });
}
