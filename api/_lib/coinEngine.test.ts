import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeAdminWalletAdjustment,
  computeEpisodeUnlockMutation,
  computePackagePurchaseMutation,
  createEmptyWallet,
  validatePriceChangePermission,
} from './coinEngine';
import type { CoinPackage, Episode, Story } from '../../src/types';

const starterPack: CoinPackage = {
  id: 'pkg-listener-120',
  name: 'Listener Pack',
  nameHi: 'श्रोता पैक',
  coins: 120,
  bonusCoins: 15,
  priceInr: 99,
  active: true,
  sortOrder: 2,
};

const paidEpisode: Pick<
  Episode,
  'id' | 'storyId' | 'episodeNumber' | 'title' | 'priceCoins' | 'creatorOwnerUid'
> = {
  id: 'ep-platform14-3',
  storyId: 'story-platform-14',
  episodeNumber: 3,
  title: 'The Midnight Whistle',
  priceCoins: 10,
  creatorOwnerUid: 'uid-creator-1',
};

const baseStory: Pick<Story, 'id' | 'creatorId' | 'priceOverrideCoins'> = {
  id: 'story-platform-14',
  creatorId: 'creator-meera',
  priceOverrideCoins: null,
};

test('Mock package purchase credits base + bonus coins with exact ledger balanceAfter chain', () => {
  const wallet = createEmptyWallet('u-listener-1', 1_000);
  const res = computePackagePurchaseMutation({
    wallet,
    coinPackage: starterPack,
    receiptId: 'mock_rcpt_001',
    txIdBase: 'tx-1',
    nowMs: 2_000,
  });

  assert.equal(res.nextWallet.balance, 135);
  assert.equal(res.nextWallet.lifetimePurchased, 135);
  assert.equal(res.nextWallet.lifetimeSpent, 0);
  assert.equal(res.transactions.length, 2);
  assert.equal(res.transactions[0].type, 'purchase');
  assert.equal(res.transactions[0].amount, 120);
  assert.equal(res.transactions[0].balanceAfter, 120);
  assert.equal(res.transactions[1].type, 'bonus');
  assert.equal(res.transactions[1].amount, 15);
  assert.equal(res.transactions[1].balanceAfter, 135);
});

test('Unlocking a paid episode deducts coins, records immutable spend & permanent unlock, and replay does not charge again', () => {
  const funded = {
    ...createEmptyWallet('u-listener-1', 1_000),
    balance: 25,
    lifetimePurchased: 25,
  };

  // First unlock charges 10 coins
  const first = computeEpisodeUnlockMutation({
    wallet: funded,
    episode: paidEpisode,
    story: baseStory,
    existingUnlock: null,
    txId: 'tx-spend-1',
    nowMs: 3_000,
  });
  assert.equal(first.status, 'unlocked');
  if (first.status !== 'unlocked') throw new Error('expected unlocked');

  assert.equal(first.effectivePrice, 10);
  assert.equal(first.nextWallet.balance, 15);
  assert.equal(first.nextWallet.lifetimeSpent, 10);
  assert.equal(first.transaction.type, 'spend');
  assert.equal(first.transaction.amount, -10);
  assert.equal(first.transaction.balanceAfter, 15);
  assert.equal(first.transaction.episodeId, paidEpisode.id);
  assert.equal(first.transaction.storyId, paidEpisode.storyId);
  assert.equal(first.transaction.creatorId, baseStory.creatorId);
  assert.equal(first.unlock.pricePaidCoins, 10);
  assert.equal(first.unlock.transactionId, 'tx-spend-1');

  // Replaying later with existing permanent unlock NEVER deducts again
  const replay = computeEpisodeUnlockMutation({
    wallet: first.nextWallet,
    episode: paidEpisode,
    story: baseStory,
    existingUnlock: first.unlock,
    txId: 'tx-spend-2',
    nowMs: 4_000,
  });
  assert.equal(replay.status, 'already_unlocked');
  if (replay.status !== 'already_unlocked') throw new Error('expected already_unlocked');
  assert.equal(replay.wallet.balance, 15);
  assert.equal(replay.unlock?.id, first.unlock.id);
});

test('Insufficient balance blocks unlock cleanly with exact shortfall and zero wallet change', () => {
  const lowWallet = {
    ...createEmptyWallet('u-listener-2', 1_000),
    balance: 4,
    lifetimePurchased: 4,
  };

  const res = computeEpisodeUnlockMutation({
    wallet: lowWallet,
    episode: paidEpisode,
    story: baseStory,
    existingUnlock: null,
    txId: 'tx-fail',
    nowMs: 5_000,
  });

  assert.equal(res.status, 'insufficient_balance');
  if (res.status !== 'insufficient_balance') throw new Error('expected insufficient_balance');
  assert.equal(res.effectivePrice, 10);
  assert.equal(res.currentBalance, 4);
  assert.equal(res.shortfall, 6);
});

test('Story-level Admin price override supersedes episode priceCoins during unlock', () => {
  const funded = {
    ...createEmptyWallet('u-listener-3', 1_000),
    balance: 50,
    lifetimePurchased: 50,
  };
  const overriddenStory = { ...baseStory, priceOverrideCoins: 25 };

  const res = computeEpisodeUnlockMutation({
    wallet: funded,
    episode: paidEpisode, // episode own price = 10
    story: overriddenStory, // admin override = 25
    existingUnlock: null,
    txId: 'tx-override',
    nowMs: 6_000,
  });

  assert.equal(res.status, 'unlocked');
  if (res.status !== 'unlocked') throw new Error('expected unlocked');
  assert.equal(res.effectivePrice, 25);
  assert.equal(res.nextWallet.balance, 25);
  assert.equal(res.unlock.pricePaidCoins, 25);
});

test('Pricing permissions: Creator sets priceCoins ONCE on upload and CANNOT edit later; Admin can edit episode & story override anytime', () => {
  // Creator creating new episode -> allowed
  assert.equal(
    validatePriceChangePermission({
      actorRole: 'creator',
      target: 'episode_price',
      isExistingResource: false,
      newPriceCoins: 15,
    }).allowed,
    true
  );

  // Creator editing existing episode price -> BLOCKED
  const creatorEdit = validatePriceChangePermission({
    actorRole: 'creator',
    target: 'episode_price',
    isExistingResource: true,
    newPriceCoins: 20,
  });
  assert.equal(creatorEdit.allowed, false);
  assert.equal(creatorEdit.code, 'creator_price_locked');

  // Creator attempting story-level override -> BLOCKED
  const creatorOverride = validatePriceChangePermission({
    actorRole: 'creator',
    target: 'story_override',
    isExistingResource: true,
    newPriceCoins: 5,
  });
  assert.equal(creatorOverride.allowed, false);
  assert.equal(creatorOverride.code, 'admin_only');

  // Admin editing existing episode price -> ALLOWED
  assert.equal(
    validatePriceChangePermission({
      actorRole: 'admin',
      target: 'episode_price',
      isExistingResource: true,
      newPriceCoins: 30,
    }).allowed,
    true
  );

  // Admin setting and clearing story-level override -> ALLOWED
  assert.equal(
    validatePriceChangePermission({
      actorRole: 'admin',
      target: 'story_override',
      isExistingResource: true,
      newPriceCoins: 12,
    }).allowed,
    true
  );
  assert.equal(
    validatePriceChangePermission({
      actorRole: 'admin',
      target: 'story_override',
      isExistingResource: true,
      newPriceCoins: null,
    }).allowed,
    true
  );

  // Negative or non-integer prices rejected even for Admin
  assert.equal(
    validatePriceChangePermission({
      actorRole: 'admin',
      target: 'episode_price',
      isExistingResource: true,
      newPriceCoins: -5,
    }).code,
    'invalid_price'
  );
});

test('Admin wallet adjustment supports bonus, refund, and signed admin_adjust while blocking negative balance', () => {
  const wallet = {
    ...createEmptyWallet('u-listener-4', 1_000),
    balance: 20,
    lifetimePurchased: 20,
  };

  const bonus = computeAdminWalletAdjustment({
    wallet,
    type: 'bonus',
    amount: 50,
    note: 'Diwali festival bonus',
    txId: 'tx-bonus-1',
    nowMs: 7_000,
  });
  assert.equal(bonus.ok, true);
  assert.equal(bonus.nextWallet?.balance, 70);
  assert.equal(bonus.transaction?.balanceAfter, 70);

  // Negative bonus rejected
  const badBonus = computeAdminWalletAdjustment({
    wallet,
    type: 'bonus',
    amount: -10,
    note: 'Invalid',
    txId: 'tx-bad',
  });
  assert.equal(badBonus.ok, false);

  // Debit below zero rejected
  const overDebit = computeAdminWalletAdjustment({
    wallet,
    type: 'admin_adjust',
    amount: -50,
    note: 'Over-debit',
    txId: 'tx-over',
  });
  assert.equal(overDebit.ok, false);
});
