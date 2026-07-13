import { IsBoolean, IsInt, IsObject, IsOptional, IsPositive, IsString, IsUUID, MaxLength } from 'class-validator';
import { Transfer, TransferStatus, TransferType } from './transfer.entity';

export class CreateTransferDto {
  @IsOptional() @IsUUID() fromAccountId?: string;
  @IsOptional() @IsString() fromAccountNumber?: string;
  @IsOptional() @IsUUID() toAccountId?: string;
  @IsOptional() @IsString() toAccountNumber?: string;
  @IsInt() @IsPositive() amount!: number;
  @IsOptional() @IsString() @MaxLength(140) narration?: string;
  @IsOptional() @IsBoolean() hold?: boolean;
  @IsOptional() @IsObject() metadata?: Record<string, unknown>;
}

export class CreateDepositDto {
  @IsOptional() @IsUUID() toAccountId?: string;
  @IsOptional() @IsString() toAccountNumber?: string;
  @IsInt() @IsPositive() amount!: number;
  @IsOptional() @IsString() @MaxLength(140) narration?: string;
  @IsOptional() @IsObject() metadata?: Record<string, unknown>;
}

export interface TransferDto {
  id: string;
  type: TransferType;
  fromAccountId: string | null;
  toAccountId: string;
  amount: number;
  currency: string;
  status: TransferStatus;
  narration: string | null;
  blnkTransactionId: string | null;
  createdAt: Date;
}

export function toTransferDto(t: Transfer): TransferDto {
  return {
    id: t.id,
    type: t.type,
    fromAccountId: t.fromAccountId,
    toAccountId: t.toAccountId,
    amount: t.amount,
    currency: t.currency,
    status: t.status,
    narration: t.narration,
    blnkTransactionId: t.blnkTransactionId,
    createdAt: t.createdAt,
  };
}

export interface HistoryItemDto {
  id: string;
  direction: 'IN' | 'OUT';
  counterparty: { customerId: string; accountNumber: string } | null;
  amount: number;
  currency: string;
  status: TransferStatus;
  narration: string | null;
  createdAt: Date;
}
