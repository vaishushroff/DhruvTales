import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BOOTSTRAP_ADMIN_EMAIL,
  evaluateAdminAccess,
  hasAdminCustomClaim,
} from './adminAuth';

test('hasAdminCustomClaim strictly requires boolean admin === true on the Firebase ID token', () => {
  assert.equal(hasAdminCustomClaim({ uid: 'u1', admin: true }), true);
  assert.equal(hasAdminCustomClaim({ uid: 'u1', admin: false }), false);
  assert.equal(hasAdminCustomClaim({ uid: 'u1', admin: 'true' }), false);
  assert.equal(hasAdminCustomClaim({ uid: 'u1', admin: 1 }), false);
  assert.equal(hasAdminCustomClaim({ uid: 'u1' }), false);
  assert.equal(hasAdminCustomClaim(null), false);
});

test('evaluateAdminAccess authorizes valid admin custom claim, verified bootstrap email, admins doc, and user doc admin flag/role', () => {
  assert.deepEqual(
    evaluateAdminAccess({ decoded: { uid: 'u-claim', admin: true } }),
    { allowed: true, reason: 'custom_claim' }
  );

  assert.deepEqual(
    evaluateAdminAccess({
      decoded: {
        uid: 'u-boot',
        email: BOOTSTRAP_ADMIN_EMAIL.toUpperCase(),
        email_verified: true,
      },
    }),
    { allowed: true, reason: 'bootstrap_email' }
  );

  assert.deepEqual(
    evaluateAdminAccess({
      decoded: { uid: 'u-reg', email: 'other@example.com', email_verified: true },
      adminDocExists: true,
    }),
    { allowed: true, reason: 'admins_registry' }
  );

  assert.deepEqual(
    evaluateAdminAccess({
      decoded: { uid: 'u-flag', email: 'flag@example.com', email_verified: true },
      userDocData: { admin: true, role: 'user' },
    }),
    { allowed: true, reason: 'user_doc_admin_flag' }
  );

  assert.deepEqual(
    evaluateAdminAccess({
      decoded: { uid: 'u-role', email: 'role@example.com', email_verified: true },
      userDocData: { role: 'admin' },
    }),
    { allowed: true, reason: 'user_doc_admin_role' }
  );
});

test('evaluateAdminAccess denies unverified bootstrap email, non-admin users, and spoofed truthy values', () => {
  assert.deepEqual(
    evaluateAdminAccess({
      decoded: {
        uid: 'u-spoof',
        email: BOOTSTRAP_ADMIN_EMAIL,
        email_verified: false,
      },
    }),
    { allowed: false, reason: 'denied' }
  );

  assert.deepEqual(
    evaluateAdminAccess({
      decoded: { uid: 'u-regular', email: 'user@example.com', email_verified: true, admin: 'true' },
      adminDocExists: false,
      userDocData: { admin: 'true', role: 'creator' },
    }),
    { allowed: false, reason: 'denied' }
  );

  assert.deepEqual(
    evaluateAdminAccess({ decoded: null }),
    { allowed: false, reason: 'denied' }
  );
});
