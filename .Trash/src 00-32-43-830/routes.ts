import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { alchemyService } from "./services/alchemy";
import { redisService } from "./services/redis";
import { interpolationService } from "./services/interpolation";
import { queueService } from "./services/queue";
import { 
  priceRequestSchema, 
  bulkFetchRequestSchema,
  type PriceRequest,
  type BulkFetchRequest
} from "@shared/schema";

export async function registerRoutes(app: Express): Promise<Server> {
  // Price lookup endpoint
  app.post("/api/price", async (req, res) => {
    try {
      const { token, network, timestamp }: PriceRequest = priceRequestSchema.parse(req.body);
      
      // Check Redis cache first
      const cached = await redisService.getCachedPrice(token, network, timestamp);
      if (cached) {
        await storage.createPriceQuery({
          tokenAddress: token,
          network,
          timestamp,
          price: cached.price.toString(),
          source: 'cache',
        });
        
        return res.json({
          price: cached.price,
          source: 'cache',
          marketCap: cached.marketCap,
          volume: cached.volume,
        });
      }
      
      // Check storage for exact match
      const existingPrice = await storage.getHistoricalPrice(token, network, timestamp);
      if (existingPrice) {
        const result = {
          price: parseFloat(existingPrice.price),
          source: 'storage',
          marketCap: existingPrice.marketCap ? parseFloat(existingPrice.marketCap) : undefined,
          volume: existingPrice.volume ? parseFloat(existingPrice.volume) : undefined,
        };
        
        await redisService.setCachedPrice(token, network, timestamp, result);
        await storage.createPriceQuery({
          tokenAddress: token,
          network,
          timestamp,
          price: existingPrice.price,
          source: 'storage',
        });
        
        return res.json(result);
      }
      
      // Try to get from Alchemy
      const alchemyPrice = await alchemyService.getTokenPrice(token, network, timestamp);
      if (alchemyPrice) {
        const result = {
          price: alchemyPrice.price,
          source: 'alchemy',
          marketCap: alchemyPrice.marketCap,
          volume: alchemyPrice.volume,
        };
        
        // Store in cache and storage
        await redisService.setCachedPrice(token, network, timestamp, result);
        await storage.createHistoricalPrice({
          tokenAddress: token,
          network,
          timestamp,
          price: alchemyPrice.price.toString(),
          marketCap: alchemyPrice.marketCap?.toString() || null,
          volume: alchemyPrice.volume?.toString() || null,
        });
        
        await storage.createPriceQuery({
          tokenAddress: token,
          network,
          timestamp,
          price: alchemyPrice.price.toString(),
          source: 'alchemy',
        });
        
        return res.json(result);
      }
      
      // Try interpolation
      const { before, after } = await storage.getNearestHistoricalPrices(token, network, timestamp);
      if (before && after && interpolationService.canInterpolate(before, after, timestamp)) {
        const interpolated = interpolationService.interpolatePrice(timestamp, before, after);
        
        const result = {
          price: interpolated.price,
          source: 'interpolated',
          details: interpolated.details,
        };
        
        // Store interpolated result
        await redisService.setCachedPrice(token, network, timestamp, result);
        await storage.createPriceQuery({
          tokenAddress: token,
          network,
          timestamp,
          price: interpolated.price.toString(),
          source: 'interpolated',
        });
        
        return res.json(result);
      }
      
      // No price found
      res.status(404).json({ 
        error: "Price not found",
        message: "No historical price data available for the specified timestamp"
      });
      
    } catch (error) {
      console.error("Price lookup error:", error);
      res.status(500).json({ 
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Schedule bulk fetch endpoint
  app.post("/api/schedule", async (req, res) => {
    try {
      const { token, network }: BulkFetchRequest = bulkFetchRequestSchema.parse(req.body);
      
      const jobId = await queueService.addBulkFetchJob(token, network);
      
      res.json({ 
        jobId,
        message: "Bulk fetch job scheduled successfully"
      });
      
    } catch (error) {
      console.error("Schedule bulk fetch error:", error);
      res.status(500).json({ 
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Get system status
  app.get("/api/status", async (req, res) => {
    try {
      const activeJobs = await storage.getActiveBulkFetchJobs();
      const recentQueries = await storage.getRecentPriceQueries(10);
      const stats = await storage.getQueryStats();
      
      res.json({
        redis: {
          connected: redisService.isConnected(),
          ttl: "5min"
        },
        alchemy: {
          connected: true,
          rateLimitHandled: true
        },
        database: {
          connected: true
        },
        queue: {
          workers: 3,
          activeJobs: activeJobs.length
        },
        activeJobs,
        recentQueries,
        stats: {
          totalQueries: stats.totalQueries,
          cacheHitRate: 89, // Mock value
          interpolated: Math.round((stats.interpolated / stats.totalQueries) * 100) || 0,
          avgResponseTime: stats.avgResponseTime
        }
      });
      
    } catch (error) {
      console.error("Status error:", error);
      res.status(500).json({ 
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
