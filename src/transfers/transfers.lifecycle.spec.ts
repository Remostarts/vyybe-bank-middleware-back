import { Repository } from 'typeorm';
import { TransfersService } from './transfers.service';
import { Transfer } from './transfer.entity';
import { Account } from '../accounts/account.entity';
import { Customer } from '../customers/customer.entity';
import { BlnkClient } from '../blnk/blnk.client';
import { LimitsService } from './limits.service';
import { InternalAccountsService } from '../ledger/internal-accounts.service';

function makeService(row: Partial<Transfer> | null, blnkOverrides: Record<string, jest.Mock> = {}) {
  const store: any = row ? { ...row } : null;
  const repo = {
    findOneBy: jest.fn(async () => (store ? { ...store } : null)),
    save: jest.fn(async (v: any) => ({ ...store, ...v })),
    create: jest.fn((v) => v),
  } as unknown as Repository<Transfer> & { [k: string]: jest.Mock };
  const blnk = {
    updateInflight: jest.fn().mockResolvedValue({ transaction_id: 'txn_1', status: 'APPLIED', reference: 'tr-1' }),
    getTransactionByReference: jest.fn().mockResolvedValue(null),
    ...blnkOverrides,
  } as unknown as BlnkClient & { [k: string]: jest.Mock };
  const svc = new TransfersService(
    repo,
    {} as Repository<Account>,
    {} as Repository<Customer>,
    blnk,
    {} as LimitsService,
    {} as InternalAccountsService,
  );
  return { svc, repo, blnk };
}

const inflightRow: Partial<Transfer> = {
  id: 'tr-1', type: 'P2P', status: 'INFLIGHT', blnkTransactionId: 'txn_1',
  amount: 1000, currency: 'NGN', createdAt: new Date(), fromAccountId: 'acc-a', toAccountId: 'acc-b',
  narration: null, metadata: null,
};

describe('commit / void', () => {
  it('commits an INFLIGHT transfer', async () => {
    const { svc, blnk } = makeService(inflightRow);
    const result = await svc.commit('tr-1');
    expect(blnk.updateInflight).toHaveBeenCalledWith('txn_1', 'commit');
    expect(result.status).toBe('COMMITTED');
  });

  it('voids an INFLIGHT transfer', async () => {
    const { svc, blnk } = makeService(inflightRow);
    const result = await svc.void_('tr-1');
    expect(blnk.updateInflight).toHaveBeenCalledWith('txn_1', 'void');
    expect(result.status).toBe('VOIDED');
  });

  it('rejects commit on a non-INFLIGHT transfer', async () => {
    const { svc } = makeService({ ...inflightRow, status: 'APPLIED' });
    await expect(svc.commit('tr-1')).rejects.toMatchObject({ code: 'INVALID_TRANSFER_STATE', status: 409 });
  });

  it('404s an unknown transfer', async () => {
    const { svc } = makeService(null);
    await expect(svc.commit('nope')).rejects.toMatchObject({ code: 'TRANSFER_NOT_FOUND', status: 404 });
  });
});

describe('getById re-sync', () => {
  it('returns final rows without calling Blnk', async () => {
    const { svc, blnk } = makeService({ ...inflightRow, status: 'APPLIED' });
    await expect(svc.getById('tr-1')).resolves.toMatchObject({ status: 'APPLIED' });
    expect(blnk.getTransactionByReference).not.toHaveBeenCalled();
  });

  it('adopts Blnk status for a PENDING row found by reference', async () => {
    const { svc } = makeService(
      { ...inflightRow, status: 'PENDING', blnkTransactionId: null },
      { getTransactionByReference: jest.fn().mockResolvedValue({ transaction_id: 'txn_9', status: 'APPLIED', reference: 'tr-1' }) },
    );
    const result = await svc.getById('tr-1');
    expect(result.status).toBe('APPLIED');
    expect(result.blnkTransactionId).toBe('txn_9');
  });

  it('marks an old PENDING row FAILED when Blnk has no record', async () => {
    const old = new Date(Date.now() - 120_000);
    const { svc } = makeService({ ...inflightRow, status: 'PENDING', blnkTransactionId: null, createdAt: old });
    await expect(svc.getById('tr-1')).resolves.toMatchObject({ status: 'FAILED' });
  });

  it('keeps a fresh PENDING row PENDING when Blnk has no record yet', async () => {
    const { svc, repo } = makeService({ ...inflightRow, status: 'PENDING', blnkTransactionId: null, createdAt: new Date() });
    await expect(svc.getById('tr-1')).resolves.toMatchObject({ status: 'PENDING' });
    expect(repo.save).not.toHaveBeenCalled();
  });
});
