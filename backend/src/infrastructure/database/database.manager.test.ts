import { beforeEach, describe, expect, it, vi } from 'vitest';

const connectMock = vi.fn();
const closeMock = vi.fn();
const connection = {
  readyState: 0,
  on: vi.fn(),
  close: closeMock,
};

vi.mock('mongoose', () => ({
  default: {
    connection,
    set: vi.fn(),
    connect: connectMock,
  },
}));

vi.mock('../../config/env.js', () => ({
  env: {
    MONGODB_URI: 'mongodb://example',
    MONGODB_MAX_POOL_SIZE: 10,
    MONGODB_MIN_POOL_SIZE: 1,
    MONGO_DEBUG: false,
  },
}));

vi.mock('../../lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('DatabaseManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connection.readyState = 0;
    connectMock.mockReset();
    closeMock.mockReset();
  });

  it('does not throw when the initial MongoDB connection is unavailable', async () => {
    connectMock.mockRejectedValue(new Error('Atlas unavailable'));
    const { databaseManager } = await import('./database.manager.js?initial-failure');

    await expect(databaseManager.start()).resolves.toBeUndefined();
    expect(databaseManager.status().ready).toBe(false);
    expect(databaseManager.status().state).toBe('disconnected');
  });

  it('becomes ready when the driver reports connected', async () => {
    connectMock.mockResolvedValue(undefined);
    const { databaseManager } = await import('./database.manager.js?connected');

    connection.readyState = 1;
    await databaseManager.start();

    expect(databaseManager.status().ready).toBe(true);
    expect(databaseManager.status().state).toBe('connected');
  });
});
