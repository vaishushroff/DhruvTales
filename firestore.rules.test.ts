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
  for (const collectionPath of paths) {
    const matchPattern = collectionPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(
      rulesContent,
      new RegExp(`match\\s+${matchPattern}`),
      `Missing match block for ${collectionPath}`
    );
  }
});

test('Dirty Dozen #1 & #2: Users cannot self-assign role, escalate role, or self-enable on update', () => {
  assert.match(rulesContent, /incoming\(\)\.role\s*==\s*'user'/);
  assert.match(rulesContent, /incoming\(\)\.role\s*==\s*existing\(\)\.role/);
  assert.match(rulesContent, /incoming\(\)\.isDisabled\s*==\s*false/);
});

test('Dirty Dozen #3: Strict key allowlists prevent shadow field injection', () => {
  assert.match(rulesContent, /data\.keys\(\)\.hasOnly\(/);
  assert.match(rulesContent, /affectedKeys\(\)\.hasOnly\(/);
});

test('Dirty Dozen #4: Users PII is strictly isolated to owner or admin', () => {
  assert.match(rulesContent, /match \/users\/\{userId\}[\s\S]*allow get: if isValidId\(userId\) && \(isOwner\(userId\) \|\| isAdmin\(\)\);/);
  assert.match(rulesContent, /match \/users\/\{userId\}[\s\S]*allow list: if isAdmin\(\);/);
});

test('Dirty Dozen #5: Admin verification mandates email_verified == true', () => {
  assert.match(rulesContent, /function isVerified\(\)\s*\{\s*return isSignedIn\(\) && request\.auth\.token\.email_verified == true;\s*\}/);
  assert.match(rulesContent, /function isAdmin\(\)\s*\{\s*return isVerified\(\)/);
});

test('Dirty Dozen #7 & #8: Personal collections including userChoices & creatorRequests enforce userId == request.auth.uid', () => {
  for (const col of ['listeningHistory', 'bookmarks', 'dailyUnlocks', 'subscriptions', 'userChoices', 'creatorRequests']) {
    const blockMatch = rulesContent.match(new RegExp(`match /${col}/\\{[^}]+\\}[\\s\\S]*?(?=\\n\\s*// \\d+\\.|\\n\\s*\\}\\s*\\})`));
    assert.ok(blockMatch, `Found rule block for ${col}`);
    assert.match(blockMatch[0], /existing\(\)\.userId == request\.auth\.uid/);
  }
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

test('Phase 3: UserProfile supports preferredFormat and userChoices enforces owner-only writes', () => {
  assert.match(rulesContent, /'preferredFormat'/);
  assert.match(rulesContent, /function isValidUserChoice\(data, userChoiceId\)/);
  assert.match(rulesContent, /data\.userId == request\.auth\.uid/);
});

test('Phase 4: auditLogs are strictly admin-only, append-only, and immutable', () => {
  const blockMatch = rulesContent.match(/match \/auditLogs\/\{logId\}[\s\S]*?(?=\n\s*\}\s*\})/);
  assert.ok(blockMatch, 'Found rule block for auditLogs');
  assert.match(blockMatch[0], /allow get: if isValidId\(logId\) && isAdmin\(\);/);
  assert.match(blockMatch[0], /allow list: if isAdmin\(\);/);
  assert.match(blockMatch[0], /allow create: if isValidId\(logId\) &&\s*isAdmin\(\) &&\s*isValidAuditLog\(incoming\(\), logId\)/);
  assert.match(blockMatch[0], /allow update: if false;/);
  assert.match(blockMatch[0], /allow delete: if false;/);
});

test('Phase 4: creatorRequests enforce pending status on create and prevent self-approval', () => {
  const blockMatch = rulesContent.match(/match \/creatorRequests\/\{requestId\}[\s\S]*?(?=\n\s*\/\/ 14\.)/);
  assert.ok(blockMatch, 'Found rule block for creatorRequests');
  assert.match(blockMatch[0], /incoming\(\)\.status == 'pending'/);
  assert.match(blockMatch[0], /!\('reviewedByUid' in incoming\(\)\)/);
  assert.match(blockMatch[0], /existing\(\)\.status == 'rejected' &&\s*incoming\(\)\.status == 'pending'/);
  assert.match(blockMatch[0], /allow delete: if isValidId\(requestId\) && isAdmin\(\);/);
});

test('Phase 4: Creators can only edit or delete their own stories and episodes, and cannot self-feature', () => {
  const storiesMatch = rulesContent.match(/match \/stories\/\{storyId\}[\s\S]*?(?=\n\s*\/\/ 6\.)/);
  assert.ok(storiesMatch, 'Found rule block for stories');
  assert.match(storiesMatch[0], /incoming\(\)\.creatorOwnerUid == request\.auth\.uid/);
  assert.match(storiesMatch[0], /incoming\(\)\.isFeatured == false/);
  assert.match(storiesMatch[0], /incoming\(\)\.isEditorsPick == false/);
  assert.match(storiesMatch[0], /existing\(\)\.creatorOwnerUid == request\.auth\.uid/);
  assert.match(storiesMatch[0], /allow delete: if isValidId\(storyId\) && \(\s*isAdmin\(\) \|\| \(isCreatorRole\(\) && existing\(\)\.creatorOwnerUid == request\.auth\.uid\)/);

  const epMatch = rulesContent.match(/match \/episodes\/\{episodeId\}[\s\S]*?(?=\n\s*\/\/ 7\.)/);
  assert.ok(epMatch, 'Found rule block for episodes');
  assert.match(epMatch[0], /'episodeNumber'/);
  assert.match(epMatch[0], /existing\(\)\.creatorOwnerUid == request\.auth\.uid/);
});

test('Phase 4: Categories enforce Admin-only CRUD and Subscriptions validate simulated period-end fields', () => {
  const catMatch = rulesContent.match(/match \/categories\/\{categoryId\}[\s\S]*?(?=\n\s*\/\/ 4\.)/);
  assert.ok(catMatch, 'Found rule block for categories');
  assert.match(catMatch[0], /allow create: if isValidId\(categoryId\) && isAdmin\(\)/);
  assert.match(catMatch[0], /allow update: if isValidId\(categoryId\) && isAdmin\(\)/);
  assert.match(catMatch[0], /allow delete: if isValidId\(categoryId\) && isAdmin\(\)/);

  assert.match(rulesContent, /'cancelAtPeriodEnd'/);
  assert.match(rulesContent, /'currentPeriodEnd'/);
  assert.match(rulesContent, /data\.isSimulated == true/);
});
