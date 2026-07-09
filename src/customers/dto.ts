import { IsDateString, IsEmail, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, Max, Min } from 'class-validator';
import { Customer } from './customer.entity';

export class OnboardCustomerDto {
  @IsString() @IsNotEmpty() externalUserId!: string;
  @IsString() @IsNotEmpty() firstName!: string;
  @IsString() @IsNotEmpty() lastName!: string;
  @IsEmail() email!: string;
  @IsString() @IsNotEmpty() phoneNumber!: string;
  @IsDateString() dateOfBirth!: string;
  @IsOptional() @IsObject() metadata?: Record<string, unknown>;
}

export class SetKycTierDto {
  @IsInt() @Min(0) @Max(3) kycTier!: number;
}

export interface CustomerDto {
  id: string;
  externalUserId: string;
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  dateOfBirth: string;
  kycTier: number;
  status: string;
  blnkIdentityId: string | null;
  createdAt: Date;
}

export function toCustomerDto(c: Customer): CustomerDto {
  return {
    id: c.id,
    externalUserId: c.externalUserId,
    firstName: c.firstName,
    lastName: c.lastName,
    email: c.email,
    phoneNumber: c.phoneNumber,
    dateOfBirth: c.dateOfBirth,
    kycTier: c.kycTier,
    status: c.status,
    blnkIdentityId: c.blnkIdentityId,
    createdAt: c.createdAt,
  };
}
