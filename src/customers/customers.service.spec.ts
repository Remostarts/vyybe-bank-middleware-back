import { Repository } from 'typeorm';
import { CustomersService } from './customers.service';
import { Customer } from './customer.entity';
import { BlnkClient } from '../blnk/blnk.client';
import { AccountsService } from '../accounts/accounts.service';
import { AppError } from '../common/errors';

const dto = {
  externalUserId: 'u-1',
  firstName: 'Ada',
  lastName: 'Obi',
  email: 'ada@x.com',
  phoneNumber: '+2348000000',
  dateOfBirth: '2004-01-01',
};

const activeAccount = {
  id: 'acc-1', customerId: 'cus-1', blnkBalanceId: 'bln_1', status: 'ACTIVE', currency: 'NGN',
  accountType: 'MAIN', ledgerKey: 'CUSTOMER_MAIN', virtualAccountNumber: '9912345678', createdAt: new Date(),
};

function makeRepo(existing: Partial<Customer> | null) {
  let store: any = existing ? { ...existing } : null;
  return {
    findOneBy: jest.fn(async () => (store ? { ...store } : null)),
    create: jest.fn((v) => ({ ...v })),
    save: jest.fn(async (v) => {
      store = { id: 'cus-1', ...store, ...v };
      return { ...store };
    }),
  } as unknown as Repository<Customer> & { [k: string]: jest.Mock };
}

function makeDeps() {
  const blnk = { createIdentity: jest.fn().mockResolvedValue({ identity_id: 'idt_1' }) };
  const accounts = {
    ensureActiveAccount: jest.fn().mockResolvedValue({ ...activeAccount }),
    findByCustomerId: jest.fn().mockResolvedValue([{ ...activeAccount }]),
  };
  return { blnk: blnk as unknown as BlnkClient & any, accounts: accounts as unknown as AccountsService & any };
}

describe('CustomersService.onboard', () => {
  it('happy path: identity -> account -> ACTIVE, returns dtos', async () => {
    const repo = makeRepo(null);
    const { blnk, accounts } = makeDeps();
    const svc = new CustomersService(repo, blnk, accounts);
    const result = await svc.onboard(dto);
    expect(blnk.createIdentity).toHaveBeenCalledWith(
      // Blnk parses dob with Go's RFC3339 layout, so a bare date is rejected
      expect.objectContaining({
        identity_type: 'individual',
        first_name: 'Ada',
        email_address: 'ada@x.com',
        dob: '2004-01-01T00:00:00Z',
      }),
    );
    expect(accounts.ensureActiveAccount).toHaveBeenCalled();
    expect(result.customer.status).toBe('ACTIVE');
    expect(result.customer.blnkIdentityId).toBe('idt_1');
    expect(result.account.virtualAccountNumber).toBe('9912345678');
  });

  it('rejects an already-ACTIVE external user with 409', async () => {
    const repo = makeRepo({ id: 'cus-1', externalUserId: 'u-1', status: 'ACTIVE' });
    const { blnk, accounts } = makeDeps();
    const svc = new CustomersService(repo, blnk, accounts);
    await expect(svc.onboard(dto)).rejects.toMatchObject({ code: 'CUSTOMER_ALREADY_EXISTS', status: 409 });
    expect(blnk.createIdentity).not.toHaveBeenCalled();
  });

  it('resumes from IDENTITY_CREATED without re-creating the identity', async () => {
    const repo = makeRepo({ id: 'cus-1', externalUserId: 'u-1', status: 'IDENTITY_CREATED', blnkIdentityId: 'idt_1' });
    const { blnk, accounts } = makeDeps();
    const svc = new CustomersService(repo, blnk, accounts);
    const result = await svc.onboard(dto);
    expect(blnk.createIdentity).not.toHaveBeenCalled();
    expect(accounts.ensureActiveAccount).toHaveBeenCalled();
    expect(result.customer.status).toBe('ACTIVE');
  });

  it('wraps Blnk failure as ONBOARDING_INCOMPLETE and leaves the checkpoint', async () => {
    const repo = makeRepo(null);
    const { blnk, accounts } = makeDeps();
    blnk.createIdentity.mockRejectedValue(new AppError('BLNK_UNAVAILABLE', 'down', 502));
    const svc = new CustomersService(repo, blnk, accounts);
    await expect(svc.onboard(dto)).rejects.toMatchObject({ code: 'ONBOARDING_INCOMPLETE', status: 502 });
    expect(accounts.ensureActiveAccount).not.toHaveBeenCalled();
  });
});

describe('CustomersService.getByExternalId', () => {
  it('returns customer with accounts', async () => {
    const repo = makeRepo({ id: 'cus-1', externalUserId: 'u-1', status: 'ACTIVE', blnkIdentityId: 'idt_1', kycTier: 0 });
    const { blnk, accounts } = makeDeps();
    const svc = new CustomersService(repo, blnk, accounts);
    const result = await svc.getByExternalId('u-1');
    expect(result.customer.id).toBe('cus-1');
    expect(result.accounts).toHaveLength(1);
  });

  it('throws CUSTOMER_NOT_FOUND when missing', async () => {
    const svc = new CustomersService(makeRepo(null), makeDeps().blnk, makeDeps().accounts);
    await expect(svc.getByExternalId('nope')).rejects.toMatchObject({ code: 'CUSTOMER_NOT_FOUND', status: 404 });
  });
});
