import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class CreateStripeCheckoutDto {
  @IsOptional()
  @IsUrl({ require_tld: false }, { message: 'successUrl must be a valid URL' })
  @MaxLength(2048)
  successUrl?: string;

  @IsOptional()
  @IsUrl({ require_tld: false }, { message: 'cancelUrl must be a valid URL' })
  @MaxLength(2048)
  cancelUrl?: string;
}
