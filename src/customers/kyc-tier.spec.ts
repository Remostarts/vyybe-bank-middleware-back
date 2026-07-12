import { Repository } from 'typeorm';
import { CustomersService } from './customers.service';
import { Customer } from './customer.entity';
import { BlnkClient } from '../blnk/blnk.client';
import { AccountsService } from '../accounts/accounts.service';

const base: Partial<Customer> = {
  id: 'cus-1', externalUserId: 'u-1', firstName: 'Ada', lastName: 'Obi', email: 'ada@x.com',
  phoneNumber: '+234', dateOfBirth: '2004-01-01', kycTier: 0, status: 'ACTIVE', blnkIdentityId: 'idt_1',
};

function makeRepo(existing: Partial<Customer> | null) {
  let store: any = existing ? { ...existing } : null;
  return {
    findOneBy: jest.fn(async () => (store ? { ...store } : null)),
    create: jest.fn((v) => ({ ...v })),
    save: jest.fn(async (v) => {
      store = { ...store, ...v };
      return { ...store };
    }),
  } as unknown as Repository<Customer> & { [k: string]: jest.Mock };
}

describe('CustomersService.setKycTier', () => {
  it('updates the tier locally and mirrors it into the Blnk identity metadata', async () => {
    const repo = makeRepo(base);
    const blnk = { updateIdentity: jest.fn().mockResolvedValue({ identity_id: 'idt_1' }) };
    const svc = new CustomersService(repo, blnk as unknown as BlnkClient, {} as AccountsService);
    const customer = await svc.setKycTier('cus-1', 2);
    expect(customer.kycTier).toBe(2);
    expect(blnk.updateIdentity).toHaveBeenCalledWith(
      'idt_1',
      expect.objectContaining({ meta_data: expect.objectContaining({ kyc_tier: 2 }) }),
    );
  });

  it('throws CUSTOMER_NOT_FOUND for a missing customer', async () => {
    const svc = new CustomersService(makeRepo(null), {} as BlnkClient, {} as AccountsService);
    await expect(svc.setKycTier('nope', 1)).rejects.toMatchObject({ code: 'CUSTOMER_NOT_FOUND' });
  });
});
