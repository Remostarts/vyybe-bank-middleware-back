import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type CustomerStatus = 'PENDING' | 'IDENTITY_CREATED' | 'ACTIVE' | 'FAILED';

@Entity('customers')
export class Customer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'external_user_id', type: 'text', unique: true })
  externalUserId: string;

  @Column({ name: 'blnk_identity_id', type: 'text', unique: true, nullable: true })
  blnkIdentityId: string | null;

  @Column({ name: 'first_name', type: 'text' })
  firstName: string;

  @Column({ name: 'last_name', type: 'text' })
  lastName: string;

  @Column({ type: 'text' })
  email: string;

  @Column({ name: 'phone_number', type: 'text' })
  phoneNumber: string;

  @Column({ name: 'date_of_birth', type: 'date' })
  dateOfBirth: string;

  @Column({ name: 'kyc_tier', type: 'int', default: 0 })
  kycTier: number;

  @Column({ type: 'text', default: 'PENDING' })
  status: CustomerStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
