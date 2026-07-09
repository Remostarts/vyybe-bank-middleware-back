import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Account } from './account.entity';
import { generateVan } from './van';
import { BlnkClient } from '../blnk/blnk.client';
import { LedgerService } from '../ledger/ledger.service';
import { AppError } from '../common/errors';
import { Customer } from '../customers/customer.entity';

const VAN_INSERT_ATTEMPTS = 5;

export interface AccountDto {
  id: string;
  customerId: string;
  virtualAccountNumber: string;
  currency: string;
  accountType: string;
  status: string;
  ledgerKey: string;
  blnkBalanceId: string | null;
  createdAt: Date;
}

export interface AccountWithBalance extends AccountDto {
  balance: {
    available: number;
    creditBalance: number;
    debitBalance: number;
    inflightCreditBalance: number;
    inflightDebitBalance: number;
    currency: string;
    precision: 100;
  };
}

export function toAccountDto(a: Account): AccountDto {
  return {
    id: a.id,
    customerId: a.customerId,
    virtualAccountNumber: a.virtualAccountNumber,
    currency: a.currency,
    accountType: a.accountType,
    status: a.status,
    ledgerKey: a.ledgerKey,
    blnkBalanceId: a.blnkBalanceId,
    createdAt: a.createdAt,
  };
}

@Injectable()
export class AccountsService {
  constructor(
    @InjectRepository(Account)
    private readonly repo: Repository<Account>,
    private readonly blnk: BlnkClient,
    private readonly ledgers: LedgerService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Checkpointed account provisioning: reuse an existing row for this
   * customer/type (resume), otherwise insert one with a fresh VAN; then
   * create the Blnk balance if it is still missing and mark ACTIVE.
   */
  async ensureActiveAccount(customer: Customer, accountType = 'MAIN'): Promise<Account> {
    if (!customer.blnkIdentityId) {
      throw new AppError('INTERNAL', 'Customer has no Blnk identity yet', 500);
    }
    let account = await this.repo.findOne({
      where: { customerId: customer.id, accountType },
      order: { createdAt: 'ASC' },
    });
    if (!account) account = await this.insertWithVan(customer.id, accountType);
    return this.activate(account, customer.blnkIdentityId);
  }

  /** For POST /v1/customers/:id/accounts — resumes any PENDING row first. */
  async createAdditionalAccount(customer: Customer): Promise<Account> {
    if (!customer.blnkIdentityId || customer.status !== 'ACTIVE') {
      throw new AppError('CUSTOMER_NOT_FOUND', 'Customer is not active', 404, { customerId: customer.id });
    }
    let account = await this.repo.findOne({ where: { customerId: customer.id, status: 'PENDING' } });
    if (!account) account = await this.insertWithVan(customer.id, 'MAIN');
    return this.activate(account, customer.blnkIdentityId);
  }

  findByCustomerId(customerId: string): Promise<Account[]> {
    return this.repo.find({ where: { customerId }, order: { createdAt: 'ASC' } });
  }

  async getWithBalance(where: { id: string } | { virtualAccountNumber: string }): Promise<AccountWithBalance> {
    const account = await this.repo.findOne({ where });
    if (!account) throw new AppError('ACCOUNT_NOT_FOUND', 'Account not found', 404, { ...where });
    if (!account.blnkBalanceId) throw new AppError('ACCOUNT_NOT_FOUND', 'Account is not active yet', 404, { ...where });
    const b = await this.blnk.getBalance(account.blnkBalanceId);
    return {
      ...toAccountDto(account),
      balance: {
        available: b.balance,
        creditBalance: b.credit_balance,
        debitBalance: b.debit_balance,
        inflightCreditBalance: b.inflight_credit_balance ?? 0,
        inflightDebitBalance: b.inflight_debit_balance ?? 0,
        currency: account.currency,
        precision: 100,
      },
    };
  }

  private async activate(account: Account, blnkIdentityId: string): Promise<Account> {
    if (!account.blnkBalanceId) {
      const balance = await this.blnk.createBalance(
        this.ledgers.getLedgerId('CUSTOMER_MAIN'),
        blnkIdentityId,
        account.currency,
      );
      account.blnkBalanceId = balance.balance_id;
      account.status = 'ACTIVE';
      account = await this.repo.save(account);
    }
    return account;
  }

  private async insertWithVan(customerId: string, accountType: string): Promise<Account> {
    const prefix = this.config.get<string>('vanPrefix') as string;
    for (let attempt = 0; attempt < VAN_INSERT_ATTEMPTS; attempt++) {
      try {
        return await this.repo.save(
          this.repo.create({
            customerId,
            accountType,
            currency: 'NGN',
            ledgerKey: 'CUSTOMER_MAIN',
            status: 'PENDING',
            blnkBalanceId: null,
            virtualAccountNumber: generateVan(prefix),
          }),
        );
      } catch (e) {
        if (isVanCollision(e)) continue;
        throw e;
      }
    }
    throw new AppError('INTERNAL', 'Could not allocate a unique account number', 500);
  }
}

function isVanCollision(e: unknown): boolean {
  const err = e as { code?: string; constraint?: string; driverError?: { code?: string; constraint?: string } };
  const code = err?.code ?? err?.driverError?.code;
  const constraint = err?.constraint ?? err?.driverError?.constraint ?? '';
  return code === '23505' && constraint.includes('virtual_account_number');
}
