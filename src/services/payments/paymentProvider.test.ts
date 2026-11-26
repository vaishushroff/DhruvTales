import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_COIN_PACKAGES,
  formatInr,
  getPaymentProvider,
  MockPaymentProvider,
  RazorpayStubPaymentProvider,
} from './PaymentProvider';

test('MockPaymentProvider completes a simulated coin package purchase with base + bonus coins', async () => {
  const provider = new MockPaymentProvider();
  assert.equal(provider.isSimulated, true);
  const pkg = DEFAULT_COIN_PACKAGES[1]; // 120 + 15 bonus
  const now = Date.UTC(2026, 5, 1, 0, 0, 0);

  const receipt = await provider.completeCoinPackagePurchase(pkg, 'u_listener_1', now);
  assert.equal(receipt.isSimulated, true);
  assert.equal(receipt.provider, 'mock');
  assert.equal(receipt.packageId, pkg.id);
  assert.equal(receipt.coinsCredited, pkg.coins + pkg.bonusCoins);
  assert.equal(receipt.priceInr, pkg.priceInr);
  assert.equal(receipt.completedAt, now);
  assert.match(receipt.receiptId, /^mock_coin_/);
});

test('MockPaymentProvider rejects inactive coin packages', async () => {
  const provider = getPaymentProvider('mock');
  const inactivePkg = { ...DEFAULT_COIN_PACKAGES[0], active: false };
  await assert.rejects(
    () => provider.completeCoinPackagePurchase(inactivePkg, 'u_listener_1'),
    /not currently active/i
  );
});

test('RazorpayStubPaymentProvider rejects live checkout transparently until configured', async () => {
  const stub = new RazorpayStubPaymentProvider();
  assert.equal(stub.isSimulated, false);
  assert.equal(stub.id, 'razorpay_stub');
  await assert.rejects(
    () => stub.completeCoinPackagePurchase(DEFAULT_COIN_PACKAGES[0], 'u_listener_1'),
    /not yet configured/i
  );
  assert.equal(formatInr(199), '₹199');
});
