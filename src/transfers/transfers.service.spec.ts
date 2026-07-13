import { Repository } from 'typeorm';
import { TransfersService } from './transfers.service';
import { Transfer } from './transfer.entity';
import { Account } from '../accounts/account.entity';
import { Customer } from '../customers/customer.entity';
import { BlnkClient } from '../blnk/blnk.client';
import { LimitsService } from './limits.service';
import { InternalAccountsService } from '../ledger/internal-accounts.service';
import { AppError } from '../common/errors';

const accA = { id: 'acc-a', customerId: 'cus-a', blnkBalanceId: 'bln_a', status: 'ACTIVE', currency: 'NGN', virtualAccountNumber: '9900000019' };
const accB = { id: 'acc-b', customerId: 'cus-b', blnkBalanceId: 'bln_b', status: 'ACTIVE', currency: 'NGN', virtualAccountNumber: '9900000027' };

function makeDeps() {
  const transferRepo = {
    create: jest.fn((v) => ({ ...v })),
    save: jest.fn(async (v: Partial<Transfer>) => ({ id: v.id ?? 'tr-1', createdAt: new Date(), ...v })),
    findOneBy: jest.fn(),
  } as unknown as Repository<Transfer> & { save: jest.Mock };
  const accountRepo = {
    findOneBy: jest.fn(async (w: any) =>
      [accA, accB].find((a) => a.id === w.id || a.virtualAccountNumber === w.virtualAccountNumber) ?? null),
  } as unknown as Repository<Account> & { [k: string]: jest.Mock };
  const customerRepo = {
    findOneBy: jest.fn().mockResolvedValue({ id: 'cus-a', kycTier: 1 }),
  } as unknown as Repository<Customer>;
  const blnk = {
    createTransaction: jest.fn().mockResolvedValue({ transaction_id: 'txn_1', status: 'APPLIED', reference: 'tr-1' }),
  } as unknown as BlnkClient & { createTransaction: jest.Mock };
  const limits = { assertWithinLimits: jest.fn().mockResolvedValue(undefined) } as unknown as LimitsService & { [k: string]: jest.Mock };
  const internals = { resolveBalanceId: jest.fn().mockResolvedValue('bln_susp') } as unknown as InternalAccountsService;
  return { transferRepo, accountRepo, customerRepo, blnk, limits, internals };
}

function makeService(d = makeDeps()) {
  return { svc: new TransfersService(d.transferRepo, d.accountRepo, d.customerRepo, d.blnk, d.limits, d.internals), d };
}

describe('TransfersService.createTransfer', () => {
  const dto = { fromAccountId: 'acc-a', toAccountId: 'acc-b', amount: 25000, narration: 'lunch' };

  it('happy path: limit check, PENDING row, Blnk call with reference=row id, APPLIED', async () => {
    const { svc, d } = makeService();
    const result = await svc.createTransfer(dto);
    expect(d.limits.assertWithinLimits).toHaveBeenCalledWith('cus-a', 1, 25000);
    expect(d.blnk.createTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ precise_amount: 25000, reference: 'tr-1', source: 'bln_a', destination: 'bln_b', skip_queue: true, inflight: false }),
    );
    expect(result.status).toBe('APPLIED');
    expect(result.blnkTransactionId).toBe('txn_1');
  });

  it('hold: true creates an inflight transaction and maps INFLIGHT', async () => {
    const { svc, d } = makeService();
    d.blnk.createTransaction.mockResolvedValue({ transaction_id: 'txn_1', status: 'INFLIGHT', reference: 'tr-1' });
    const result = await svc.createTransfer({ ...dto, hold: true });
    expect(d.blnk.createTransaction).toHaveBeenCalledWith(expect.objectContaining({ inflight: true }));
    expect(result.status).toBe('INFLIGHT');
  });

  it('rejects same-account transfers', async () => {
    const { svc } = makeService();
    await expect(svc.createTransfer({ ...dto, toAccountId: 'acc-a' })).rejects.toMatchObject({ code: 'SAME_ACCOUNT_TRANSFER', status: 400 });
  });

  it('maps a Blnk insufficient-funds rejection to INSUFFICIENT_FUNDS and marks the row REJECTED', async () => {
    const { svc, d } = makeService();
    d.blnk.createTransaction.mockRejectedValue(
      new AppError('BLNK_REQUEST_REJECTED', 'Blnk rejected the request (400)', 422, { blnkStatus: 400, blnkBody: { error: 'insufficient funds in source balance' } }),
    );
    await expect(svc.createTransfer(dto)).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS', status: 422 });
    expect(d.transferRepo.save).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'REJECTED' }));
  });

  it('leaves the row PENDING and throws TRANSFER_STATUS_UNKNOWN when Blnk is unreachable', async () => {
    const { svc, d } = makeService();
    d.blnk.createTransaction.mockRejectedValue(new AppError('BLNK_UNAVAILABLE', 'Blnk is unreachable', 502));
    await expect(svc.createTransfer(dto)).rejects.toMatchObject({ code: 'TRANSFER_STATUS_UNKNOWN', status: 502, details: expect.objectContaining({ transferId: 'tr-1' }) });
    expect(d.transferRepo.save).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'PENDING' }));
  });

  it('throws TRANSFER_STATUS_UNKNOWN when the finalize save fails after Blnk applied the transaction', async () => {
    const { svc, d } = makeService();
    d.transferRepo.save
      .mockImplementationOnce(async (v: Partial<Transfer>) => ({ id: v.id ?? 'tr-1', createdAt: new Date(), ...v }))
      .mockRejectedValueOnce(new Error('db down'));
    await expect(svc.createTransfer(dto)).rejects.toMatchObject({
      code: 'TRANSFER_STATUS_UNKNOWN', status: 502, details: expect.objectContaining({ transferId: 'tr-1' }),
    });
    expect(d.blnk.createTransaction).toHaveBeenCalled();
  });

  it('a REJECTED status in a 2xx Blnk response also maps to INSUFFICIENT_FUNDS', async () => {
    const { svc, d } = makeService();
    d.blnk.createTransaction.mockResolvedValue({ transaction_id: 'txn_1', status: 'REJECTED', reference: 'tr-1' });
    await expect(svc.createTransfer(dto)).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
  });
});

describe('TransfersService.deposit', () => {
  it('sources from suspense with allow_overdraft and no limit check', async () => {
    const { svc, d } = makeService();
    const result = await svc.deposit({ toAccountNumber: '9900000027', amount: 100000 });
    expect(d.limits.assertWithinLimits).not.toHaveBeenCalled();
    expect(d.blnk.createTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'bln_susp', destination: 'bln_b', allow_overdraft: true, inflight: false }),
    );
    expect(result.type).toBe('DEPOSIT');
    expect(result.fromAccountId).toBeNull();
  });
});
