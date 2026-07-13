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

describe('history', () => {
  function makeHistoryService(rows: Partial<Transfer>[], counterparties: Partial<Account>[] = []) {
    const qb: any = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(rows),
    };
    const repo = { createQueryBuilder: jest.fn(() => qb) } as unknown as Repository<Transfer>;
    const accountRepo = { findBy: jest.fn().mockResolvedValue(counterparties) } as unknown as Repository<Account> & {
      findBy: jest.Mock;
    };
    const svc = new TransfersService(
      repo,
      accountRepo,
      {} as Repository<Customer>,
      {} as BlnkClient,
      {} as LimitsService,
      {} as InternalAccountsService,
    );
    return { svc, qb, accountRepo };
  }

  const t0 = new Date('2026-07-01T10:00:00.000Z');
  const t1 = new Date('2026-07-01T09:00:00.000Z');

  const p2pIn: Partial<Transfer> = {
    id: 'tr-10', type: 'P2P', status: 'APPLIED', amount: 5000, currency: 'NGN',
    fromAccountId: 'acc-b', toAccountId: 'acc-a', narration: 'lunch', createdAt: t0,
  };
  const depositIn: Partial<Transfer> = {
    id: 'tr-11', type: 'DEPOSIT', status: 'APPLIED', amount: 20000, currency: 'NGN',
    fromAccountId: null, toAccountId: 'acc-a', narration: null, createdAt: t1,
  };

  it('maps direction and counterparty for P2P and deposit rows', async () => {
    const { svc, accountRepo } = makeHistoryService(
      [p2pIn, depositIn],
      [{ id: 'acc-b', customerId: 'cus-b', virtualAccountNumber: '1234567890' }],
    );
    const { items, nextCursor } = await svc.history('acc-a', 25);
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      id: 'tr-10',
      direction: 'IN',
      counterparty: { customerId: 'cus-b', accountNumber: '1234567890' },
      amount: 5000,
      currency: 'NGN',
      status: 'APPLIED',
      narration: 'lunch',
      createdAt: t0,
    });
    expect(items[1]).toMatchObject({ id: 'tr-11', direction: 'IN', counterparty: null, amount: 20000 });
    expect(accountRepo.findBy).toHaveBeenCalledTimes(1);
    expect(nextCursor).toBeNull();
  });

  it('returns a nextCursor encoding the last page row when more rows exist', async () => {
    const { svc } = makeHistoryService([p2pIn, depositIn]);
    const { items, nextCursor } = await svc.history('acc-a', 1);
    expect(items).toHaveLength(1);
    expect(nextCursor).not.toBeNull();
    expect(Buffer.from(nextCursor as string, 'base64url').toString('utf8')).toBe(`${t0.toISOString()}|tr-10`);
  });

  it('returns a null nextCursor when the page is not full past the limit', async () => {
    const { svc } = makeHistoryService([p2pIn]);
    const { nextCursor } = await svc.history('acc-a', 1);
    expect(nextCursor).toBeNull();
  });

  it('rejects a malformed cursor with VALIDATION_ERROR', async () => {
    const { svc } = makeHistoryService([]);
    await expect(svc.history('acc-a', 25, 'not-a-cursor')).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
  });

  it('rejects a cursor whose date part is not an ISO timestamp', async () => {
    const { svc } = makeHistoryService([]);
    const cursor = Buffer.from('1|550e8400-e29b-41d4-a716-446655440000').toString('base64url');
    await expect(svc.history('acc-a', 25, cursor)).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
  });

  it('rejects a cursor whose id part is not a uuid', async () => {
    const { svc } = makeHistoryService([]);
    const cursor = Buffer.from('2026-07-01T10:00:00.000Z|not-a-uuid').toString('base64url');
    await expect(svc.history('acc-a', 25, cursor)).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
  });

  it('accepts a well-formed cursor and applies the keyset predicate', async () => {
    const { svc, qb } = makeHistoryService([]);
    const cursor = Buffer.from('2026-07-01T10:00:00.000Z|550e8400-e29b-41d4-a716-446655440000').toString('base64url');
    await svc.history('acc-a', 25, cursor);
    expect(qb.andWhere).toHaveBeenCalledWith(
      '(t.created_at, t.id) < (:cAt, :cId)',
      expect.objectContaining({ cId: '550e8400-e29b-41d4-a716-446655440000', cAt: '2026-07-01T10:00:00.000Z' }),
    );
  });
});
