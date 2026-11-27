import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAdminSessionFirestoreUpdate,
  evaluateAdminSessionAction,
  evaluateSessionLogout,
  evaluateSessionRegister,
  MAX_DEVICE_WARNINGS,
  sanitizeDeviceId,
  sanitizeDeviceInfo,
  type UserSessionState,
} from './sessionEngine';

const deviceA = 'dev_chrome_laptop_1111';
const deviceB = 'dev_safari_phone_2222';

test('first login registers activeDevice and same device refreshes without warning', () => {
  const initial: UserSessionState = {
    uid: 'u1',
    activeDevice: null,
    warningCount: 0,
    banned: false,
  };

  const first = evaluateSessionRegister({
    userState: initial,
    deviceId: deviceA,
    deviceInfo: { label: 'Chrome on macOS' },
    sessionLogId: 'sess_1',
    nowMs: 1000,
  });
  assert.equal(first.status, 'active');
  if (first.status !== 'active') throw new Error('expected active');
  assert.equal(first.activeDevice.deviceId, deviceA);
  assert.equal(first.warningCount, 0);
  assert.equal(first.sessionLog.eventType, 'login_registered');

  // Same device re-registers later -> no warning, registeredAt preserved, lastSeen updated
  const refresh = evaluateSessionRegister({
    userState: {
      uid: 'u1',
      activeDevice: first.activeDevice,
      warningCount: 0,
      banned: false,
    },
    deviceId: deviceA,
    deviceInfo: { label: 'Chrome on macOS' },
    sessionLogId: 'sess_2',
    nowMs: 5000,
  });
  assert.equal(refresh.status, 'active');
  if (refresh.status !== 'active') throw new Error('expected active');
  assert.equal(refresh.activeDevice.registeredAt, 1000);
  assert.equal(refresh.activeDevice.lastSeen, 5000);
  assert.equal(refresh.warningCount, 0);
});

test('concurrent logins from another device trigger Warning 1, Warning 2, and Ban at Warning 3', () => {
  const activeOnA: UserSessionState = {
    uid: 'u2',
    activeDevice: {
      deviceId: deviceA,
      deviceInfo: { label: 'Chrome on Windows' },
      registeredAt: 1000,
      lastSeen: 1500,
    },
    warningCount: 0,
    banned: false,
  };

  // Strike 1
  const strike1 = evaluateSessionRegister({
    userState: activeOnA,
    deviceId: deviceB,
    deviceInfo: { label: 'Safari on iOS' },
    sessionLogId: 'sess_w1',
    nowMs: 2000,
  });
  assert.equal(strike1.status, 'violation_warning');
  if (strike1.status !== 'violation_warning') throw new Error('expected warning 1');
  assert.equal(strike1.warningCount, 1);
  assert.equal(strike1.maxWarnings, MAX_DEVICE_WARNINGS);
  assert.match(strike1.message, /Warning 1 of 3/);
  assert.equal(strike1.sessionLog.eventType, 'violation_warning');

  // Strike 2
  const strike2 = evaluateSessionRegister({
    userState: { ...activeOnA, warningCount: 1 },
    deviceId: deviceB,
    deviceInfo: { label: 'Safari on iOS' },
    sessionLogId: 'sess_w2',
    nowMs: 3000,
  });
  assert.equal(strike2.status, 'violation_warning');
  if (strike2.status !== 'violation_warning') throw new Error('expected warning 2');
  assert.equal(strike2.warningCount, 2);
  assert.match(strike2.message, /Warning 2 of 3/);

  // Strike 3 -> Account Banned + Firebase Auth disable + revoke tokens
  const strike3 = evaluateSessionRegister({
    userState: { ...activeOnA, warningCount: 2 },
    deviceId: deviceB,
    deviceInfo: { label: 'Safari on iOS' },
    sessionLogId: 'sess_ban',
    nowMs: 4000,
  });
  assert.equal(strike3.status, 'violation_ban');
  if (strike3.status !== 'violation_ban') throw new Error('expected ban');
  assert.equal(strike3.warningCount, 3);
  assert.equal(strike3.banned, true);
  assert.equal(strike3.shouldDisableAuth, true);
  assert.equal(strike3.shouldRevokeTokens, true);
  assert.equal(strike3.sessionLog.eventType, 'violation_ban');

  // Subsequent login attempts on banned account are immediately rejected
  const blocked = evaluateSessionRegister({
    userState: {
      uid: 'u2',
      activeDevice: null,
      warningCount: 3,
      banned: true,
      banReason: strike3.banReason,
    },
    deviceId: deviceA,
    deviceInfo: { label: 'Chrome on Windows' },
    sessionLogId: 'sess_blocked',
    nowMs: 5000,
  });
  assert.equal(blocked.status, 'already_banned');
  assert.equal(blocked.banned, true);
});

test('clean logout releases activeDevice only for the owning device, enabling a new device to sign in', () => {
  const activeOnA: UserSessionState = {
    uid: 'u3',
    activeDevice: {
      deviceId: deviceA,
      deviceInfo: { label: 'Firefox on Linux' },
      registeredAt: 1000,
      lastSeen: 2000,
    },
    warningCount: 0,
    banned: false,
  };

  // Device B cannot release Device A's lock
  const wrongLogout = evaluateSessionLogout({
    userState: activeOnA,
    deviceId: deviceB,
    sessionLogId: 'sess_lo_1',
    nowMs: 3000,
  });
  assert.equal(wrongLogout.clearedActiveDevice, false);

  // Device A releases lock cleanly
  const ownerLogout = evaluateSessionLogout({
    userState: activeOnA,
    deviceId: deviceA,
    sessionLogId: 'sess_lo_2',
    nowMs: 4000,
  });
  assert.equal(ownerLogout.clearedActiveDevice, true);
  assert.equal(ownerLogout.sessionLog.eventType, 'logout');

  // Now Device B can log in cleanly with zero warnings
  const nextLogin = evaluateSessionRegister({
    userState: { ...activeOnA, activeDevice: null },
    deviceId: deviceB,
    deviceInfo: { label: 'Safari on iOS' },
    sessionLogId: 'sess_b',
    nowMs: 5000,
  });
  assert.equal(nextLogin.status, 'active');
});

test('Admin ban, unban (custom warning count), reset_warnings, force_logout, and self-ban protection', () => {
  const baseState: UserSessionState = {
    uid: 'u_listener',
    activeDevice: {
      deviceId: deviceA,
      deviceInfo: { label: 'Chrome' },
      registeredAt: 1000,
      lastSeen: 2000,
    },
    warningCount: 2,
    banned: false,
  };

  // Self-ban blocked
  const selfBan = evaluateAdminSessionAction({
    actorUid: 'u_admin',
    targetUid: 'u_admin',
    targetLabel: 'admin@example.com',
    action: 'ban',
    userState: { ...baseState, uid: 'u_admin' },
    sessionLogId: 's_self',
  });
  assert.equal(selfBan.ok, false);

  // Admin ban
  const ban = evaluateAdminSessionAction({
    actorUid: 'u_admin',
    targetUid: 'u_listener',
    targetLabel: 'listener@example.com',
    action: 'ban',
    reason: 'Confirmed credential sharing',
    userState: baseState,
    sessionLogId: 's_ban',
    nowMs: 5000,
  });
  assert.equal(ban.ok, true);
  assert.equal(ban.nextBanned, true);
  assert.equal(ban.clearActiveDevice, true);
  assert.equal(ban.authAction, 'disable_and_revoke');
  assert.equal(ban.auditAction, 'user_ban');

  // Admin unban with custom warning count = 1
  const unban = evaluateAdminSessionAction({
    actorUid: 'u_admin',
    targetUid: 'u_listener',
    targetLabel: 'listener@example.com',
    action: 'unban',
    warningCountOverride: 1,
    userState: { ...baseState, banned: true, warningCount: 3, activeDevice: null },
    sessionLogId: 's_unban',
    nowMs: 6000,
  });
  assert.equal(unban.ok, true);
  assert.equal(unban.nextBanned, false);
  assert.equal(unban.nextWarningCount, 1);
  assert.equal(unban.authAction, 'enable');
  assert.equal(unban.auditAction, 'user_unban');

  // Invalid unban warning count (>= 3) rejected
  const badUnban = evaluateAdminSessionAction({
    actorUid: 'u_admin',
    targetUid: 'u_listener',
    targetLabel: 'listener@example.com',
    action: 'unban',
    warningCountOverride: 3,
    userState: { ...baseState, banned: true, warningCount: 3, activeDevice: null },
    sessionLogId: 's_bad',
  });
  assert.equal(badUnban.ok, false);

  // Admin reset warnings
  const reset = evaluateAdminSessionAction({
    actorUid: 'u_admin',
    targetUid: 'u_listener',
    targetLabel: 'listener@example.com',
    action: 'reset_warnings',
    userState: baseState,
    sessionLogId: 's_reset',
  });
  assert.equal(reset.ok, true);
  assert.equal(reset.nextWarningCount, 0);
  assert.equal(reset.auditAction, 'user_warnings_reset');

  // Admin force logout
  const forceLogout = evaluateAdminSessionAction({
    actorUid: 'u_admin',
    targetUid: 'u_listener',
    targetLabel: 'listener@example.com',
    action: 'force_logout',
    userState: baseState,
    sessionLogId: 's_force',
  });
  assert.equal(forceLogout.ok, true);
  assert.equal(forceLogout.clearActiveDevice, true);
  assert.equal(forceLogout.authAction, 'revoke_only');
  assert.equal(forceLogout.auditAction, 'user_force_logout');
});

test('sanitizeDeviceId and sanitizeDeviceInfo reject invalid IDs and bound string lengths', () => {
  assert.equal(sanitizeDeviceId('short'), null);
  assert.equal(sanitizeDeviceId('bad id with spaces!'), null);
  assert.equal(sanitizeDeviceId('dev_12345678_valid'), 'dev_12345678_valid');

  const info = sanitizeDeviceInfo({
    label: 'A'.repeat(200),
    platform: 'macOS',
    userAgent: 'U'.repeat(400),
  });
  assert.equal(info.label.length, 100);
  assert.equal(info.userAgent?.length, 220);
});

test('buildAdminSessionFirestoreUpdate builds schema-safe payloads for direct Firestore admin fallback', () => {
  const TS = Symbol('serverTimestamp');
  const allowedKeys = new Set([
    'banned',
    'isDisabled',
    'warningCount',
    'banReason',
    'bannedAt',
    'activeDevice',
    'updatedAt',
  ]);
  const baseState: UserSessionState = {
    uid: 'u_listener',
    activeDevice: {
      deviceId: deviceA,
      deviceInfo: { label: 'Chrome on Windows' },
      registeredAt: 1000,
      lastSeen: 2000,
    },
    warningCount: 2,
    banned: false,
  };

  const banEval = evaluateAdminSessionAction({
    actorUid: 'u_admin',
    targetUid: 'u_listener',
    targetLabel: 'listener@example.com',
    action: 'ban',
    reason: 'Abuse',
    userState: baseState,
    sessionLogId: 's_1',
  });
  const banUpdate = buildAdminSessionFirestoreUpdate('ban', banEval, TS);
  assert.equal(banUpdate.banned, true);
  assert.equal(banUpdate.isDisabled, true);
  assert.equal(banUpdate.bannedAt, TS);
  assert.equal(banUpdate.activeDevice, null);
  assert.equal(banUpdate.updatedAt, TS);
  for (const key of Object.keys(banUpdate)) {
    assert.ok(allowedKeys.has(key), `Unexpected key ${key}`);
  }

  const unbanEval = evaluateAdminSessionAction({
    actorUid: 'u_admin',
    targetUid: 'u_listener',
    targetLabel: 'listener@example.com',
    action: 'unban',
    warningCountOverride: 1,
    userState: { ...baseState, banned: true, warningCount: 3, activeDevice: null },
    sessionLogId: 's_2',
  });
  const unbanUpdate = buildAdminSessionFirestoreUpdate('unban', unbanEval, TS);
  assert.equal(unbanUpdate.banned, false);
  assert.equal(unbanUpdate.isDisabled, false);
  assert.equal(unbanUpdate.warningCount, 1);
  assert.equal(unbanUpdate.bannedAt, null);
  assert.equal(unbanUpdate.banReason, null);
  assert.equal('activeDevice' in unbanUpdate, false);

  const forceEval = evaluateAdminSessionAction({
    actorUid: 'u_admin',
    targetUid: 'u_listener',
    targetLabel: 'listener@example.com',
    action: 'force_logout',
    userState: baseState,
    sessionLogId: 's_3',
  });
  const forceUpdate = buildAdminSessionFirestoreUpdate('force_logout', forceEval, TS);
  assert.equal(forceUpdate.activeDevice, null);
  assert.equal(forceUpdate.banned, false);
  assert.equal('bannedAt' in forceUpdate, false);
});
