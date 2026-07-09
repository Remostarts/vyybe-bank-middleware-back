export interface CreateBlnkIdentityRequest {
  identity_type: 'individual';
  first_name: string;
  last_name: string;
  email_address: string;
  phone_number: string;
  dob: string; // ISO date
  meta_data?: Record<string, unknown>;
}

export interface BlnkIdentity {
  identity_id: string;
}

export interface BlnkLedger {
  ledger_id: string;
  name: string;
}

export interface BlnkBalance {
  balance_id: string;
  balance: number;
  credit_balance: number;
  debit_balance: number;
  inflight_credit_balance?: number;
  inflight_debit_balance?: number;
  currency: string;
  ledger_id: string;
  identity_id?: string;
}
