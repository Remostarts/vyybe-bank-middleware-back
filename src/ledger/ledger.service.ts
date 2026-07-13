import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LedgerConfig } from './ledger-config.entity';
import { BlnkClient } from '../blnk/blnk.client';
import { AppError } from '../common/errors';

export const LEDGER_DEFS = [
  { key: 'CUSTOMER_MAIN', name: 'Customer Main Accounts', currency: 'NGN' },
  { key: 'INTERNAL', name: 'Internal Accounts', currency: 'NGN' },
] as const;

export type LedgerKey = (typeof LEDGER_DEFS)[number]['key'];

@Injectable()
export class LedgerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(LedgerService.name);
  private readonly cache = new Map<string, string>();

  constructor(
    @InjectRepository(LedgerConfig)
    private readonly repo: Repository<LedgerConfig>,
    private readonly blnk: BlnkClient,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.ensureLedgers();
    } catch (err) {
      this.logger.warn(
        `Deferred ledger bootstrap: Blnk not reachable at startup (${
          err instanceof Error ? err.message : String(err)
        }). Will retry lazily on first use.`,
      );
    }
  }

  async ensureLedgers(): Promise<void> {
    for (const def of LEDGER_DEFS) {
      let row = await this.repo.findOneBy({ ledgerKey: def.key });
      if (!row) {
        const ledger = await this.blnk.createLedger(def.name);
        row = await this.repo.save(
          this.repo.create({ ledgerKey: def.key, blnkLedgerId: ledger.ledger_id, name: def.name, currency: def.currency }),
        );
        this.logger.log(`Created Blnk ledger ${ledger.ledger_id} for ${def.key}`);
      }
      this.cache.set(def.key, row.blnkLedgerId);
    }
  }

  getLedgerId(key: LedgerKey): string {
    const id = this.cache.get(key);
    if (!id) throw new AppError('INTERNAL', `Ledger not bootstrapped: ${key}`, 500);
    return id;
  }

  async resolveLedgerId(key: LedgerKey): Promise<string> {
    const cached = this.cache.get(key);
    if (cached) return cached;
    await this.ensureLedgers();
    const id = this.cache.get(key);
    if (!id) throw new AppError('INTERNAL', `Ledger not bootstrapped: ${key}`, 500);
    return id;
  }
}
