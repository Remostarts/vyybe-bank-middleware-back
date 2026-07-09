import { Repository } from 'typeorm';
import { LedgerService } from './ledger.service';
import { LedgerConfig } from './ledger-config.entity';
import { BlnkClient } from '../blnk/blnk.client';

describe('LedgerService', () => {
  function makeRepo(existing: LedgerConfig | null) {
    return {
      findOneBy: jest.fn().mockResolvedValue(existing),
      create: jest.fn((v) => v),
      save: jest.fn(async (v) => v),
    } as unknown as Repository<LedgerConfig> & { [k: string]: jest.Mock };
  }

  it('creates the ledger on Blnk and stores the row when missing', async () => {
    const repo = makeRepo(null);
    const blnk = { createLedger: jest.fn().mockResolvedValue({ ledger_id: 'ldg_1', name: 'Customer Main Accounts' }) };
    const svc = new LedgerService(repo, blnk as unknown as BlnkClient);
    await svc.ensureLedgers();
    expect(blnk.createLedger).toHaveBeenCalledWith('Customer Main Accounts');
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ ledgerKey: 'CUSTOMER_MAIN', blnkLedgerId: 'ldg_1', currency: 'NGN' }),
    );
    expect(svc.getLedgerId('CUSTOMER_MAIN')).toBe('ldg_1');
  });

  it('reuses the stored ledger without calling Blnk', async () => {
    const repo = makeRepo({ ledgerKey: 'CUSTOMER_MAIN', blnkLedgerId: 'ldg_9', name: 'x', currency: 'NGN' });
    const blnk = { createLedger: jest.fn() };
    const svc = new LedgerService(repo, blnk as unknown as BlnkClient);
    await svc.ensureLedgers();
    expect(blnk.createLedger).not.toHaveBeenCalled();
    expect(svc.getLedgerId('CUSTOMER_MAIN')).toBe('ldg_9');
  });

  it('getLedgerId throws before bootstrap', () => {
    const svc = new LedgerService(makeRepo(null), {} as BlnkClient);
    expect(() => svc.getLedgerId('CUSTOMER_MAIN')).toThrow();
  });
});
