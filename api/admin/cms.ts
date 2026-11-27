import crypto from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { FieldValue } from 'firebase-admin/firestore';
import type { AuditActionType, ContentLanguage, CoverTheme, StoryFormat, StoryVisibility } from '../../src/types';
import { sanitizeSafeUrl, sanitizeSiteSettings } from '../../src/services/siteSettings/siteSettingsPure';
import { applyCorsHeaders } from '../_lib/cors';
import {
  AuthVerificationError,
  getAdminDb,
  ServerConfigError,
  verifyFirebaseBearerToken,
} from '../_lib/firebaseAdmin';
import { isValidFirestoreDocId } from '../_lib/firestoreModels';

const BOOTSTRAP_ADMIN_EMAIL = 'vaishushroff@gmail.com';

function parseBody(req: VercelRequest): Record<string, unknown> {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return req.body as Record<string, unknown>;
}

function slugifyId(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'item'
  );
}

async function isAdminActor(uid: string, email: string | undefined): Promise<boolean> {
  if (email && email.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL) return true;
  const db = getAdminDb();
  const [adminSnap, userSnap] = await Promise.all([
    db.collection('admins').doc(uid).get(),
    db.collection('users').doc(uid).get(),
  ]);
  return adminSnap.exists || userSnap.data()?.role === 'admin';
}

function buildAuditEntry(
  actorUid: string,
  actorEmail: string,
  action: AuditActionType,
  targetCollection: string,
  targetId: string,
  summary: string
) {
  const id = `audit_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  return {
    id,
    data: {
      id,
      actorUid,
      actorEmail: actorEmail.slice(0, 200),
      action,
      targetCollection: targetCollection.slice(0, 64),
      targetId: targetId.slice(0, 128),
      summary: summary.trim().slice(0, 400),
      createdAt: FieldValue.serverTimestamp(),
    },
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCorsHeaders(req, res)) return;
  res.setHeader('Cache-Control', 'private, no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ code: 'method_not_allowed', error: 'Use POST /api/admin/cms.' });
    return;
  }

  try {
    const decoded = await verifyFirebaseBearerToken(req.headers.authorization, {
      required: true,
    });
    const actorUid = decoded!.uid;
    const actorEmail = decoded!.email ?? `${actorUid}@dhruvtales.local`;

    const isAdmin = await isAdminActor(actorUid, decoded!.email);
    if (!isAdmin) {
      res.status(403).json({
        code: 'admin_only',
        error: 'Only Administrators can modify site content and settings.',
      });
      return;
    }

    const body = parseBody(req);
    const action = typeof body.action === 'string' ? body.action.trim() : '';
    const payload =
      body.payload && typeof body.payload === 'object'
        ? (body.payload as Record<string, unknown>)
        : {};
    const db = getAdminDb();

    // 1. Save Site Settings (branding, colors, banners, homepage sections, languages, footer, legal)
    if (action === 'site_settings_save') {
      const sanitized = sanitizeSiteSettings(payload.settings);
      const summary =
        typeof payload.summary === 'string' && payload.summary.trim()
          ? payload.summary.trim()
          : 'Updated site settings, homepage layout, branding, or legal content';
      const audit = buildAuditEntry(
        actorUid,
        actorEmail,
        'site_settings_update',
        'siteSettings',
        'main',
        summary
      );
      const batch = db.batch();
      batch.set(db.collection('siteSettings').doc('main'), {
        ...sanitized,
        updatedByUid: actorUid,
        updatedAt: FieldValue.serverTimestamp(),
      });
      batch.set(db.collection('auditLogs').doc(audit.id), audit.data);
      await batch.commit();
      res.status(200).json({ ok: true, settings: { ...sanitized, updatedAt: Date.now(), updatedByUid: actorUid }, auditId: audit.id });
      return;
    }

    // 2. Story Create / Update
    if (action === 'story_create' || action === 'story_update') {
      const isEdit = action === 'story_update';
      const title = String(payload.title ?? '').trim().slice(0, 140);
      const titleHi = (String(payload.titleHi ?? '').trim() || title).slice(0, 140);
      const synopsis = String(payload.synopsis ?? '').trim().slice(0, 1200);
      const synopsisHi = (String(payload.synopsisHi ?? '').trim() || synopsis).slice(0, 1200);
      if (!title || !synopsis) {
        res.status(400).json({ code: 'invalid_story', error: 'Title and synopsis are required.' });
        return;
      }

      const id = isEdit
        ? String(payload.id ?? '').trim()
        : `story-${slugifyId(title)}-${crypto.randomBytes(2).toString('hex')}`;
      if (!isValidFirestoreDocId(id)) {
        res.status(400).json({ code: 'invalid_id', error: 'Invalid story ID.' });
        return;
      }

      const genreId = String(payload.genreId ?? 'mythology').trim().slice(0, 64);
      const creatorId = String(payload.creatorId ?? 'creator-admin').trim().slice(0, 64);
      const creatorName = String(payload.creatorName ?? 'Dhruv Tales Studio').trim().slice(0, 100);
      const creatorOwnerUid = String(payload.creatorOwnerUid ?? actorUid).trim().slice(0, 128);
      const language = (['en', 'hi', 'bilingual'].includes(String(payload.language))
        ? payload.language
        : 'bilingual') as ContentLanguage;
      const visibility = (['published', 'draft', 'archived'].includes(String(payload.visibility))
        ? payload.visibility
        : 'published') as StoryVisibility;
      const format = (['audio', 'video', 'hybrid'].includes(String(payload.format))
        ? payload.format
        : 'audio') as StoryFormat;
      const coverTheme = String(payload.coverTheme ?? 'mythology-gold').slice(0, 40) as CoverTheme;
      const coverUrl = sanitizeSafeUrl(payload.coverUrl);
      const priceOverrideCoins =
        payload.priceOverrideCoins === null ||
        payload.priceOverrideCoins === '' ||
        payload.priceOverrideCoins === undefined
          ? null
          : Math.max(0, Math.min(100_000, Math.floor(Number(payload.priceOverrideCoins) || 0)));

      const storyRef = db.collection('stories').doc(id);
      const batch = db.batch();
      if (isEdit) {
        batch.update(storyRef, {
          title,
          titleHi,
          synopsis,
          synopsisHi,
          genreId,
          language,
          creatorId,
          creatorName,
          coverTheme,
          coverUrl,
          visibility,
          format,
          isInteractive: Boolean(payload.isInteractive),
          isTrending: Boolean(payload.isTrending),
          isEditorsPick: Boolean(payload.isEditorsPick),
          isPopular: Boolean(payload.isPopular),
          isFeatured: Boolean(payload.isFeatured),
          priceOverrideCoins,
          updatedAt: FieldValue.serverTimestamp(),
        });
      } else {
        batch.set(storyRef, {
          id,
          slug: slugifyId(title),
          title,
          titleHi,
          synopsis,
          synopsisHi,
          genreId,
          language,
          creatorId,
          creatorOwnerUid,
          creatorName,
          coverUrl,
          coverTheme,
          rating: 4.8,
          totalPlays: 0,
          episodeCount: 0,
          isTrending: Boolean(payload.isTrending),
          isEditorsPick: Boolean(payload.isEditorsPick),
          isPopular: Boolean(payload.isPopular),
          isFeatured: Boolean(payload.isFeatured),
          visibility,
          format,
          isInteractive: Boolean(payload.isInteractive),
          priceOverrideCoins,
          isDeleted: false,
          deletedAt: null,
          deletedByUid: null,
          publishedAt: FieldValue.serverTimestamp(),
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      const audit = buildAuditEntry(
        actorUid,
        actorEmail,
        isEdit ? 'story_update' : 'story_create',
        'stories',
        id,
        `${isEdit ? 'Updated' : 'Created'} story "${title}" (${visibility})`
      );
      batch.set(db.collection('auditLogs').doc(audit.id), audit.data);
      await batch.commit();
      res.status(200).json({ ok: true, id, auditId: audit.id });
      return;
    }

    // 3. Story Soft-Delete / Restore / Hard-Delete
    if (
      action === 'story_soft_delete' ||
      action === 'story_restore' ||
      action === 'story_hard_delete'
    ) {
      const id = String(payload.id ?? '').trim();
      const title = String(payload.title ?? id).trim().slice(0, 140);
      if (!isValidFirestoreDocId(id)) {
        res.status(400).json({ code: 'invalid_id', error: 'Invalid story ID.' });
        return;
      }
      const batch = db.batch();
      const storyRef = db.collection('stories').doc(id);

      if (action === 'story_soft_delete') {
        batch.update(storyRef, {
          isDeleted: true,
          visibility: 'archived',
          deletedAt: FieldValue.serverTimestamp(),
          deletedByUid: actorUid,
          updatedAt: FieldValue.serverTimestamp(),
        });
        const epSnap = await db.collection('episodes').where('storyId', '==', id).get();
        epSnap.docs.forEach((d) => {
          batch.update(d.ref, {
            isDeleted: true,
            deletedAt: FieldValue.serverTimestamp(),
            deletedByUid: actorUid,
          });
        });
        const audit = buildAuditEntry(
          actorUid,
          actorEmail,
          'story_soft_delete',
          'stories',
          id,
          `Moved story "${title}" and ${epSnap.size} episode(s) to Trash (restorable)`
        );
        batch.set(db.collection('auditLogs').doc(audit.id), audit.data);
        await batch.commit();
        res.status(200).json({ ok: true, id, auditId: audit.id });
        return;
      }

      if (action === 'story_restore') {
        batch.update(storyRef, {
          isDeleted: false,
          visibility: 'draft',
          deletedAt: null,
          deletedByUid: null,
          updatedAt: FieldValue.serverTimestamp(),
        });
        const epSnap = await db.collection('episodes').where('storyId', '==', id).get();
        epSnap.docs.forEach((d) => {
          batch.update(d.ref, {
            isDeleted: false,
            deletedAt: null,
            deletedByUid: null,
          });
        });
        const audit = buildAuditEntry(
          actorUid,
          actorEmail,
          'story_restore',
          'stories',
          id,
          `Restored story "${title}" and ${epSnap.size} episode(s) from Trash as draft`
        );
        batch.set(db.collection('auditLogs').doc(audit.id), audit.data);
        await batch.commit();
        res.status(200).json({ ok: true, id, auditId: audit.id });
        return;
      }

      // Permanent hard delete
      const epSnap = await db.collection('episodes').where('storyId', '==', id).get();
      epSnap.docs.forEach((d) => batch.delete(d.ref));
      batch.delete(storyRef);
      const audit = buildAuditEntry(
        actorUid,
        actorEmail,
        'story_delete',
        'stories',
        id,
        `Permanently deleted story "${title}" and ${epSnap.size} episode(s)`
      );
      batch.set(db.collection('auditLogs').doc(audit.id), audit.data);
      await batch.commit();
      res.status(200).json({ ok: true, id, auditId: audit.id });
      return;
    }

    // 4. Episode Create / Update / Soft-Delete / Restore / Hard-Delete
    if (
      action === 'episode_create' ||
      action === 'episode_update' ||
      action === 'episode_soft_delete' ||
      action === 'episode_restore' ||
      action === 'episode_hard_delete'
    ) {
      const batch = db.batch();
      if (action === 'episode_create' || action === 'episode_update') {
        const isEdit = action === 'episode_update';
        const storyId = String(payload.storyId ?? '').trim();
        const title = String(payload.title ?? '').trim().slice(0, 160);
        const titleHi = (String(payload.titleHi ?? '').trim() || title).slice(0, 160);
        if (!isValidFirestoreDocId(storyId) || !title) {
          res.status(400).json({ code: 'invalid_episode', error: 'storyId and title are required.' });
          return;
        }
        const id = isEdit
          ? String(payload.id ?? '').trim()
          : `ep-${storyId.slice(0, 24)}-${crypto.randomBytes(3).toString('hex')}`;
        if (!isValidFirestoreDocId(id)) {
          res.status(400).json({ code: 'invalid_id', error: 'Invalid episode ID.' });
          return;
        }
        const episodeNumber = Math.max(1, Math.min(500, Math.floor(Number(payload.episodeNumber) || 1)));
        const durationSec = Math.max(10, Math.min(86400, Math.floor(Number(payload.durationSec) || 180)));
        const priceCoins = Math.max(0, Math.min(100_000, Math.floor(Number(payload.priceCoins) || 0)));
        const description = String(payload.description ?? '').trim().slice(0, 600);
        const descriptionHi = (String(payload.descriptionHi ?? '').trim() || description).slice(0, 600);
        const provider = payload.provider === 'drive' ? 'drive' : 'demo';
        const mediaId = String(payload.mediaId ?? id).trim().slice(0, 160) || id;
        const mediaType = payload.mediaType === 'video' ? 'video' : 'audio';
        const videoDriveId = typeof payload.videoDriveId === 'string' ? payload.videoDriveId.trim().slice(0, 160) : '';

        const mediaRef = { provider, id: mediaId, type: mediaType };
        const videoMediaRef = videoDriveId
          ? { provider: 'drive', id: videoDriveId, type: 'video' }
          : mediaType === 'video'
            ? mediaRef
            : undefined;

        const epRef = db.collection('episodes').doc(id);
        if (isEdit) {
          const updateData: Record<string, unknown> = {
            episodeNumber,
            title,
            titleHi,
            description,
            descriptionHi,
            durationSec,
            priceCoins,
            mediaRef,
          };
          if (videoMediaRef) updateData.videoMediaRef = videoMediaRef;
          batch.update(epRef, updateData);
        } else {
          const storySnap = await db.collection('stories').doc(storyId).get();
          const creatorOwnerUid = String(storySnap.data()?.creatorOwnerUid ?? actorUid);
          const createData: Record<string, unknown> = {
            id,
            storyId,
            creatorOwnerUid,
            episodeNumber,
            title,
            titleHi,
            description,
            descriptionHi,
            durationSec,
            priceCoins,
            mediaRef,
            isDeleted: false,
            deletedAt: null,
            deletedByUid: null,
            publishedAt: FieldValue.serverTimestamp(),
            createdAt: FieldValue.serverTimestamp(),
          };
          if (videoMediaRef) createData.videoMediaRef = videoMediaRef;
          batch.set(epRef, createData);
          if (storySnap.exists) {
            batch.update(storySnap.ref, {
              episodeCount: FieldValue.increment(1),
              updatedAt: FieldValue.serverTimestamp(),
            });
          }
        }

        const audit = buildAuditEntry(
          actorUid,
          actorEmail,
          isEdit ? 'episode_update' : 'episode_create',
          'episodes',
          id,
          `${isEdit ? 'Updated' : 'Created'} Episode ${episodeNumber} "${title}" (${priceCoins} coins)`
        );
        batch.set(db.collection('auditLogs').doc(audit.id), audit.data);
        await batch.commit();
        res.status(200).json({ ok: true, id, auditId: audit.id });
        return;
      }

      const id = String(payload.id ?? '').trim();
      const title = String(payload.title ?? id).trim().slice(0, 160);
      if (!isValidFirestoreDocId(id)) {
        res.status(400).json({ code: 'invalid_id', error: 'Invalid episode ID.' });
        return;
      }
      const epRef = db.collection('episodes').doc(id);

      if (action === 'episode_soft_delete') {
        batch.update(epRef, {
          isDeleted: true,
          deletedAt: FieldValue.serverTimestamp(),
          deletedByUid: actorUid,
        });
        const audit = buildAuditEntry(
          actorUid,
          actorEmail,
          'episode_soft_delete',
          'episodes',
          id,
          `Moved episode "${title}" to Trash (restorable)`
        );
        batch.set(db.collection('auditLogs').doc(audit.id), audit.data);
        await batch.commit();
        res.status(200).json({ ok: true, id, auditId: audit.id });
        return;
      }

      if (action === 'episode_restore') {
        batch.update(epRef, {
          isDeleted: false,
          deletedAt: null,
          deletedByUid: null,
        });
        const audit = buildAuditEntry(
          actorUid,
          actorEmail,
          'episode_restore',
          'episodes',
          id,
          `Restored episode "${title}" from Trash`
        );
        batch.set(db.collection('auditLogs').doc(audit.id), audit.data);
        await batch.commit();
        res.status(200).json({ ok: true, id, auditId: audit.id });
        return;
      }

      batch.delete(epRef);
      const audit = buildAuditEntry(
        actorUid,
        actorEmail,
        'episode_delete',
        'episodes',
        id,
        `Permanently deleted episode "${title}"`
      );
      batch.set(db.collection('auditLogs').doc(audit.id), audit.data);
      await batch.commit();
      res.status(200).json({ ok: true, id, auditId: audit.id });
      return;
    }

    // 5. Creator Create / Update / Delete
    if (action === 'creator_create' || action === 'creator_update' || action === 'creator_delete') {
      const batch = db.batch();
      if (action === 'creator_delete') {
        const id = String(payload.id ?? '').trim();
        const name = String(payload.name ?? id).trim().slice(0, 100);
        if (!isValidFirestoreDocId(id)) {
          res.status(400).json({ code: 'invalid_id', error: 'Invalid creator ID.' });
          return;
        }
        batch.delete(db.collection('creators').doc(id));
        const audit = buildAuditEntry(
          actorUid,
          actorEmail,
          'creator_delete',
          'creators',
          id,
          `Deleted creator profile "${name}" (${id})`
        );
        batch.set(db.collection('auditLogs').doc(audit.id), audit.data);
        await batch.commit();
        res.status(200).json({ ok: true, id, auditId: audit.id });
        return;
      }

      const isEdit = action === 'creator_update';
      const name = String(payload.name ?? '').trim().slice(0, 100);
      const rawHandle = String(payload.handle ?? '').trim();
      const handle = (rawHandle.startsWith('@') ? rawHandle : `@${rawHandle || slugifyId(name)}`).slice(0, 60);
      if (!name) {
        res.status(400).json({ code: 'invalid_creator', error: 'Creator name is required.' });
        return;
      }
      const id = isEdit
        ? String(payload.id ?? '').trim()
        : `creator-${slugifyId(name)}-${crypto.randomBytes(2).toString('hex')}`;
      if (!isValidFirestoreDocId(id)) {
        res.status(400).json({ code: 'invalid_id', error: 'Invalid creator ID.' });
        return;
      }
      const language = (['en', 'hi', 'bilingual'].includes(String(payload.language))
        ? payload.language
        : 'bilingual') as ContentLanguage;
      const bioEn = String(payload.bioEn ?? '').trim().slice(0, 400);
      const bioHi = (String(payload.bioHi ?? '').trim() || bioEn).slice(0, 400);
      const ownerUid = String(payload.ownerUid ?? actorUid).trim().slice(0, 128) || actorUid;
      const accentPalette = String(payload.accentPalette ?? '#E5A93C').trim().slice(0, 40);

      const creatorRef = db.collection('creators').doc(id);
      if (isEdit) {
        batch.update(creatorRef, {
          name,
          handle,
          bioEn,
          bioHi,
          language,
          verified: Boolean(payload.verified),
          accentPalette,
        });
      } else {
        batch.set(creatorRef, {
          id,
          ownerUid,
          name,
          handle,
          bioEn,
          bioHi,
          language,
          followersCount: 0,
          storiesCount: 0,
          verified: Boolean(payload.verified),
          accentPalette,
        });
      }

      const audit = buildAuditEntry(
        actorUid,
        actorEmail,
        isEdit ? 'creator_update' : 'creator_create',
        'creators',
        id,
        `${isEdit ? 'Updated' : 'Created'} creator "${name}" (${handle})`
      );
      batch.set(db.collection('auditLogs').doc(audit.id), audit.data);
      await batch.commit();
      res.status(200).json({ ok: true, id, auditId: audit.id });
      return;
    }

    // 6. Admin User Profile Edit (displayName / bio)
    if (action === 'user_update') {
      const targetUid = String(payload.uid ?? '').trim();
      const displayName = String(payload.displayName ?? '').trim().slice(0, 80);
      const bio = String(payload.bio ?? '').trim().slice(0, 300);
      if (!isValidFirestoreDocId(targetUid) || !displayName) {
        res.status(400).json({ code: 'invalid_user', error: 'Valid uid and displayName are required.' });
        return;
      }
      const batch = db.batch();
      batch.update(db.collection('users').doc(targetUid), {
        displayName,
        bio,
        updatedAt: FieldValue.serverTimestamp(),
      });
      const audit = buildAuditEntry(
        actorUid,
        actorEmail,
        'user_profile_admin_update',
        'users',
        targetUid,
        `Updated user profile (${targetUid}) displayName to "${displayName}"`
      );
      batch.set(db.collection('auditLogs').doc(audit.id), audit.data);
      await batch.commit();
      res.status(200).json({ ok: true, uid: targetUid, auditId: audit.id });
      return;
    }

    res.status(400).json({ code: 'unknown_action', error: `Unsupported CMS action "${action}".` });
  } catch (err) {
    if (err instanceof AuthVerificationError) {
      res.status(err.status).json({ code: err.code, error: err.message });
      return;
    }
    if (err instanceof ServerConfigError) {
      res.status(err.status).json({ code: err.code, error: err.message });
      return;
    }
    console.error('[api/admin/cms] Unexpected error:', err);
    res.status(500).json({
      code: 'internal_error',
      error: 'Unable to save CMS change right now.',
    });
  }
}
