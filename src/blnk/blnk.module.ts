import { Module } from '@nestjs/common';
import { BlnkClient } from './blnk.client';

@Module({ providers: [BlnkClient], exports: [BlnkClient] })
export class BlnkModule {}
