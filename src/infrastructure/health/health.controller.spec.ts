import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { HealthCheckService, MemoryHealthIndicator } from '@nestjs/terminus';
import { SupabaseHealthIndicator } from './supabase.health';

describe('HealthController', () => {
  let controller: HealthController;
  let checkMock: jest.Mock;

  beforeEach(async () => {
    checkMock = jest.fn().mockResolvedValue({
      status: 'ok',
      info: { memory_heap: { status: 'up' } },
      error: {},
      details: { memory_heap: { status: 'up' } },
    });

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: HealthCheckService,
          useValue: {
            check: checkMock,
          },
        },
        {
          provide: MemoryHealthIndicator,
          useValue: {
            checkHeap: jest
              .fn()
              .mockReturnValue({ memory_heap: { status: 'up' } }),
            checkRSS: jest
              .fn()
              .mockReturnValue({ memory_rss: { status: 'up' } }),
          },
        },
        {
          provide: SupabaseHealthIndicator,
          useValue: {
            isHealthy: jest.fn().mockResolvedValue({
              supabase: { status: 'up', configured: false },
            }),
          },
        },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should return health check result', async () => {
    const result = await controller.check();

    expect(checkMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual(
      expect.objectContaining({
        status: 'ok',
      }),
    );
  });
});
