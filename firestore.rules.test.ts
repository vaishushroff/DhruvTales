import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const rulesContent = fs.readFileSync('firestore.rules', 'utf8');
const blueprint = JSON.parse(fs.readFileSync('firebase-blueprint.json', 'utf8'));

test('firestore.rules begins with rules_version 2 and default-deny safety net', () => {
  assert.match(rulesContent, /rules_version\s*=\s*'2';/);
  assert.match(rulesContent, /match\s+\/\{document=\*\*\}\s*\{\s*allow read, write: if false;\s*\}/);
});

test('every collection in firebase-blueprint.json has an explicit match block in firestore.rules', () => {
  const paths = Object.keys(blueprint.firestore);
  assert.equal(paths.length, 20, 'Expected all 20 collections in firebase-blueprint.json');
  for (const collectionPath of paths) {
    const matchPattern = collectionPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(
      rulesContent,
      new RegExp(`match\\s+${matchPattern}`),
      `Missing match block for ${collectionPath}`
    );
  }
});

test('Dirty Dozen #1 & #2: Users cannot self-assign role/admin flag, escalate role, self-unban, or inject legacy subscriptionTier', () => {
  assert.match(rulesContent, /incoming\(\)\.role\s*==\s*'user'/);
  assert.match(rulesContent, /!\('admin' in incoming\(\)\)/);
  assert.match(rulesContent, /incoming\(\)\.role\s*==\s*existing\(\)\.role/);
  assert.match(rulesContent, /'admin' in existing\(\) && incoming\(\)\.admin == existing\(\)\.admin/);
  assert.match(rulesContent, /incoming\(\)\.isDisabled\s*==\s*false/);
  assert.match(rulesContent, /!\('banned' in incoming\(\)\)/);
  assert.match(rulesContent, /!\('warningCount' in incoming\(\)\)/);
  assert.match(rulesContent, /!\('subscriptionTier' in incoming\(\)\)/);
  assert.match(rulesContent, /!\('banned' in existing\(\)\) \|\| existing\(\)\.banned == false/);
});

test('Dirty Dozen #3: Strict key allowlists prevent shadow field injection', () => {
  assert.match(rulesContent, /data\.keys\(\)\.hasOnly\(/);
  assert.match(rulesContent, /affectedKeys\(\)\.hasOnly\(/);
});

test('Dirty Dozen #4: Users PII is strictly isolated to owner or admin', () => {
  assert.match(rulesContent, /match \/users\/\{userId\}[\s\S]*allow get: if isValidId\(userId\) && \(isOwner\(userId\) \|\| isAdmin\(\)\);/);
  assert.match(rulesContent, /match \/users\/\{userId\}[\s\S]*allow list: if isAdmin\(\);/);
});

test('Dirty Dozen #5: Admin and verified-user helpers mandate email_verified == true (or verified phone), guard missing email keys, and check user doc admin flag', () => {
  assert.match(rulesContent, /function isVerified\(\)\s*\{[\s\S]*request\.auth\.token\.email_verified == true[\s\S]*'phone_number' in request\.auth\.token[\s\S]*\}/);
  assert.match(rulesContent, /function hasUserDocAdminFlag\(userData\)[\s\S]*'admin' in userData && userData\.admin == true[\s\S]*'role' in userData && userData\.role == 'admin'/);
  assert.match(rulesContent, /function isAdmin\(\)\s*\{\s*return isVerified\(\)/);
  assert.match(rulesContent, /hasUserDocAdminFlag\(get\(\/databases\/\$\(database\)\/documents\/users\/\$\(request\.auth\.uid\)\)\.data\)/);
  assert.match(rulesContent, /'email' in request\.auth\.token &&[\s\S]*request\.auth\.token\.email_verified == true &&[\s\S]*request\.auth\.token\.email\.lower\(\) == 'vaishushroff@gmail\.com'/);
});

test('Dirty Dozen #7 & #8: Personal collections enforce owner-only reads via userId or uid == request.auth.uid', () => {
  for (const col of ['listeningHistory', 'bookmarks', 'dailyUnlocks', 'userChoices', 'creatorRequests']) {
    const blockMatch = rulesContent.match(new RegExp(`match /${col}/\\{[^}]+\\}[\\s\\S]*?(?=\\n\\s*// \\d+\\.|\\n\\s*\\}\\s*\\})`));
    assert.ok(blockMatch, `Found rule block for ${col}`);
    assert.match(blockMatch[0], /existing\(\)\.userId == request\.auth\.uid/);
  }
  for (const col of ['episodeUnlocks', 'sessions']) {
    const blockMatch = rulesContent.match(new RegExp(`match /${col}/\\{[^}]+\\}[\\s\\S]*?(?=\\n\\s*// \\d+\\.|\\n\\s*\\}\\s*\\})`));
    assert.ok(blockMatch, `Found rule block for ${col}`);
    assert.match(blockMatch[0], /existing\(\)\.uid == request\.auth\.uid/);
    assert.match(blockMatch[0], /allow create, update, delete: if false;/);
  }
  const txMatch = rulesContent.match(/match \/coinTransactions\/\{txId\}[\s\S]*?(?=\n\s*\/\/ 12\.)/);
  assert.ok(txMatch, 'Found rule block for coinTransactions');
  assert.match(txMatch[0], /existing\(\)\.uid == request\.auth\.uid/);
  assert.match(txMatch[0], /allow create: if isValidId\(txId\) &&\s*isAdmin\(\) &&\s*isValidCoinTransaction\(incoming\(\), txId\) &&\s*incoming\(\)\.type in \['admin_adjust', 'bonus', 'refund'\]/);
  assert.match(txMatch[0], /allow update, delete: if false;/);
});

test('Dirty Dozen #9 & #10: Path ID hardening, mediaRef, and choicePoint validation present', () => {
  assert.match(rulesContent, /function isValidId\(id\)/);
  assert.match(rulesContent, /function isValidMediaRef\(ref\)/);
  assert.match(rulesContent, /function isValidChoicePoint\(cp\)/);
  assert.match(rulesContent, /ref\.provider in \['demo', 'drive', 'youtube', 'gcs'\]/);
});

test('Dirty Dozen #11 & #12: Immutable fields and server request.time timestamps enforced', () => {
  assert.match(rulesContent, /incoming\(\)\.createdAt == request\.time/);
  assert.match(rulesContent, /incoming\(\)\.updatedAt == request\.time/);
  assert.match(rulesContent, /incoming\(\)\.chosenAt == request\.time/);
  assert.match(rulesContent, /incoming\(\)\.createdAt == existing\(\)\.createdAt/);
});

test('Admin ban & legacy compatibility: UserProfile allows admin flag, session moderation fields, and optional legacy subscriptionTier', () => {
  const userValidation = rulesContent.match(/function isValidUserProfile\(data, userId\)[\s\S]*?\n    \}/);
  assert.ok(userValidation, 'Found isValidUserProfile helper');
  for (const field of ['admin', 'warningCount', 'banned', 'bannedAt', 'banReason', 'activeDevice', 'lastSeen', 'subscriptionTier', 'preferredFormat']) {
    assert.match(userValidation[0], new RegExp(`'${field}'`), `Expected ${field} in isValidUserProfile`);
  }
  assert.match(userValidation[0], /!\('admin' in data\) \|\| data\.admin is bool/);
});

test('Audit logs are strictly admin-only, append-only, and immutable', () => {
  const blockMatch = rulesContent.match(/match \/auditLogs\/\{logId\}[\s\S]*?(?=\n\s*\/\/ 19\.)/);
  assert.ok(blockMatch, 'Found rule block for auditLogs');
  assert.match(blockMatch[0], /allow get: if isValidId\(logId\) && isAdmin\(\);/);
  assert.match(blockMatch[0], /allow list: if isAdmin\(\);/);
  assert.match(blockMatch[0], /allow create: if isValidId\(logId\) &&\s*isAdmin\(\) &&\s*isValidAuditLog\(incoming\(\), logId\)/);
  assert.match(blockMatch[0], /allow update: if false;/);
  assert.match(blockMatch[0], /allow delete: if false;/);
});

test('creatorRequests enforce pending status on create and prevent self-approval', () => {
  const blockMatch = rulesContent.match(/match \/creatorRequests\/\{requestId\}[\s\S]*?(?=\n\s*\/\/ 18\.)/);
  assert.ok(blockMatch, 'Found rule block for creatorRequests');
  assert.match(blockMatch[0], /incoming\(\)\.status == 'pending'/);
  assert.match(blockMatch[0], /!\('reviewedByUid' in incoming\(\)\)/);
  assert.match(blockMatch[0], /existing\(\)\.status == 'rejected' &&\s*incoming\(\)\.status == 'pending'/);
  assert.match(blockMatch[0], /allow delete: if isValidId\(requestId\) && isAdmin\(\);/);
});

test('Creators can only edit or delete their own stories and episodes, cannot self-feature, and cannot change episode priceCoins after create', () => {
  const storiesMatch = rulesContent.match(/match \/stories\/\{storyId\}[\s\S]*?(?=\n\s*\/\/ 6\.)/);
  assert.ok(storiesMatch, 'Found rule block for stories');
  assert.match(storiesMatch[0], /incoming\(\)\.creatorOwnerUid == request\.auth\.uid/);
  assert.match(storiesMatch[0], /incoming\(\)\.isFeatured == false/);
  assert.match(storiesMatch[0], /incoming\(\)\.isEditorsPick == false/);
  assert.match(storiesMatch[0], /existing\(\)\.creatorOwnerUid == request\.auth\.uid/);
  assert.match(storiesMatch[0], /allow delete: if isValidId\(storyId\) && \(\s*isAdmin\(\) \|\| \(isCreatorRole\(\) && existing\(\)\.creatorOwnerUid == request\.auth\.uid\)/);

  const epMatch = rulesContent.match(/match \/episodes\/\{episodeId\}[\s\S]*?(?=\n\s*\/\/ 7\.)/);
  assert.ok(epMatch, 'Found rule block for episodes');
  assert.match(epMatch[0], /incoming\(\)\.priceCoins == existing\(\)\.priceCoins/);
  assert.match(epMatch[0], /!\('accessTier' in incoming\(\)\)/);
  assert.match(epMatch[0], /existing\(\)\.creatorOwnerUid == request\.auth\.uid/);
});

test('Categories, coinPackages, wallets, platformSettings, and siteSettings enforce server/admin write boundaries', () => {
  const catMatch = rulesContent.match(/match \/categories\/\{categoryId\}[\s\S]*?(?=\n\s*\/\/ 4\.)/);
  assert.ok(catMatch, 'Found rule block for categories');
  assert.match(catMatch[0], /allow create: if isValidId\(categoryId\) && isAdmin\(\)/);
  assert.match(catMatch[0], /allow update: if isValidId\(categoryId\) && isAdmin\(\)/);
  assert.match(catMatch[0], /allow delete: if isValidId\(categoryId\) && isAdmin\(\)/);

  const walletMatch = rulesContent.match(/match \/wallets\/\{userId\}[\s\S]*?(?=\n\s*\/\/ 11\.)/);
  assert.ok(walletMatch, 'Found rule block for wallets');
  assert.match(walletMatch[0], /allow create: if isValidId\(userId\) &&\s*isAdmin\(\) &&\s*isValidCoinWallet\(incoming\(\), userId\)/);
  assert.match(walletMatch[0], /allow update: if isValidId\(userId\) &&\s*isAdmin\(\) &&\s*isValidCoinWallet\(incoming\(\), userId\)/);
  assert.match(walletMatch[0], /allow delete: if false;/);

  const siteMatch = rulesContent.match(/match \/siteSettings\/\{settingId\}[\s\S]*?(?=\n\s*\}\s*\})/);
  assert.ok(siteMatch, 'Found rule block for siteSettings');
  assert.match(siteMatch[0], /settingId == 'main'/);
  assert.match(siteMatch[0], /isAdmin\(\)/);
  assert.match(siteMatch[0], /allow delete: if false;/);
});
