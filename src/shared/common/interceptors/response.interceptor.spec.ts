import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { ResponseInterceptor } from './response.interceptor';

describe('ResponseInterceptor', () => {
  let interceptor: ResponseInterceptor<unknown>;
  let mockContext: ExecutionContext;
  let mockHandler: CallHandler;

  beforeEach(() => {
    interceptor = new ResponseInterceptor();
    mockContext = {
      switchToHttp: () => ({
        getRequest: () => ({ url: '/api/v1/health' }),
      }),
    } as ExecutionContext;
  });

  it('should wrap successful responses in standard format', (done) => {
    mockHandler = {
      handle: () => of({ status: 'ok' }),
    };

    interceptor.intercept(mockContext, mockHandler).subscribe((result) => {
      expect(result).toEqual(
        expect.objectContaining({
          success: true,
          data: { status: 'ok' },
          path: '/api/v1/health',
        }),
      );
      expect(result.timestamp).toBeDefined();
      done();
    });
  });

  it('should propagate errors', (done) => {
    mockHandler = {
      handle: () => throwError(() => new Error('Test error')),
    };

    interceptor.intercept(mockContext, mockHandler).subscribe({
      error: (error: Error) => {
        expect(error.message).toBe('Test error');
        done();
      },
    });
  });
});
