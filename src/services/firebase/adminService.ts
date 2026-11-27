import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import {
  buildAdminSessionFirestoreUpdate,
  evaluateAdminSessionAction,
} from '../../../api/_lib/sessionEngine';
import type {
  AdminSessionActionType,
  AuditActionType,
  AuditLogEntry,
  Category,
  CoinPackage,
  CoinWallet,
  ContentLanguage,
  Creator,
  CreatorRequest,
  EconomySettings,
  Episode,
  Story,
  StoryVisibility,
  UserProfile,
  UserRole,
} from '../../types';
import { DEFAULT_ECONOMY_SETTINGS } from '../access/episodeAccess';
import { DEFAULT_COIN_PACKAGES } from '../payments/PaymentProvider';
import { slugify } from '../studio/studioAnalytics';
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

export interface AdminDashboardBundle {
  users: UserProfile[];
  creatorRequests: CreatorRequest[];
  stories: Story[];
  episodes: Episode[];
  creators: Creator[];
  categories: Category[];
  coinPackages: CoinPackage[];
  economySettings: EconomySettings;
  wallets: CoinWallet[];
  auditLogs: AuditLogEntry[];
}

export async function writeAuditLog(
  actor: UserProfile,
  action: AuditActionType,
  targetCollection: string,
  targetId: string,
  summary: string
): Promise<AuditLogEntry> {
  const id = `audit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const ref = doc(db, 'auditLogs', id);
  const safeSummary = summary.trim().slice(0, 400);
  try {
    await setDoc(ref, {
      id,
      actorUid: actor.uid,
      actorEmail: actor.email.slice(0, 200),
      action,
      targetCollection: targetCollection.slice(0, 64),
      targetId: targetId.slice(0, 128),
      summary: safeSummary,
      createdAt: serverTimestamp(),
    });
    return {
      id,
      actorUid: actor.uid,
      actorEmail: actor.email,
      action,
      targetCollection,
      targetId,
      summary: safeSummary,
      createdAt: Date.now(),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `auditLogs/${id}`);
  }
}

export async function fetchAdminDashboardBundle(): Promise<AdminDashboardBundle> {
  try {
    const [
      usersSnap,
      reqSnap,
      storiesSnap,
      epSnap,
      creatorsSnap,
      catsSnap,
      pkgSnap,
      ecoSnap,
      walletsSnap,
      logsSnap,
    ] = await Promise.all([
      getDocs(collection(db, 'users')),
      getDocs(collection(db, 'creatorRequests')),
      getDocs(collection(db, 'stories')),
      getDocs(collection(db, 'episodes')),
      getDocs(collection(db, 'creators')),
      getDocs(collection(db, 'categories')),
      getDocs(collection(db, 'coinPackages')).catch(() => null),
      getDoc(doc(db, 'platformSettings', 'economy')).catch(() => null),
      getDocs(collection(db, 'wallets')).catch(() => null),
      getDocs(collection(db, 'auditLogs')),
    ]);

    const users: UserProfile[] = usersSnap.docs
      .map((d) => {
        const raw = d.data() as Record<string, unknown>;
        const rawActive =
          raw.activeDevice && typeof raw.activeDevice === 'object'
            ? (raw.activeDevice as Record<string, unknown>)
            : null;
        const rawInfo =
          rawActive?.deviceInfo && typeof rawActive.deviceInfo === 'object'
            ? (rawActive.deviceInfo as Record<string, unknown>)
            : null;
        return {
          ...(raw as unknown as UserProfile),
          uid: String(raw.uid ?? d.id),
          email: String(raw.email ?? ''),
          phoneNumber: typeof raw.phoneNumber === 'string' ? raw.phoneNumber : undefined,
          isDisabled: Boolean(raw.isDisabled),
          warningCount:
            typeof raw.warningCount === 'number' && Number.isFinite(raw.warningCount)
              ? Math.max(0, Math.floor(raw.warningCount))
              : 0,
          banned: Boolean(raw.banned),
          bannedAt: raw.bannedAt ? tsToMs(raw.bannedAt) : null,
          banReason: typeof raw.banReason === 'string' ? raw.banReason : null,
          activeDevice:
            rawActive && typeof rawActive.deviceId === 'string'
              ? {
                  deviceId: rawActive.deviceId,
                  deviceInfo: {
                    label:
                      typeof rawInfo?.label === 'string' ? rawInfo.label : 'Web Browser',
                    platform:
                      typeof rawInfo?.platform === 'string' ? rawInfo.platform : undefined,
                  },
                  registeredAt: tsToMs(rawActive.registeredAt),
                  lastSeen: tsToMs(rawActive.lastSeen),
                }
              : null,
          lastSeen: raw.lastSeen ? tsToMs(raw.lastSeen) : null,
          createdAt: tsToMs(raw.createdAt),
          updatedAt: tsToMs(raw.updatedAt),
        };
      })
      .sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0));

    const creatorRequests: CreatorRequest[] = reqSnap.docs
      .map((d) => {
        const raw = d.data();
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
      })
      .sort((a, b) => b.createdAt - a.createdAt);

    const stories: Story[] = storiesSnap.docs
      .map((d) => {
        const raw = d.data() as Story;
        return {
          ...raw,
          priceOverrideCoins:
            typeof raw.priceOverrideCoins === 'number' && Number.isFinite(raw.priceOverrideCoins)
              ? Math.max(0, Math.floor(raw.priceOverrideCoins))
              : null,
          isDeleted: Boolean(raw.isDeleted),
          deletedAt: raw.deletedAt ? tsToMs(raw.deletedAt) : null,
          deletedByUid: typeof raw.deletedByUid === 'string' ? raw.deletedByUid : null,
          publishedAt: tsToIso(raw.publishedAt),
          createdAt: tsToIso(raw.createdAt),
          updatedAt: tsToIso(raw.updatedAt),
        };
      })
      .sort((a, b) => Date.parse(b.updatedAt || b.publishedAt) - Date.parse(a.updatedAt || a.publishedAt));

    const episodes: Episode[] = epSnap.docs
      .map((d) => {
        const raw = d.data() as Episode & { accessTier?: string };
        const priceCoins =
          typeof raw.priceCoins === 'number' && Number.isFinite(raw.priceCoins)
            ? Math.max(0, Math.floor(raw.priceCoins))
            : raw.accessTier === 'premium'
              ? 20
              : raw.accessTier === 'daily_unlock'
                ? 10
                : 0;
        return {
          ...raw,
          priceCoins,
          isDeleted: Boolean(raw.isDeleted),
          deletedAt: raw.deletedAt ? tsToMs(raw.deletedAt) : null,
          deletedByUid: typeof raw.deletedByUid === 'string' ? raw.deletedByUid : null,
          publishedAt: tsToIso(raw.publishedAt),
          createdAt: tsToIso(raw.createdAt),
        };
      })
      .sort((a, b) => a.episodeNumber - b.episodeNumber);

    const creators: Creator[] = creatorsSnap.docs
      .map((d) => d.data() as Creator)
      .sort((a, b) => b.followersCount - a.followersCount);

    const categories: Category[] = catsSnap.docs
      .map((d) => d.data() as Category)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    const dbPackages: CoinPackage[] = pkgSnap
      ? pkgSnap.docs
          .map((d) => {
            const raw = d.data();
            return {
              id: String(raw.id ?? d.id),
              name: String(raw.name ?? 'Coin Pack'),
              nameHi: typeof raw.nameHi === 'string' ? raw.nameHi : undefined,
              coins: Number(raw.coins ?? 10),
              bonusCoins: Number(raw.bonusCoins ?? 0),
              priceInr: Number(raw.priceInr ?? 0),
              active: Boolean(raw.active),
              sortOrder: Number(raw.sortOrder ?? 0),
              createdAt: tsToMs(raw.createdAt),
              updatedAt: tsToMs(raw.updatedAt),
            };
          })
          .sort((a, b) => a.sortOrder - b.sortOrder)
      : [];

    const coinPackages = dbPackages.length > 0 ? dbPackages : DEFAULT_COIN_PACKAGES;

    const economySettings: EconomySettings =
      ecoSnap && ecoSnap.exists()
        ? {
            id: 'economy',
            dailyFreeEnabled:
              typeof ecoSnap.data().dailyFreeEnabled === 'boolean'
                ? Boolean(ecoSnap.data().dailyFreeEnabled)
                : true,
            dailyFreeLimit:
              typeof ecoSnap.data().dailyFreeLimit === 'number'
                ? Math.max(0, Math.min(20, Math.floor(ecoSnap.data().dailyFreeLimit)))
                : DEFAULT_ECONOMY_SETTINGS.dailyFreeLimit,
            updatedAt: tsToMs(ecoSnap.data().updatedAt),
            updatedByUid:
              typeof ecoSnap.data().updatedByUid === 'string'
                ? ecoSnap.data().updatedByUid
                : undefined,
          }
        : DEFAULT_ECONOMY_SETTINGS;

    const wallets: CoinWallet[] = walletsSnap
      ? walletsSnap.docs.map((d) => {
          const raw = d.data();
          return {
            uid: String(raw.uid ?? d.id),
            balance: Number(raw.balance ?? 0),
            lifetimePurchased: Number(raw.lifetimePurchased ?? 0),
            lifetimeSpent: Number(raw.lifetimeSpent ?? 0),
            updatedAt: tsToMs(raw.updatedAt),
          };
        })
      : [];

    const auditLogs: AuditLogEntry[] = logsSnap.docs
      .map((d) => {
        const raw = d.data();
        return {
          id: String(raw.id),
          actorUid: String(raw.actorUid),
          actorEmail: String(raw.actorEmail),
          action: raw.action as AuditActionType,
          targetCollection: String(raw.targetCollection),
          targetId: String(raw.targetId),
          summary: String(raw.summary),
          createdAt: tsToMs(raw.createdAt),
        };
      })
      .sort((a, b) => b.createdAt - a.createdAt);

    return {
      users,
      creatorRequests,
      stories,
      episodes,
      creators,
      categories,
      coinPackages,
      economySettings,
      wallets,
      auditLogs,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'adminDashboardBundle');
  }
}

export async function adminChangeUserRole(
  actor: UserProfile,
  targetUser: UserProfile,
  newRole: UserRole
): Promise<AuditLogEntry> {
  try {
    await updateDoc(doc(db, 'users', targetUser.uid), {
      role: newRole,
      updatedAt: serverTimestamp(),
    });

    // Keep admins registry in sync
    const adminRef = doc(db, 'admins', targetUser.uid);
    if (newRole === 'admin') {
      await setDoc(adminRef, {
        uid: targetUser.uid,
        grantedAt: serverTimestamp(),
      });
    } else {
      const adminSnap = await getDoc(adminRef);
      if (adminSnap.exists()) {
        await deleteDoc(adminRef);
      }
    }

    // Ensure creator studio profile exists when promoted to creator
    if (newRole === 'creator') {
      const creatorId = `creator-${targetUser.uid.slice(0, 20)}`;
      const creatorRef = doc(db, 'creators', creatorId);
      const creatorSnap = await getDoc(creatorRef);
      if (!creatorSnap.exists()) {
        await setDoc(creatorRef, {
          id: creatorId,
          ownerUid: targetUser.uid,
          name: targetUser.displayName.slice(0, 100),
          handle: `@${slugify(targetUser.displayName).slice(0, 24)}`,
          bioEn: targetUser.bio?.slice(0, 400) || 'Dhruv Tales Creator',
          bioHi: targetUser.bio?.slice(0, 400) || 'ध्रुव टेल्स रचनाकार',
          language: 'bilingual',
          followersCount: 0,
          storiesCount: 0,
          verified: false,
          accentPalette: '#E5A93C',
        });
      }
    }

    return await writeAuditLog(
      actor,
      'user_role_change',
      'users',
      targetUser.uid,
      `Changed role for ${targetUser.email} from ${targetUser.role} to ${newRole}`
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${targetUser.uid}`);
  }
}

export async function adminToggleUserDisabled(
  actor: UserProfile,
  targetUser: UserProfile,
  isDisabled: boolean
): Promise<AuditLogEntry> {
  try {
    await updateDoc(doc(db, 'users', targetUser.uid), {
      isDisabled,
      updatedAt: serverTimestamp(),
    });
    return await writeAuditLog(
      actor,
      'user_disable_toggle',
      'users',
      targetUser.uid,
      `${isDisabled ? 'Disabled' : 'Re-enabled'} user account ${targetUser.email}`
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${targetUser.uid}`);
  }
}

/**
 * Direct Firestore Admin fallback for ban, unban, reset_warnings, and force_logout
 * when static hosting (e.g. Cloudflare Workers/Pages) runs without a Node API backend.
 * Strictly protected by `isAdmin()` and `isValidUserProfile()` in `firestore.rules`.
 */
export async function adminApplyUserSessionActionDirect(
  actor: UserProfile,
  targetUser: UserProfile,
  action: AdminSessionActionType,
  options?: { warningCount?: number; reason?: string }
): Promise<{ summary: string; auditLog: AuditLogEntry }> {
  const targetLabel =
    targetUser.email || targetUser.phoneNumber || targetUser.displayName || targetUser.uid;
  const evaluated = evaluateAdminSessionAction({
    actorUid: actor.uid,
    targetUid: targetUser.uid,
    targetLabel,
    action,
    warningCountOverride: options?.warningCount,
    reason: options?.reason,
    userState: {
      uid: targetUser.uid,
      activeDevice: targetUser.activeDevice ?? null,
      warningCount:
        typeof targetUser.warningCount === 'number' && Number.isFinite(targetUser.warningCount)
          ? Math.max(0, Math.floor(targetUser.warningCount))
          : 0,
      banned: Boolean(targetUser.banned),
      banReason: targetUser.banReason ?? null,
    },
    sessionLogId: `sess_direct_${Date.now().toString(36)}`,
  });

  if (!evaluated.ok) {
    throw new Error(evaluated.error || 'Unable to apply admin session action.');
  }

  const updatePayload = buildAdminSessionFirestoreUpdate(action, evaluated, serverTimestamp());

  try {
    await updateDoc(doc(db, 'users', targetUser.uid), updatePayload);
    const summary = evaluated.auditSummary || `Applied ${action} for ${targetLabel}`;
    const auditLog = await writeAuditLog(
      actor,
      evaluated.auditAction ?? 'user_disable_toggle',
      'users',
      targetUser.uid,
      summary
    );
    return { summary, auditLog };
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${targetUser.uid}`);
  }
}

export async function adminReviewCreatorRequest(
  actor: UserProfile,
  request: CreatorRequest,
  decision: 'approved' | 'rejected',
  reviewNote: string
): Promise<AuditLogEntry> {
  const safeNote = reviewNote.trim().slice(0, 300);
  try {
    await updateDoc(doc(db, 'creatorRequests', request.id), {
      status: decision,
      reviewNote: safeNote || (decision === 'approved' ? 'Approved by Admin' : 'Not approved at this time'),
      reviewedByUid: actor.uid,
      updatedAt: serverTimestamp(),
    });

    if (decision === 'approved') {
      const userRef = doc(db, 'users', request.userId);
      const userSnap = await getDoc(userRef);
      if (userSnap.exists() && userSnap.data().role !== 'admin') {
        await updateDoc(userRef, {
          role: 'creator',
          updatedAt: serverTimestamp(),
        });
      }

      const creatorId = `creator-${request.userId.slice(0, 20)}`;
      await setDoc(doc(db, 'creators', creatorId), {
        id: creatorId,
        ownerUid: request.userId,
        name: request.studioName.slice(0, 100),
        handle: request.handle.slice(0, 60),
        bioEn: request.pitch.slice(0, 400),
        bioHi: request.pitch.slice(0, 400),
        language: request.language,
        followersCount: 0,
        storiesCount: 0,
        verified: true,
        accentPalette: '#E5A93C',
      });
    }

    return await writeAuditLog(
      actor,
      decision === 'approved' ? 'creator_request_approve' : 'creator_request_reject',
      'creatorRequests',
      request.id,
      `${decision === 'approved' ? 'Approved' : 'Rejected'} creator application for ${request.studioName} (${request.userEmail})`
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `creatorRequests/${request.id}`);
  }
}

export async function adminUpdateStoryModeration(
  actor: UserProfile,
  story: Story,
  updates: Partial<{
    visibility: StoryVisibility;
    isFeatured: boolean;
    isEditorsPick: boolean;
    isTrending: boolean;
  }>,
  summary: string
): Promise<AuditLogEntry> {
  try {
    await updateDoc(doc(db, 'stories', story.id), {
      ...updates,
      updatedAt: serverTimestamp(),
    });
    const action: AuditActionType =
      'visibility' in updates ? 'story_visibility_change' : 'story_curation_toggle';
    return await writeAuditLog(actor, action, 'stories', story.id, summary);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `stories/${story.id}`);
  }
}

export async function adminDeleteStory(
  actor: UserProfile,
  story: Story,
  episodeIds: string[]
): Promise<AuditLogEntry> {
  try {
    const batch = writeBatch(db);
    for (const epId of episodeIds) {
      batch.delete(doc(db, 'episodes', epId));
    }
    batch.delete(doc(db, 'stories', story.id));
    await batch.commit();

    return await writeAuditLog(
      actor,
      'story_delete',
      'stories',
      story.id,
      `Deleted story "${story.title}" and ${episodeIds.length} episodes`
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `stories/${story.id}`);
  }
}

export async function adminUpdateEpisodePrice(
  actor: UserProfile,
  episode: Episode,
  priceCoins: number
): Promise<AuditLogEntry> {
  const safePrice = Math.max(0, Math.min(100_000, Math.floor(priceCoins)));
  try {
    await updateDoc(doc(db, 'episodes', episode.id), {
      priceCoins: safePrice,
    });
    return await writeAuditLog(
      actor,
      'episode_price_change',
      'episodes',
      episode.id,
      `Set Episode ${episode.episodeNumber} ("${episode.title}") price from ${episode.priceCoins} to ${safePrice} coins`
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `episodes/${episode.id}`);
  }
}

export async function adminUpdateStoryPriceOverride(
  actor: UserProfile,
  story: Story,
  priceOverrideCoins: number | null
): Promise<AuditLogEntry> {
  const safeValue =
    priceOverrideCoins === null
      ? null
      : Math.max(0, Math.min(100_000, Math.floor(priceOverrideCoins)));
  try {
    await updateDoc(doc(db, 'stories', story.id), {
      priceOverrideCoins: safeValue,
      updatedAt: serverTimestamp(),
    });
    return await writeAuditLog(
      actor,
      'story_price_override',
      'stories',
      story.id,
      safeValue === null
        ? `Cleared story-level coin price override for "${story.title}"`
        : `Set story-level coin price override for "${story.title}" to ${safeValue} coins`
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `stories/${story.id}`);
  }
}

export async function adminSaveCoinPackage(
  actor: UserProfile,
  pkg: CoinPackage,
  isEdit: boolean
): Promise<{ saved: CoinPackage; log: AuditLogEntry }> {
  const id = isEdit
    ? pkg.id
    : `pkg-${slugify(pkg.name || 'pack').slice(0, 28)}-${Date.now().toString(36)}`;
  const coins = Math.max(1, Math.min(1_000_000, Math.floor(Number(pkg.coins) || 10)));
  const bonusCoins = Math.max(0, Math.min(1_000_000, Math.floor(Number(pkg.bonusCoins) || 0)));
  const priceInr = Math.max(0, Math.min(1_000_000, Math.round(Number(pkg.priceInr) || 0)));
  const sortOrder = Math.max(0, Math.min(1000, Math.floor(Number(pkg.sortOrder) || 0)));
  const name = pkg.name.trim().slice(0, 80);
  const nameHi = (pkg.nameHi?.trim() || name).slice(0, 80);

  try {
    await setDoc(doc(db, 'coinPackages', id), {
      id,
      name,
      nameHi,
      coins,
      bonusCoins,
      priceInr,
      active: Boolean(pkg.active),
      sortOrder,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    const log = await writeAuditLog(
      actor,
      isEdit ? 'coin_package_update' : 'coin_package_create',
      'coinPackages',
      id,
      `${isEdit ? 'Updated' : 'Created'} coin package "${name}" (${coins}+${bonusCoins} coins for ₹${priceInr}, ${pkg.active ? 'active' : 'inactive'})`
    );
    return {
      saved: {
        id,
        name,
        nameHi,
        coins,
        bonusCoins,
        priceInr,
        active: Boolean(pkg.active),
        sortOrder,
        updatedAt: Date.now(),
      },
      log,
    };
  } catch (error) {
    handleFirestoreError(
      error,
      isEdit ? OperationType.UPDATE : OperationType.CREATE,
      `coinPackages/${id}`
    );
  }
}

export async function adminDeleteCoinPackage(
  actor: UserProfile,
  pkg: CoinPackage
): Promise<AuditLogEntry> {
  try {
    await deleteDoc(doc(db, 'coinPackages', pkg.id));
    return await writeAuditLog(
      actor,
      'coin_package_delete',
      'coinPackages',
      pkg.id,
      `Deleted coin package "${pkg.name}" (${pkg.id})`
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `coinPackages/${pkg.id}`);
  }
}

export async function adminUpdateEconomySettings(
  actor: UserProfile,
  settings: { dailyFreeEnabled: boolean; dailyFreeLimit: number }
): Promise<{ saved: EconomySettings; log: AuditLogEntry }> {
  const safeLimit = Math.max(0, Math.min(20, Math.floor(settings.dailyFreeLimit)));
  try {
    await setDoc(doc(db, 'platformSettings', 'economy'), {
      id: 'economy',
      dailyFreeEnabled: Boolean(settings.dailyFreeEnabled),
      dailyFreeLimit: safeLimit,
      updatedByUid: actor.uid,
      updatedAt: serverTimestamp(),
    });
    const log = await writeAuditLog(
      actor,
      'economy_settings_update',
      'platformSettings',
      'economy',
      `Updated daily free episode setting: ${settings.dailyFreeEnabled ? `ON (${safeLimit}/day)` : 'OFF'}`
    );
    return {
      saved: {
        id: 'economy',
        dailyFreeEnabled: Boolean(settings.dailyFreeEnabled),
        dailyFreeLimit: safeLimit,
        updatedByUid: actor.uid,
        updatedAt: Date.now(),
      },
      log,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, 'platformSettings/economy');
  }
}

export async function adminDeleteEpisode(
  actor: UserProfile,
  episode: Episode
): Promise<AuditLogEntry> {
  try {
    await deleteDoc(doc(db, 'episodes', episode.id));
    return await writeAuditLog(
      actor,
      'episode_delete',
      'episodes',
      episode.id,
      `Deleted Episode ${episode.episodeNumber} ("${episode.title}") from story ${episode.storyId}`
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `episodes/${episode.id}`);
  }
}

export async function adminToggleCreatorVerified(
  actor: UserProfile,
  creator: Creator,
  verified: boolean
): Promise<AuditLogEntry> {
  try {
    await updateDoc(doc(db, 'creators', creator.id), {
      verified,
    });
    return await writeAuditLog(
      actor,
      'creator_verify_toggle',
      'creators',
      creator.id,
      `${verified ? 'Verified' : 'Unverified'} creator ${creator.name} (${creator.handle})`
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `creators/${creator.id}`);
  }
}

export async function adminSaveCategory(
  actor: UserProfile,
  category: Category,
  isEdit: boolean
): Promise<AuditLogEntry> {
  const id = isEdit ? category.id : slugify(category.id || category.nameEn).slice(0, 64);
  const slug = slugify(category.slug || category.nameEn).slice(0, 64);
  const payload: Category = {
    id,
    slug,
    nameEn: category.nameEn.trim().slice(0, 60),
    nameHi: (category.nameHi.trim() || category.nameEn.trim()).slice(0, 60),
    descriptionEn: (category.descriptionEn ?? '').trim().slice(0, 240),
    descriptionHi: (category.descriptionHi ?? '').trim().slice(0, 240),
    accentHex: (category.accentHex ?? '#E5A93C').slice(0, 16),
    sortOrder: Math.max(0, Math.min(1000, Number(category.sortOrder) || 0)),
    isActive: Boolean(category.isActive),
  };

  try {
    await setDoc(doc(db, 'categories', id), payload);
    return await writeAuditLog(
      actor,
      isEdit ? 'category_update' : 'category_create',
      'categories',
      id,
      `${isEdit ? 'Updated' : 'Created'} category "${payload.nameEn}" (${payload.isActive ? 'active' : 'hidden'})`
    );
  } catch (error) {
    handleFirestoreError(
      error,
      isEdit ? OperationType.UPDATE : OperationType.CREATE,
      `categories/${id}`
    );
  }
}

export async function adminDeleteCategory(
  actor: UserProfile,
  category: Category
): Promise<AuditLogEntry> {
  try {
    await deleteDoc(doc(db, 'categories', category.id));
    return await writeAuditLog(
      actor,
      'category_delete',
      'categories',
      category.id,
      `Deleted category "${category.nameEn}" (${category.id})`
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `categories/${category.id}`);
  }
}
