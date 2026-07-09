import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Customer } from './customer.entity';
import { CustomerDto, OnboardCustomerDto, toCustomerDto } from './dto';
import { BlnkClient } from '../blnk/blnk.client';
import { AccountsService, AccountDto, toAccountDto } from '../accounts/accounts.service';
import { AppError } from '../common/errors';
import { CreateBlnkIdentityRequest } from '../blnk/blnk.types';

export interface OnboardResult {
  customer: CustomerDto;
  account: AccountDto;
}

@Injectable()
export class CustomersService {
  constructor(
    @InjectRepository(Customer)
    private readonly repo: Repository<Customer>,
    private readonly blnk: BlnkClient,
    private readonly accounts: AccountsService,
  ) {}

  /**
   * Checkpointed onboarding: PENDING -> IDENTITY_CREATED -> ACTIVE.
   * Retrying with the same Idempotency-Key resumes from the last checkpoint.
   */
  async onboard(dto: OnboardCustomerDto): Promise<OnboardResult> {
    let customer = await this.repo.findOneBy({ externalUserId: dto.externalUserId });
    if (customer?.status === 'ACTIVE') {
      throw new AppError('CUSTOMER_ALREADY_EXISTS', 'Customer is already onboarded', 409, {
        externalUserId: dto.externalUserId,
      });
    }
    if (!customer) {
      customer = await this.repo.save(
        this.repo.create({
          externalUserId: dto.externalUserId,
          firstName: dto.firstName,
          lastName: dto.lastName,
          email: dto.email,
          phoneNumber: dto.phoneNumber,
          dateOfBirth: dto.dateOfBirth,
          status: 'PENDING',
          blnkIdentityId: null,
        }),
      );
    }

    try {
      if (!customer.blnkIdentityId) {
        const identity = await this.blnk.createIdentity(this.identityRequest(customer, dto.metadata));
        customer.blnkIdentityId = identity.identity_id;
        customer.status = 'IDENTITY_CREATED';
        customer = await this.repo.save(customer);
      }

      const account = await this.accounts.ensureActiveAccount(customer);

      customer.status = 'ACTIVE';
      customer = await this.repo.save(customer);
      return { customer: toCustomerDto(customer), account: toAccountDto(account) };
    } catch (e) {
      if (e instanceof AppError && (e.code === 'BLNK_UNAVAILABLE' || e.code === 'BLNK_REQUEST_REJECTED')) {
        throw new AppError(
          'ONBOARDING_INCOMPLETE',
          'Onboarding could not be completed; retry with the same Idempotency-Key',
          502,
          { externalUserId: dto.externalUserId, checkpoint: customer.status },
        );
      }
      throw e;
    }
  }

  async findEntity(id: string): Promise<Customer> {
    const customer = await this.repo.findOneBy({ id });
    if (!customer) throw new AppError('CUSTOMER_NOT_FOUND', 'Customer not found', 404, { id });
    return customer;
  }

  async getById(id: string): Promise<{ customer: CustomerDto; accounts: AccountDto[] }> {
    return this.withAccounts(await this.findEntity(id));
  }

  async getByExternalId(externalUserId: string): Promise<{ customer: CustomerDto; accounts: AccountDto[] }> {
    const customer = await this.repo.findOneBy({ externalUserId });
    if (!customer) throw new AppError('CUSTOMER_NOT_FOUND', 'Customer not found', 404, { externalUserId });
    return this.withAccounts(customer);
  }

  identityRequest(customer: Customer, metadata?: Record<string, unknown>): CreateBlnkIdentityRequest {
    return {
      identity_type: 'individual',
      first_name: customer.firstName,
      last_name: customer.lastName,
      email_address: customer.email,
      phone_number: customer.phoneNumber,
      dob: customer.dateOfBirth,
      meta_data: { external_user_id: customer.externalUserId, kyc_tier: customer.kycTier ?? 0, ...(metadata ?? {}) },
    };
  }

  private async withAccounts(customer: Customer) {
    const accounts = await this.accounts.findByCustomerId(customer.id);
    return { customer: toCustomerDto(customer), accounts: accounts.map(toAccountDto) };
  }
}
