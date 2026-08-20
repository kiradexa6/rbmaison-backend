import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

export function assertSupabase<T>(
  result: { data: T; error: { message: string; code?: string } | null },
  notFoundMessage = 'Resource not found',
): T {
  if (result.error) {
    throw mapSupabaseError(result.error, notFoundMessage);
  }
  return result.data;
}

export function mapSupabaseError(
  error: { message: string; code?: string },
  notFoundMessage: string,
): HttpException {
  const code = error.code ?? '';
  const message = error.message.toLowerCase();

  if (
    code === '42501' ||
    message.includes('row-level security') ||
    message.includes('permission denied') ||
    message.includes('only admins') ||
    message.includes('only merchants') ||
    message.includes('only customers') ||
    message.includes('cannot access another store')
  ) {
    return new ForbiddenException(error.message);
  }

  if (
    message.includes('insufficient balance') ||
    message.includes('insufficient wallet')
  ) {
    if (message.includes('top up') || message.includes('insufficient wallet')) {
      return new BadRequestException(
        'Insufficient balance. Please top up your account.',
      );
    }
    return new BadRequestException('Insufficient balance.');
  }

  if (
    code === '23505' ||
    message.includes('already listed') ||
    message.includes('duplicate') ||
    message.includes('already settled') ||
    message.includes('already sent for shipping') ||
    message.includes('already running') ||
    message.includes('already exist for this account')
  ) {
    if (message.includes('already settled')) {
      return new ConflictException('Order already settled');
    }
    return new ConflictException(error.message);
  }

  if (
    message.includes('illegal') ||
    message.includes('cannot be marked paid') ||
    message.includes('sales price snapshot') ||
    message.includes('immutable') ||
    message.includes('cannot be changed') ||
    message.includes('cannot be safely reversed')
  ) {
    return new UnprocessableEntityException({
      message: error.message,
      error: 'Invalid request',
    });
  }

  if (code === 'PGRST116' || message.includes('not found')) {
    return new NotFoundException(notFoundMessage);
  }

  return new BadRequestException(error.message);
}
