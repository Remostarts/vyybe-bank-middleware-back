import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { AccountsService } from './accounts.service';
import { Account } from './account.entity';
import { BlnkClient } from '../blnk/blnk.client';
import { LedgerService } from '../ledger/ledger.service';
import { Customer } from '../customers/customer.entity';

const config = { get: (k: string) => ({ vanPrefix: '99' })[k as 'vanPrefix'] } as unknown as ConfigService;
const ledgers = { getLedgerId: jest.fn().mockReturnValue('ldg_1'), resolveLedgerId: jest.fn().mockResolvedValue('ldg_1') } as unknown as LedgerService;

const customer = {
  id: 'cus-1',
  blnkIdentityId: 'idt_1',
  status: 'IDENTITY_CREATED',
} as unknown as Customer;

function makeRepo(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
    findOneBy: jest.fn().mockResolvedValue(null),
    create: jest.fn((v) => ({ ...v })),
    save: jest.fn(async (v) => ({ id: 'acc-1', ...v })),
    ...overrides,
  } as unknown as Repository<Account> & { [k: string]: jest.Mock };
}

function makeBlnk() {
  return {
    createBalance: jest.fn().mockResolvedValue({ balance_id: 'bln_1', balance: 0, credit_balance: 0, debit_balance: 0, currency: 'NGN', ledger_id: 'ldg_1' }),
    getBalance: jest.fn().mockResolvedValue({ balance_id: 'bln_1', balance: 5000, credit_balance: 5000, debit_balance: 0, inflight_credit_balance: 0, inflight_debit_balance: 0, currency: 'NGN', ledger_id: 'ldg_1' }),
  } as unknown as BlnkClient & { [k: string]: jest.Mock };
}

describe('AccountsService.ensureActiveAccount', () => {
  it('creates a new account row with a 10-digit VAN and activates it via Blnk', async () => {
    const repo = makeRepo();
    const blnk = makeBlnk();
    const svc = new AccountsService(repo, blnk, ledgers, config);
    const account = await svc.ensureActiveAccount(customer);
    expect(blnk.createBalance).toHaveBeenCalledWith('ldg_1', 'idt_1', 'NGN');
    expect(account.status).toBe('ACTIVE');
    expect(account.blnkBalanceId).toBe('bln_1');
    expect(account.virtualAccountNumber).toMatch(/^\d{10}$/);
  });

  it('resumes an existing PENDING account instead of inserting a new one', async () => {
    const pending = { id: 'acc-1', customerId: 'cus-1', blnkBalanceId: null, status: 'PENDING', currency: 'NGN', accountType: 'MAIN', virtualAccountNumber: '9912345678' };
    const repo = makeRepo({ findOne: jest.fn().mockResolvedValue({ ...pending }) });
    const blnk = makeBlnk();
    const svc = new AccountsService(repo, blnk, ledgers, config);
    const account = await svc.ensureActiveAccount(customer);
    expect(repo.create).not.toHaveBeenCalled();
    expect(account.blnkBalanceId).toBe('bln_1');
    expect(account.status).toBe('ACTIVE');
  });

  it('returns an already-ACTIVE account untouched', async () => {
    const active = { id: 'acc-1', blnkBalanceId: 'bln_9', status: 'ACTIVE', virtualAccountNumber: '9912345678' };
    const repo = makeRepo({ findOne: jest.fn().mockResolvedValue({ ...active }) });
    const blnk = makeBlnk();
    const svc = new AccountsService(repo, blnk, ledgers, config);
    const account = await svc.ensureActiveAccount(customer);
    expect(blnk.createBalance).not.toHaveBeenCalled();
    expect(account.blnkBalanceId).toBe('bln_9');
  });

  it('retries VAN generation on unique-constraint collision', async () => {
    const collision = Object.assign(new Error('duplicate key'), { code: '23505', constraint: 'accounts_virtual_account_number_key' });
    const save = jest
      .fn()
      .mockRejectedValueOnce(collision)
      .mockImplementation(async (v) => ({ id: 'acc-1', ...v }));
    const repo = makeRepo({ save });
    const svc = new AccountsService(repo, makeBlnk(), ledgers, config);
    const account = await svc.ensureActiveAccount(customer);
    expect(account.virtualAccountNumber).toMatch(/^\d{10}$/);
    expect(save.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe('AccountsService.getWithBalance', () => {
  it('merges the live Blnk balance into the account dto in minor units', async () => {
    const row = { id: 'acc-1', customerId: 'cus-1', blnkBalanceId: 'bln_1', status: 'ACTIVE', currency: 'NGN', accountType: 'MAIN', ledgerKey: 'CUSTOMER_MAIN', virtualAccountNumber: '9912345678', createdAt: new Date() };
    const repo = makeRepo({ findOne: jest.fn().mockResolvedValue(row) });
    const svc = new AccountsService(repo, makeBlnk(), ledgers, config);
    const result = await svc.getWithBalance({ id: 'acc-1' });
    expect(result.balance).toEqual({
      available: 5000,
      creditBalance: 5000,
      debitBalance: 0,
      inflightCreditBalance: 0,
      inflightDebitBalance: 0,
      currency: 'NGN',
      precision: 100,
    });
  });

  it('throws ACCOUNT_NOT_FOUND when missing', async () => {
    const svc = new AccountsService(makeRepo(), makeBlnk(), ledgers, config);
    await expect(svc.getWithBalance({ id: 'nope' })).rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND', status: 404 });
  });
});
