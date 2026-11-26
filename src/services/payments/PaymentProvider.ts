import type { CoinPackage, PaymentProviderType } from '../../types';

export const DEFAULT_COIN_PACKAGES: CoinPackage[] = [
  {
    id: 'pkg-starter-50',
    name: 'Starter Pouch',
    nameHi: 'स्टार्टर पैक',
    coins: 50,
    bonusCoins: 0,
    priceInr: 49,
    active: true,
    sortOrder: 1,
  },
  {
    id: 'pkg-storyteller-150',
    name: 'Storyteller Pack',
    nameHi: 'कथाकार पैक',
    coins: 150,
    bonusCoins: 25,
    priceInr: 129,
    active: true,
    sortOrder: 2,
  },
  {
    id: 'pkg-constellation-400',
    name: 'Constellation Chest',
    nameHi: 'नक्षत्र पैक',
    coins: 400,
    bonusCoins: 100,
    priceInr: 299,
    active: true,
    sortOrder: 3,
  },
  {
    id: 'pkg-patron-1000',
    name: 'Patron Vault',
    nameHi: 'संरक्षक वॉल्ट',
    coins: 1000,
    bonusCoins: 300,
    priceInr: 699,
    active: true,
    sortOrder: 4,
  },
];

export function formatInr(amount: number): string {
  const safe = Number.isFinite(amount) ? Math.max(0, Math.round(amount)) : 0;
  return `₹${safe.toLocaleString('en-IN')}`;
}

export interface CoinCheckoutReceipt {
  provider: PaymentProviderType;
  receiptId: string;
  packageId: string;
  packageName: string;
  baseCoins: number;
  bonusCoins: number;
  coinsCredited: number;
  totalCoins: number;
  priceInr: number;
  isSimulated: boolean;
  completedAt: number;
  message: string;
}

/**
 * PaymentProvider abstraction for purchasing Dhruv Tales coin packages.
 * Keeps payment verification isolated so a real gateway (e.g. Razorpay) can
 * plug in cleanly behind this interface later without changing wallet or UI logic.
 */
export interface PaymentProvider {
  readonly id: PaymentProviderType;
  readonly providerId: PaymentProviderType;
  readonly displayName: string;
  readonly isSimulated: boolean;
  completeCoinPackagePurchase(
    coinPackage: CoinPackage,
    userId: string,
    nowMs?: number
  ): Promise<CoinCheckoutReceipt>;
}

export class MockPaymentProvider implements PaymentProvider {
  readonly id: PaymentProviderType = 'mock';
  readonly providerId: PaymentProviderType = 'mock';
  readonly displayName = 'Demo Payments Only (Mock)';
  readonly isSimulated = true;

  async completeCoinPackagePurchase(
    coinPackage: CoinPackage,
    userId: string,
    nowMs: number = Date.now()
  ): Promise<CoinCheckoutReceipt> {
    if (!userId || !userId.trim()) {
      throw new Error('A valid user ID is required for checkout.');
    }
    if (!coinPackage.active) {
      throw new Error('This coin package is not currently active.');
    }
    const baseCoins = Math.max(0, Math.floor(coinPackage.coins));
    const bonusCoins = Math.max(0, Math.floor(coinPackage.bonusCoins));
    const totalCoins = baseCoins + bonusCoins;
    if (totalCoins <= 0) {
      throw new Error('Coin package must grant at least 1 coin.');
    }

    const suffix = String(nowMs).slice(-6);
    const shortId = coinPackage.id.replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 12);
    return {
      provider: 'mock',
      receiptId: `mock_coin_${shortId}_${suffix}`,
      packageId: coinPackage.id,
      packageName: coinPackage.name,
      baseCoins,
      bonusCoins,
      coinsCredited: totalCoins,
      totalCoins,
      priceInr: Math.max(0, coinPackage.priceInr),
      isSimulated: true,
      completedAt: nowMs,
      message: `Demo payment completed — added ${totalCoins} coins (no real money charged).`,
    };
  }
}

/**
 * Placeholder stub for future Razorpay integration.
 * Intentionally rejects until server-side Razorpay order & webhook verification are added.
 */
export class RazorpayStubPaymentProvider implements PaymentProvider {
  readonly id: PaymentProviderType = 'razorpay_stub';
  readonly providerId: PaymentProviderType = 'razorpay_stub';
  readonly displayName = 'Razorpay Gateway (Coming Soon)';
  readonly isSimulated = false;

  async completeCoinPackagePurchase(
    _coinPackage: CoinPackage,
    _userId: string
  ): Promise<CoinCheckoutReceipt> {
    throw new Error(
      'Razorpay gateway is not yet configured. Use Demo payments (MockPaymentProvider) during testing.'
    );
  }
}

export const mockPaymentProvider = new MockPaymentProvider();
export const razorpayStubPaymentProvider = new RazorpayStubPaymentProvider();

export function getPaymentProvider(type: PaymentProviderType = 'mock'): PaymentProvider {
  if (type === 'razorpay_stub') return razorpayStubPaymentProvider;
  return mockPaymentProvider;
}
