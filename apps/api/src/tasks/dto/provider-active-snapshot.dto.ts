import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

export const MAX_PROVIDER_ACTIVE_CHANNELS = 5_000;

export class ProviderActiveSnapshotDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(64)
  provider!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(128)
  snapshotId!: string;

  @IsDateString()
  observedAt!: string;

  @IsArray()
  @ArrayMaxSize(MAX_PROVIDER_ACTIVE_CHANNELS)
  @IsUUID('all', { each: true })
  activeChannelIds!: string[];
}
