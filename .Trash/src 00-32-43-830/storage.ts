import { 
  users, 
  priceQueries, 
  historicalPrices, 
  bulkFetchJobs,
  type User, 
  type InsertUser,
  type PriceQuery,
  type InsertPriceQuery,
  type HistoricalPrice,
  type InsertHistoricalPrice,
  type BulkFetchJob,
  type InsertBulkFetchJob
} from "@shared/schema";

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  // Price queries
  createPriceQuery(query: InsertPriceQuery): Promise<PriceQuery>;
  getRecentPriceQueries(limit?: number): Promise<PriceQuery[]>;
  
  // Historical prices
  createHistoricalPrice(price: InsertHistoricalPrice): Promise<HistoricalPrice>;
  getHistoricalPrice(tokenAddress: string, network: string, timestamp: number): Promise<HistoricalPrice | undefined>;
  getNearestHistoricalPrices(tokenAddress: string, network: string, timestamp: number): Promise<{ before?: HistoricalPrice; after?: HistoricalPrice }>;
  
  // Bulk fetch jobs
  createBulkFetchJob(job: InsertBulkFetchJob): Promise<BulkFetchJob>;
  getActiveBulkFetchJobs(): Promise<BulkFetchJob[]>;
  updateBulkFetchJob(id: number, updates: Partial<BulkFetchJob>): Promise<void>;
  
  // Stats
  getQueryStats(): Promise<{
    totalQueries: number;
    interpolated: number;
    avgResponseTime: number;
  }>;
}

export class MemStorage implements IStorage {
  private users: Map<number, User>;
  private priceQueries: Map<number, PriceQuery>;
  private historicalPrices: Map<string, HistoricalPrice>;
  private bulkFetchJobs: Map<number, BulkFetchJob>;
  private currentUserId: number;
  private currentQueryId: number;
  private currentPriceId: number;
  private currentJobId: number;

  constructor() {
    this.users = new Map();
    this.priceQueries = new Map();
    this.historicalPrices = new Map();
    this.bulkFetchJobs = new Map();
    this.currentUserId = 1;
    this.currentQueryId = 1;
    this.currentPriceId = 1;
    this.currentJobId = 1;
  }

  async getUser(id: number): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(user => user.username === username);
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = this.currentUserId++;
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
  }

  async createPriceQuery(query: InsertPriceQuery): Promise<PriceQuery> {
    const id = this.currentQueryId++;
    const priceQuery: PriceQuery = { 
      ...query, 
      id, 
      price: query.price || null,
      createdAt: new Date()
    };
    this.priceQueries.set(id, priceQuery);
    return priceQuery;
  }

  async getRecentPriceQueries(limit: number = 10): Promise<PriceQuery[]> {
    return Array.from(this.priceQueries.values())
      .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0))
      .slice(0, limit);
  }

  async createHistoricalPrice(price: InsertHistoricalPrice): Promise<HistoricalPrice> {
    const id = this.currentPriceId++;
    const historicalPrice: HistoricalPrice = { 
      ...price, 
      id, 
      marketCap: price.marketCap || null,
      volume: price.volume || null,
      createdAt: new Date()
    };
    const key = `${price.tokenAddress}-${price.network}-${price.timestamp}`;
    this.historicalPrices.set(key, historicalPrice);
    return historicalPrice;
  }

  async getHistoricalPrice(tokenAddress: string, network: string, timestamp: number): Promise<HistoricalPrice | undefined> {
    const key = `${tokenAddress}-${network}-${timestamp}`;
    return this.historicalPrices.get(key);
  }

  async getNearestHistoricalPrices(tokenAddress: string, network: string, timestamp: number): Promise<{ before?: HistoricalPrice; after?: HistoricalPrice }> {
    const prices = Array.from(this.historicalPrices.values())
      .filter(p => p.tokenAddress === tokenAddress && p.network === network);
    
    const before = prices
      .filter(p => p.timestamp < timestamp)
      .sort((a, b) => b.timestamp - a.timestamp)[0];
    
    const after = prices
      .filter(p => p.timestamp > timestamp)
      .sort((a, b) => a.timestamp - b.timestamp)[0];
    
    return { before, after };
  }

  async createBulkFetchJob(job: InsertBulkFetchJob): Promise<BulkFetchJob> {
    const id = this.currentJobId++;
    const bulkFetchJob: BulkFetchJob = { 
      ...job, 
      id, 
      progress: job.progress || null,
      totalDays: job.totalDays || null,
      createdAt: new Date(),
      completedAt: null
    };
    this.bulkFetchJobs.set(id, bulkFetchJob);
    return bulkFetchJob;
  }

  async getActiveBulkFetchJobs(): Promise<BulkFetchJob[]> {
    return Array.from(this.bulkFetchJobs.values())
      .filter(job => job.status === 'pending' || job.status === 'processing');
  }

  async updateBulkFetchJob(id: number, updates: Partial<BulkFetchJob>): Promise<void> {
    const job = this.bulkFetchJobs.get(id);
    if (job) {
      Object.assign(job, updates);
      if (updates.status === 'completed') {
        job.completedAt = new Date();
      }
    }
  }

  async getQueryStats(): Promise<{
    totalQueries: number;
    interpolated: number;
    avgResponseTime: number;
  }> {
    const queries = Array.from(this.priceQueries.values());
    const totalQueries = queries.length;
    const interpolated = queries.filter(q => q.source === 'interpolated').length;
    
    return {
      totalQueries,
      interpolated,
      avgResponseTime: 45 // Mock value since we don't track response times
    };
  }
}

export const storage = new MemStorage();
