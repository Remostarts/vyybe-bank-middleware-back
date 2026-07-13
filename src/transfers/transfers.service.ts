import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, Repository } from 'typeorm';
import { Transfer, TransferStatus } from './transfer.entity';
import { Account } from '../accounts/account.entity';
import { Customer } from '../customers/customer.entity';
import { BlnkClient } from '../blnk/blnk.client';
import { BlnkTransaction } from '../blnk/blnk.types';
import { LimitsService } from './limits.service';
import { InternalAccountsService } from '../ledger/internal-accounts.service';
import { AppError } from '../common/errors';
import { CreateDepositDto, CreateTransferDto, HistoryItemDto, TransferDto, toTransferDto } from './transfers.dto';

interface ExecuteOptions {
  source: string;
  destination: string;
  inflight: boolean;
  allowOverdraft: boolean;
}

@Injectable()
export class TransfersService {
  private static readonly RESYNC_FAIL_AFTER_MS = 60_000;

  constructor(
    @InjectRepository(Transfer)
    private readonly repo: Repository<Transfer>,
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
    private readonly blnk: BlnkClient,
    private readonly limits: LimitsService,
    private readonly internals: InternalAccountsService,
  ) {}

  async createTransfer(dto: CreateTransferDto): Promise<TransferDto> {
    const from = await this.resolveActiveAccount(dto.fromAccountId, dto.fromAccountNumber, 'from');
    const to = await this.resolveActiveAccount(dto.toAccountId, dto.toAccountNumber, 'to');
    if (from.id === to.id) {
      throw new AppError('SAME_ACCOUNT_TRANSFER', 'Source and destination must differ', 400);
    }

    const sender = await this.customerRepo.findOneBy({ id: from.customerId });
    if (!sender) throw new AppError('CUSTOMER_NOT_FOUND', 'Sending customer not found', 404, { customerId: from.customerId });
    await this.limits.assertWithinLimits(sender.id, sender.kycTier, dto.amount);

    const transfer = await this.repo.save(
      this.repo.create({
        type: 'P2P',
        fromAccountId: from.id,
        toAccountId: to.id,
        fromCustomerId: from.customerId,
        toCustomerId: to.customerId,
        amount: dto.amount,
        currency: 'NGN',
        status: 'PENDING',
        blnkTransactionId: null,
        narration: dto.narration ?? null,
        metadata: dto.metadata ?? null,
      }),
    );
    return this.execute(transfer, {
      source: from.blnkBalanceId as string,
      destination: to.blnkBalanceId as string,
      inflight: dto.hold === true,
      allowOverdraft: false,
    });
  }

  async deposit(dto: CreateDepositDto): Promise<TransferDto> {
    const to = await this.resolveActiveAccount(dto.toAccountId, dto.toAccountNumber, 'to');
    const suspense = await this.internals.resolveBalanceId('DEPOSIT_SUSPENSE');

    const transfer = await this.repo.save(
      this.repo.create({
        type: 'DEPOSIT',
        fromAccountId: null,
        toAccountId: to.id,
        fromCustomerId: null,
        toCustomerId: to.customerId,
        amount: dto.amount,
        currency: 'NGN',
        status: 'PENDING',
        blnkTransactionId: null,
        narration: dto.narration ?? null,
        metadata: dto.metadata ?? null,
      }),
    );
    return this.execute(transfer, {
      source: suspense,
      destination: to.blnkBalanceId as string,
      inflight: false,
      allowOverdraft: true,
    });
  }

  async commit(id: string): Promise<TransferDto> {
    return this.finalizeInflight(id, 'commit', 'COMMITTED');
  }

  async void_(id: string): Promise<TransferDto> {
    return this.finalizeInflight(id, 'void', 'VOIDED');
  }

  async getById(id: string): Promise<TransferDto> {
    let transfer = await this.repo.findOneBy({ id });
    if (!transfer) throw new AppError('TRANSFER_NOT_FOUND', 'Transfer not found', 404, { id });
    if (transfer.status === 'PENDING') transfer = await this.resync(transfer);
    return toTransferDto(transfer);
  }

  async history(accountId: string, limit: number, cursor?: string): Promise<{ items: HistoryItemDto[]; nextCursor: string | null }> {
    const qb = this.repo
      .createQueryBuilder('t')
      .where(new Brackets((b) => b.where('t.from_account_id = :id', { id: accountId }).orWhere('t.to_account_id = :id', { id: accountId })))
      .orderBy('t.created_at', 'DESC')
      .addOrderBy('t.id', 'DESC')
      .take(limit + 1);
    if (cursor) {
      const [createdAt, cid] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
      if (!createdAt || !cid || Number.isNaN(Date.parse(createdAt))) {
        throw new AppError('VALIDATION_ERROR', 'Malformed cursor', 400);
      }
      qb.andWhere('(t.created_at, t.id) < (:cAt, :cId)', { cAt: createdAt, cId: cid });
    }
    const rows = await qb.getMany();
    const page = rows.slice(0, limit);

    const counterpartyIds = page
      .map((t) => (t.toAccountId === accountId ? t.fromAccountId : t.toAccountId))
      .filter((v): v is string => v !== null);
    const accounts = counterpartyIds.length ? await this.accountRepo.findBy({ id: In(counterpartyIds) }) : [];
    const byId = new Map(accounts.map((a) => [a.id, a]));

    const items: HistoryItemDto[] = page.map((t) => {
      const direction = t.toAccountId === accountId ? 'IN' : 'OUT';
      const otherId = direction === 'IN' ? t.fromAccountId : t.toAccountId;
      const other = otherId ? byId.get(otherId) : undefined;
      return {
        id: t.id,
        direction,
        counterparty: other ? { customerId: other.customerId, accountNumber: other.virtualAccountNumber } : null,
        amount: t.amount,
        currency: t.currency,
        status: t.status,
        narration: t.narration,
        createdAt: t.createdAt,
      };
    });

    const nextCursor =
      rows.length > limit && page.length > 0
        ? Buffer.from(`${page[page.length - 1].createdAt.toISOString()}|${page[page.length - 1].id}`).toString('base64url')
        : null;
    return { items, nextCursor };
  }

  /** Shared Blnk execution with checkpointed outcome handling. */
  private async execute(transfer: Transfer, opts: ExecuteOptions): Promise<TransferDto> {
    let tx: BlnkTransaction;
    try {
      tx = await this.blnk.createTransaction({
        precise_amount: transfer.amount,
        currency: transfer.currency,
        precision: 100,
        reference: transfer.id,
        source: opts.source,
        destination: opts.destination,
        description: transfer.narration ?? undefined,
        inflight: opts.inflight,
        skip_queue: true,
        allow_overdraft: opts.allowOverdraft,
        meta_data: transfer.metadata ?? undefined,
      });
    } catch (e) {
      if (e instanceof AppError && e.code === 'BLNK_REQUEST_REJECTED') {
        transfer.status = 'REJECTED';
        await this.repo.save(transfer);
        if (mentionsInsufficientFunds(e)) {
          throw new AppError('INSUFFICIENT_FUNDS', 'Insufficient funds in the source account', 422, { transferId: transfer.id });
        }
        throw e;
      }
      if (e instanceof AppError && e.code === 'BLNK_UNAVAILABLE') {
        // Outcome unknown: leave PENDING, caller polls GET /v1/transfers/:id
        throw new AppError('TRANSFER_STATUS_UNKNOWN', 'Transfer outcome unknown; poll GET /v1/transfers/{id}', 502, {
          transferId: transfer.id,
        });
      }
      throw e;
    }

    // Finalize: Blnk has settled the outcome, so any failure here (e.g. transient DB
    // error) must not surface raw — money may already have moved. Row stays PENDING;
    // the resync path recovers it from Blnk by reference.
    try {
      transfer.blnkTransactionId = tx.transaction_id;
      transfer.status = mapBlnkStatus(tx.status);
      const saved = await this.repo.save(transfer);
      if (saved.status === 'REJECTED') {
        throw new AppError('INSUFFICIENT_FUNDS', 'Insufficient funds in the source account', 422, { transferId: saved.id });
      }
      return toTransferDto(saved);
    } catch (e) {
      if (e instanceof AppError && e.code === 'INSUFFICIENT_FUNDS') throw e;
      throw new AppError('TRANSFER_STATUS_UNKNOWN', 'Transfer outcome unknown; poll GET /v1/transfers/{id}', 502, {
        transferId: transfer.id,
      });
    }
  }

  private async finalizeInflight(id: string, action: 'commit' | 'void', target: TransferStatus): Promise<TransferDto> {
    const transfer = await this.repo.findOneBy({ id });
    if (!transfer) throw new AppError('TRANSFER_NOT_FOUND', 'Transfer not found', 404, { id });
    if (transfer.status !== 'INFLIGHT' || !transfer.blnkTransactionId) {
      throw new AppError('INVALID_TRANSFER_STATE', `Transfer is ${transfer.status}, expected INFLIGHT`, 409, { id, status: transfer.status });
    }
    await this.blnk.updateInflight(transfer.blnkTransactionId, action);
    transfer.status = target;
    return toTransferDto(await this.repo.save(transfer));
  }

  private async resync(transfer: Transfer): Promise<Transfer> {
    const tx = await this.blnk.getTransactionByReference(transfer.id);
    if (tx) {
      transfer.blnkTransactionId = tx.transaction_id;
      transfer.status = mapBlnkStatus(tx.status);
      return this.repo.save(transfer);
    }
    if (Date.now() - transfer.createdAt.getTime() > TransfersService.RESYNC_FAIL_AFTER_MS) {
      transfer.status = 'FAILED';
      return this.repo.save(transfer);
    }
    return transfer; // too fresh to declare failed
  }

  private async resolveActiveAccount(id: string | undefined, van: string | undefined, side: 'from' | 'to'): Promise<Account> {
    if (!id && !van) {
      throw new AppError('VALIDATION_ERROR', `Provide ${side}AccountId or ${side}AccountNumber`, 400);
    }
    const account = id
      ? await this.accountRepo.findOneBy({ id })
      : await this.accountRepo.findOneBy({ virtualAccountNumber: van as string });
    if (!account || account.status !== 'ACTIVE' || !account.blnkBalanceId) {
      throw new AppError('ACCOUNT_NOT_FOUND', `Active ${side} account not found`, 404, { id, accountNumber: van });
    }
    return account;
  }
}

export function mapBlnkStatus(status: string): TransferStatus {
  switch (status.toUpperCase()) {
    case 'APPLIED': return 'APPLIED';
    case 'INFLIGHT': return 'INFLIGHT';
    case 'REJECTED': return 'REJECTED';
    case 'VOID': case 'VOIDED': return 'VOIDED';
    case 'COMMIT': case 'COMMITTED': return 'COMMITTED';
    default: return 'PENDING'; // e.g. QUEUED
  }
}

function mentionsInsufficientFunds(e: AppError): boolean {
  return JSON.stringify(e.details ?? {}).toLowerCase().includes('insufficient');
}
