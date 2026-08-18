/** User / auth session shapes used by the browser SPA. */

export interface PublicUser {
  id: number;
  email?: string | null;
  username?: string | null;
  name?: string | null;
  phone?: string | null;
  balance?: number;
  balance_usdt?: number;
  balance_mmk?: number;
  biometrics_enabled?: boolean;
  kyc_status?: string | null;
}

export interface AuthSession {
  sessionToken: string;
  pinToken?: string | null;
  user?: PublicUser | null;
}

export interface DeviceProfile {
  email: string;
  biometricsEnabled?: boolean;
  savedAt?: number;
}

export interface WalletBalances {
  balance_usdt: number;
  balance_mmk: number;
  usdt_formatted?: string;
  mmk_formatted?: string;
}
