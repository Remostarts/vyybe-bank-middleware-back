import { Repository } from 'typeorm';
import { InternalAccountsService } from './internal-accounts.service';
import { InternalAccount } from './internal-account.entity';
import { LedgerService } from './ledger.service';
import { BlnkClient } from '../blnk/blnk.client';

function makeRepo(existing: InternalAccount | null) {
  return {
    findOneBy: jest.fn().mockResolvedValue(existing),
    create: jest.fn((v) => v),
    save: jest.fn(async (v) => v),
  } as unknown as Repository<InternalAccount> & { [k: string]: jest.Mock };
}

describe('InternalAccountsService', () => {
  const ledgers = { resolveLedgerId: jest.fn().mockResolvedValue('ldg_internal') } as unknown as LedgerService;

  it('provisions the suspense balance on Blnk when missing and persists it', async () => {
    const repo = makeRepo(null);
    const blnk = { createInternalBalance: jest.fn().mockResolvedValue({ balance_id: 'bln_susp' }) };
    const svc = new InternalAccountsService(repo, blnk as unknown as BlnkClient, ledgers);
    await expect(svc.resolveBalanceId('DEPOSIT_SUSPENSE')).resolves.toBe('bln_susp');
    expect(blnk.createInternalBalance).toHaveBeenCalledWith('ldg_internal', 'NGN');
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'DEPOSIT_SUSPENSE', blnkBalanceId: 'bln_susp', ledgerKey: 'INTERNAL' }),
    );
  });

  it('reuses the stored balance and caches it', async () => {
    const repo = makeRepo({ key: 'DEPOSIT_SUSPENSE', blnkBalanceId: 'bln_x', ledgerKey: 'INTERNAL', currency: 'NGN' });
    const blnk = { createInternalBalance: jest.fn() };
    const svc = new InternalAccountsService(repo, blnk as unknown as BlnkClient, ledgers);
    await expect(svc.resolveBalanceId('DEPOSIT_SUSPENSE')).resolves.toBe('bln_x');
    await expect(svc.resolveBalanceId('DEPOSIT_SUSPENSE')).resolves.toBe('bln_x');
    expect(blnk.createInternalBalance).not.toHaveBeenCalled();
    expect(repo.findOneBy).toHaveBeenCalledTimes(1); // second call served from cache
  });
});
