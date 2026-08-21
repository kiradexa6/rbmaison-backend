import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { THROTTLE_AUTH } from '../../shared/common/constants/throttle.constants';
import { CurrentUser } from './decorators/current-user.decorator';
import { LoginDto, RefreshTokenDto, SignupDto } from './dto/auth.dto';
import { AuthService } from './auth.service';
import { SupabaseAuthGuard } from './guards/supabase-auth.guard';
import type { AuthenticatedUser } from './interfaces/authenticated-user.interface';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('signup')
  @Throttle(THROTTLE_AUTH)
  signup(@Body() dto: SignupDto) {
    return this.authService.signup(dto);
  }

  @Post('login')
  @HttpCode(200)
  @Throttle(THROTTLE_AUTH)
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('refresh')
  @HttpCode(200)
  @Throttle(THROTTLE_AUTH)
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto);
  }

  @Get('session')
  @UseGuards(SupabaseAuthGuard)
  session(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.session(user);
  }

  @Post('logout')
  @HttpCode(200)
  @UseGuards(SupabaseAuthGuard)
  @Throttle(THROTTLE_AUTH)
  logout(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.logout(user);
  }
}
