import { createClient } from 'redis';

export class RedisService {
  private client: ReturnType<typeof createClient>;
  private connected = false;

  constructor() {
    this.client = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
    });
    
    this.client.on('error', (err) => {
      console.error('Redis Client Error:', err);
      this.connected = false;
    });
    
    this.client.on('connect', () => {
      console.log('Redis Client Connected');
      this.connected = true;
    });
  }

  async connect(): Promise<void> {
    if (!this.connected) {
      try {
        await this.client.connect();
      } catch (error) {
        console.warn('Redis connection failed, continuing without cache:', error);
        this.connected = false;
      }
    }
  }

  async get(key: string): Promise<string | null> {
    try {
      await this.connect();
      return await this.client.get(key);
    } catch (error) {
      console.error('Redis GET error:', error);
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds = 300): Promise<void> {
    try {
      await this.connect();
      await this.client.setEx(key, ttlSeconds, value);
    } catch (error) {
      console.error('Redis SET error:', error);
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.connect();
      await this.client.del(key);
    } catch (error) {
      console.error('Redis DEL error:', error);
    }
  }

  async getCachedPrice(tokenAddress: string, network: string, timestamp: number): Promise<any | null> {
    const key = `price:${tokenAddress}:${network}:${timestamp}`;
    const cached = await this.get(key);
    return cached ? JSON.parse(cached) : null;
  }

  async setCachedPrice(tokenAddress: string, network: string, timestamp: number, price: any): Promise<void> {
    const key = `price:${tokenAddress}:${network}:${timestamp}`;
    await this.set(key, JSON.stringify(price), 300); // 5 minutes TTL
  }

  isConnected(): boolean {
    return this.connected;
  }
}

export const redisService = new RedisService();
