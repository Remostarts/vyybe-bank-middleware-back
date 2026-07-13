import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InternalAccount } from './internal-account.entity';
import { LedgerService } from './ledger.service';
import { BlnkClient } from '../blnk/blnk.client';

export const INTERNAL_BALANCE_DEFS = {
  DEPOSIT_SUSPENSE: { ledgerKey: 'INTERNAL', currency: 'NGN' },
} as const;

export type InternalBalanceKey = keyof typeof INTERNAL_BALANCE_DEFS;

@Injectable()
export class InternalAccountsService {
  private readonly logger = new Logger(InternalAccountsService.name);
  private readonly cache = new Map<string, string>();

  constructor(
    @InjectRepository(InternalAccount)
    private readonly repo: Repository<InternalAccount>,
    private readonly blnk: BlnkClient,
    private readonly ledgers: LedgerService,
  ) {}

  async resolveBalanceId(key: InternalBalanceKey): Promise<string> {
    const cached = this.cache.get(key);
    if (cached) return cached;

    const def = INTERNAL_BALANCE_DEFS[key];
    let row = await this.repo.findOneBy({ key });
    if (!row) {
      const ledgerId = await this.ledgers.resolveLedgerId(def.ledgerKey);
      const balance = await this.blnk.createInternalBalance(ledgerId, def.currency);
      row = await this.repo.save(
        this.repo.create({ key, blnkBalanceId: balance.balance_id, ledgerKey: def.ledgerKey, currency: def.currency }),
      );
      this.logger.log(`Provisioned internal balance ${balance.balance_id} for ${key}`);
    }
    this.cache.set(key, row.blnkBalanceId);
    return row.blnkBalanceId;
  }
}
