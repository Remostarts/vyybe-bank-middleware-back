import { Controller, Get, Param } from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import { AccountsService } from './accounts.service';

@ApiTags('Accounts')
@ApiSecurity('x-api-key')
@Controller('accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get('by-account-number/:van')
  getByVan(@Param('van') van: string) {
    return this.accounts.getWithBalance({ virtualAccountNumber: van });
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.accounts.getWithBalance({ id });
  }
}
