import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import type {
  ContentLanguage,
  CoverTheme,
  Creator,
  CreatorRequest,
  Episode,
  EpisodeChoicePoint,
  ListeningHistoryEntry,
  MediaRef,
  Story,
  StoryFormat,
  StoryVisibility,
  UserProfile,
  UserRole,
} from '../../types';
import { validateOptionalUrl } from '../../utils/validation';
import { buildEpisodeEditFields, slugify } from '../studio/studioAnalytics';
import { db, handleFirestoreError, OperationType } from './config';

function tsToIso(val: unknown): string {
  if (val instanceof Timestamp) return val.toDate().toISOString();
  if (typeof val === 'string') return val;
  return new Date().toISOString();
}

function tsToMs(val: unknown): number {
  if (val instanceof Timestamp) return val.toMillis();
  if (typeof val === 'number') return val;
  return Date.now();
}

export interface CreatorStoryInput {
  id?: string;
  title: string;
  titleHi: string;
  synopsis: string;
  synopsisHi: string;
  genreId: string;
  language: ContentLanguage;
  coverTheme: CoverTheme;
  coverUrl?: string;
  visibility: StoryVisibility;
  format: StoryFormat;
  isInteractive: boolean;
}

export interface CreatorEpisodeInput {
  id?: string;
  storyId: string;
  episodeNumber: number;
  title: string;
  titleHi: string;
  description: string;
  descriptionHi: string;
  durationSec: number;
  priceCoins: number;
  audioRef: MediaRef;
  videoMediaRef?: MediaRef | null;
  choicePoint?: EpisodeChoicePoint | null;
  isEnding?: boolean;
}

export async function fetchCreatorOwnStories(ownerUid: string): Promise<Story[]> {
  try {
    const snap = await getDocs(
      query(collection(db, 'stories'), where('creatorOwnerUid', '==', ownerUid))
    );
    return snap.docs.map((d) => {
      const raw = d.data() as Story;
      return {
        ...raw,
        publishedAt: tsToIso(raw.publishedAt),
        createdAt: tsToIso(raw.createdAt),
        updatedAt: tsToIso(raw.updatedAt),
      };
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, `stories(creatorOwnerUid=${ownerUid})`);
  }
}

export async function fetchCreatorAnalyticsHistory(
  ownerUid: string
): Promise<ListeningHistoryEntry[]> {
  try {
    const snap = await getDocs(
      query(collection(db, 'listeningHistory'), where('storyOwnerUid', '==', ownerUid))
    );
    return snap.docs.map((d) => {
      const raw = d.data();
      return {
        id: String(raw.id),
        userId: String(raw.userId),
        storyId: String(raw.storyId),
        storyOwnerUid: raw.storyOwnerUid ? String(raw.storyOwnerUid) : undefined,
        episodeId: String(raw.episodeId),
        episodeNumber: Number(raw.episodeNumber),
        positionSec: Number(raw.positionSec),
        durationSec: Number(raw.durationSec),
        completed: Boolean(raw.completed),
        updatedAt: tsToMs(raw.updatedAt),
      };
    });
  } catch (error) {
    console.warn('Creator analytics listeningHistory query skipped:', error);
    return [];
  }
}

export async function saveCreatorStoryToFirestore(
  input: CreatorStoryInput,
  ownerUid: string,
  creator: Creator
): Promise<Story> {
  const title = input.title.trim().slice(0, 140);
  const titleHi = (input.titleHi.trim() || title).slice(0, 140);
  const synopsis = input.synopsis.trim().slice(0, 1200);
  const synopsisHi = (input.synopsisHi.trim() || synopsis).slice(0, 1200);
  const isEdit = Boolean(input.id);
  const id = input.id ?? `story-${slugify(title).slice(0, 32)}-${Date.now().toString(36)}`;
  const slug = slugify(title).slice(0, 80);
  const ref = doc(db, 'stories', id);

  try {
    if (isEdit) {
      const updates: Record<string, unknown> = {
        title,
        titleHi,
        synopsis,
        synopsisHi,
        genreId: input.genreId,
        language: input.language,
        coverTheme: input.coverTheme,
        visibility: input.visibility === 'archived' ? 'draft' : input.visibility,
        format: input.format,
        isInteractive: input.isInteractive,
        updatedAt: serverTimestamp(),
      };
      if (input.coverUrl && input.coverUrl.trim()) {
        const checkedUrl = validateOptionalUrl(input.coverUrl, true);
        if (!checkedUrl.valid) {
          throw new Error(checkedUrl.error ?? 'Invalid cover image URL.');
        }
        if (checkedUrl.sanitized) {
          updates.coverUrl = checkedUrl.sanitized;
        }
      }
      await updateDoc(ref, updates);
      const snap = await getDoc(ref);
      const saved = snap.data() as Story;
      return {
        ...saved,
        publishedAt: tsToIso(saved.publishedAt),
        createdAt: tsToIso(saved.createdAt),
        updatedAt: tsToIso(saved.updatedAt),
      };
    }

    const nowIso = new Date().toISOString();
    const payload: Record<string, unknown> = {
      id,
      slug,
      title,
      titleHi,
      synopsis,
      synopsisHi,
      genreId: input.genreId,
      language: input.language,
      creatorId: creator.id,
      creatorOwnerUid: ownerUid,
      creatorName: creator.name.slice(0, 100),
      coverTheme: input.coverTheme,
      rating: 4.5,
      totalPlays: 0,
      episodeCount: 0,
      isTrending: false,
      isEditorsPick: false,
      isPopular: false,
      isFeatured: false,
      visibility: input.visibility === 'published' ? 'published' : 'draft',
      format: input.format,
      isInteractive: input.isInteractive,
      publishedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (input.coverUrl && input.coverUrl.trim()) {
      const checkedUrl = validateOptionalUrl(input.coverUrl, true);
      if (!checkedUrl.valid) {
        throw new Error(checkedUrl.error ?? 'Invalid cover image URL.');
      }
      if (checkedUrl.sanitized) {
        payload.coverUrl = checkedUrl.sanitized;
      }
    }
    await setDoc(ref, payload);

    return {
      id,
      slug,
      title,
      titleHi,
      synopsis,
      synopsisHi,
      genreId: input.genreId,
      language: input.language,
      creatorId: creator.id,
      creatorOwnerUid: ownerUid,
      creatorName: creator.name,
      coverUrl: input.coverUrl?.trim() || undefined,
      coverTheme: input.coverTheme,
      rating: 4.5,
      totalPlays: 0,
      episodeCount: 0,
      isTrending: false,
      isEditorsPick: false,
      isPopular: false,
      isFeatured: false,
      visibility: input.visibility === 'published' ? 'published' : 'draft',
      format: input.format,
      isInteractive: input.isInteractive,
      publishedAt: nowIso,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
  } catch (error) {
    handleFirestoreError(error, isEdit ? OperationType.UPDATE : OperationType.CREATE, `stories/${id}`);
  }
}

export async function deleteCreatorStoryFromFirestore(
  storyId: string,
  episodeIds: string[]
): Promise<void> {
  try {
    const batch = writeBatch(db);
    for (const epId of episodeIds) {
      batch.delete(doc(db, 'episodes', epId));
    }
    batch.delete(doc(db, 'stories', storyId));
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `stories/${storyId}`);
  }
}

export async function saveCreatorEpisodeToFirestore(
  input: CreatorEpisodeInput,
  ownerUid: string,
  totalEpisodesAfterSave: number,
  storyHasAnyVideo: boolean,
  storyHasAnyChoice: boolean,
  actorRole: UserRole = 'creator'
): Promise<Episode> {
  const isEdit = Boolean(input.id);
  const title = input.title.trim().slice(0, 160);
  const titleHi = (input.titleHi.trim() || title).slice(0, 160);
  const description = input.description.trim().slice(0, 600);
  const descriptionHi = (input.descriptionHi.trim() || description).slice(0, 600);
  const durationSec = Math.max(1, Math.min(86400, Math.round(input.durationSec)));
  const requestedPriceCoins = Math.max(0, Math.min(100_000, Math.floor(Number(input.priceCoins) || 0)));
  const id = input.id ?? `ep-${slugify(input.storyId).slice(0, 24)}-${Date.now().toString(36)}`;
  const ref = doc(db, 'episodes', id);

  try {
    const cleanAudioRef: MediaRef = {
      provider: input.audioRef.provider,
      id: input.audioRef.id.slice(0, 1024),
      type: 'audio',
    };

    const payload: Record<string, unknown> = {
      episodeNumber: Math.max(1, Math.min(1000, Math.round(input.episodeNumber))),
      title,
      titleHi,
      description,
      descriptionHi,
      durationSec,
      priceCoins: requestedPriceCoins,
      mediaRef: cleanAudioRef,
      audioRef: cleanAudioRef,
      isEnding: Boolean(input.isEnding),
    };

    if (input.videoMediaRef) {
      payload.videoMediaRef = {
        provider: input.videoMediaRef.provider,
        id: input.videoMediaRef.id.slice(0, 1024),
        type: 'video',
      };
    }

    if (input.choicePoint) {
      payload.choicePoint = {
        id: input.choicePoint.id,
        ...(input.choicePoint.triggerAtEnd
          ? { triggerAtEnd: true }
          : {
              triggerAtSec: Math.max(
                1,
                Math.min(durationSec, Math.round(input.choicePoint.triggerAtSec ?? 20))
              ),
              triggerAtEnd: false,
            }),
        promptEn: input.choicePoint.promptEn.trim().slice(0, 300),
        promptHi: (input.choicePoint.promptHi.trim() || input.choicePoint.promptEn.trim()).slice(
          0,
          300
        ),
        options: input.choicePoint.options.slice(0, 3).map((o) => ({
          id: o.id,
          labelEn: o.labelEn.trim().slice(0, 120),
          labelHi: (o.labelHi.trim() || o.labelEn.trim()).slice(0, 120),
          ...(o.taglineEn?.trim() ? { taglineEn: o.taglineEn.trim().slice(0, 160) } : {}),
          ...(o.taglineHi?.trim() ? { taglineHi: o.taglineHi.trim().slice(0, 160) } : {}),
          nextEpisodeId: o.nextEpisodeId,
        })),
      };
    }

    let finalPriceCoins = requestedPriceCoins;

    if (isEdit) {
      // Creators CANNOT change priceCoins after initial upload (enforced here AND in firestore.rules)
      const existingSnap = await getDoc(ref);
      const existingData = existingSnap.data() as Record<string, unknown> | undefined;
      const existingPrice =
        typeof existingData?.priceCoins === 'number'
          ? Math.max(0, Math.floor(existingData.priceCoins))
          : 0;
      if (actorRole !== 'admin') {
        finalPriceCoins = existingPrice;
        payload.priceCoins = existingPrice;
      }

      if (existingSnap.exists() && existingData) {
        // Use updateDoc so immutable/soft-delete fields (createdAt, publishedAt, isDeleted, deletedAt, deletedByUid) stay intact
        const updateFields = buildEpisodeEditFields({
          payload,
          existingData,
          deleteMarker: deleteField(),
        });
        await updateDoc(ref, updateFields);
      } else {
        const fullDoc: Record<string, unknown> = {
          id,
          storyId: input.storyId,
          creatorOwnerUid: ownerUid,
          publishedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
          ...payload,
        };
        await setDoc(ref, fullDoc);
      }
    } else {
      await setDoc(ref, {
        id,
        storyId: input.storyId,
        creatorOwnerUid: ownerUid,
        publishedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        ...payload,
      });
    }

    // Sync episodeCount / format / isInteractive on parent story
    await updateDoc(doc(db, 'stories', input.storyId), {
      episodeCount: totalEpisodesAfterSave,
      format: storyHasAnyVideo ? 'hybrid' : 'audio',
      isInteractive: storyHasAnyChoice,
      updatedAt: serverTimestamp(),
    });

    const nowIso = new Date().toISOString();
    return {
      id,
      storyId: input.storyId,
      creatorOwnerUid: ownerUid,
      episodeNumber: payload.episodeNumber as number,
      title,
      titleHi,
      description,
      descriptionHi,
      durationSec,
      priceCoins: finalPriceCoins,
      mediaRef: cleanAudioRef,
      audioRef: cleanAudioRef,
      videoMediaRef: input.videoMediaRef ?? undefined,
      choicePoint: (payload.choicePoint as EpisodeChoicePoint | undefined) ?? undefined,
      isEnding: Boolean(input.isEnding),
      publishedAt: nowIso,
      createdAt: nowIso,
    };
  } catch (error) {
    handleFirestoreError(
      error,
      isEdit ? OperationType.UPDATE : OperationType.CREATE,
      `episodes/${id}`
    );
  }
}

export async function deleteCreatorEpisodeFromFirestore(
  storyId: string,
  episodeId: string,
  remainingEpisodes: Episode[]
): Promise<void> {
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'episodes', episodeId));
    remainingEpisodes.forEach((ep, index) => {
      batch.update(doc(db, 'episodes', ep.id), { episodeNumber: index + 1 });
    });
    batch.update(doc(db, 'stories', storyId), {
      episodeCount: remainingEpisodes.length,
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `episodes/${episodeId}`);
  }
}

export async function persistReorderedEpisodesToFirestore(reordered: Episode[]): Promise<void> {
  try {
    const batch = writeBatch(db);
    for (const ep of reordered) {
      batch.update(doc(db, 'episodes', ep.id), {
        episodeNumber: ep.episodeNumber,
      });
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, 'episodes/reorder');
  }
}

/**
 * Become a Creator Request Flow
 */
export async function fetchMyCreatorRequest(uid: string): Promise<CreatorRequest | null> {
  try {
    const snap = await getDoc(doc(db, 'creatorRequests', uid));
    if (!snap.exists()) return null;
    const raw = snap.data();
    return {
      id: String(raw.id),
      userId: String(raw.userId),
      userEmail: String(raw.userEmail),
      userName: String(raw.userName),
      studioName: String(raw.studioName),
      handle: String(raw.handle),
      language: raw.language as ContentLanguage,
      pitch: String(raw.pitch),
      sampleLink: raw.sampleLink ? String(raw.sampleLink) : undefined,
      status: raw.status as CreatorRequest['status'],
      reviewNote: raw.reviewNote ? String(raw.reviewNote) : undefined,
      reviewedByUid: raw.reviewedByUid ? String(raw.reviewedByUid) : undefined,
      createdAt: tsToMs(raw.createdAt),
      updatedAt: tsToMs(raw.updatedAt),
    };
  } catch (error) {
    console.warn('Could not read creator request:', error);
    return null;
  }
}

export async function submitCreatorRequestToFirestore(
  user: UserProfile,
  form: {
    studioName: string;
    handle: string;
    language: ContentLanguage;
    pitch: string;
    sampleLink?: string;
  }
): Promise<CreatorRequest> {
  const ref = doc(db, 'creatorRequests', user.uid);
  const studioName = form.studioName.trim().slice(0, 100);
  const rawHandle = form.handle.trim().replace(/^@+/, '').slice(0, 58);
  const handle = `@${rawHandle || slugify(studioName).slice(0, 24)}`;
  const pitch = form.pitch.trim().slice(0, 600);
  const sampleCheck = validateOptionalUrl(form.sampleLink, false);
  if (!sampleCheck.valid) {
    throw new Error(sampleCheck.error ?? 'Please enter a valid https:// portfolio link.');
  }
  const sampleLink = sampleCheck.sanitized;

  if (studioName.length < 2) {
    throw new Error('Please enter your studio or creator name.');
  }
  if (pitch.length < 10) {
    throw new Error('Please write at least 10 characters describing your story concept.');
  }

  try {
    const existingSnap = await getDoc(ref);
    if (existingSnap.exists()) {
      const existingData = existingSnap.data();
      if (existingData.status === 'pending') {
        throw new Error('You already have a pending creator request under review.');
      }
      if (existingData.status === 'approved') {
        throw new Error('Your creator request has already been approved.');
      }
      // Resubmit rejected request
      const updatePayload: Record<string, unknown> = {
        studioName,
        handle,
        language: form.language,
        pitch,
        status: 'pending',
        updatedAt: serverTimestamp(),
      };
      if (sampleLink) updatePayload.sampleLink = sampleLink;
      await updateDoc(ref, updatePayload);
    } else {
      const createPayload: Record<string, unknown> = {
        id: user.uid,
        userId: user.uid,
        userEmail: user.email.slice(0, 200),
        userName: user.displayName.slice(0, 80),
        studioName,
        handle,
        language: form.language,
        pitch,
        status: 'pending',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (sampleLink) createPayload.sampleLink = sampleLink;
      await setDoc(ref, createPayload);
    }

    const now = Date.now();
    return {
      id: user.uid,
      userId: user.uid,
      userEmail: user.email,
      userName: user.displayName,
      studioName,
      handle,
      language: form.language,
      pitch,
      sampleLink: sampleLink || undefined,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };
  } catch (error) {
    if (error instanceof Error && !error.message.includes('Firebase')) {
      throw error;
    }
    handleFirestoreError(error, OperationType.WRITE, `creatorRequests/${user.uid}`);
  }
}

export async function deleteCreatorRequestForAccount(uid: string): Promise<void> {
  try {
    const ref = doc(db, 'creatorRequests', uid);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      await deleteDoc(ref);
    }
  } catch {
    // Non-blocking cleanup
  }
}
