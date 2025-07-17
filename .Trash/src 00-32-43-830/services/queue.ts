import { Queue, Worker, Job } from 'bullmq';
import { storage } from '../storage';
import { alchemyService } from './alchemy';
import { redisService } from './redis';

interface BulkFetchJobData {
  tokenAddress: string;
  network: string;
  jobId: number;
}

export class QueueService {
  private queue: Queue;
  private worker: Worker;

  constructor() {
    try {
      // Initialize Bull queue
      this.queue = new Queue('bulk-fetch', {
        connection: {
          host: process.env.REDIS_HOST || 'localhost',
          port: parseInt(process.env.REDIS_PORT || '6379'),
          lazyConnect: true,
        },
      });

      // Initialize worker
      this.worker = new Worker('bulk-fetch', this.processJob.bind(this), {
        connection: {
          host: process.env.REDIS_HOST || 'localhost',
          port: parseInt(process.env.REDIS_PORT || '6379'),
          lazyConnect: true,
        },
        concurrency: 3,
      });

      this.worker.on('completed', (job) => {
        console.log(`Job ${job.id} completed`);
      });

      this.worker.on('failed', (job, err) => {
        console.error(`Job ${job?.id} failed:`, err);
      });
    } catch (error) {
      console.warn('Failed to initialize queue, continuing without queue functionality:', error);
    }
  }

  async addBulkFetchJob(tokenAddress: string, network: string): Promise<number> {
    // Create job in storage
    const job = await storage.createBulkFetchJob({
      tokenAddress,
      network,
      status: 'pending',
      progress: 0,
      totalDays: null,
    });

    // Add to queue if available
    try {
      if (this.queue) {
        await this.queue.add('bulk-fetch', {
          tokenAddress,
          network,
          jobId: job.id,
        });
      }
    } catch (error) {
      console.warn('Failed to add job to queue, will process manually:', error);
    }

    return job.id;
  }

  private async processJob(job: Job<BulkFetchJobData>): Promise<void> {
    const { tokenAddress, network, jobId } = job.data;

    try {
      // Update job status to processing
      await storage.updateBulkFetchJob(jobId, { status: 'processing' });

      // Get token creation date
      const creationTimestamp = await alchemyService.getTokenCreationDate(tokenAddress, network);
      if (!creationTimestamp) {
        throw new Error('Could not determine token creation date');
      }

      // Generate daily timestamps from creation to now
      const now = Math.floor(Date.now() / 1000);
      const timestamps: number[] = [];
      
      for (let ts = creationTimestamp; ts <= now; ts += 24 * 60 * 60) {
        timestamps.push(ts);
      }

      // Update total days
      await storage.updateBulkFetchJob(jobId, { totalDays: timestamps.length });

      // Process in batches
      const batchSize = 10;
      for (let i = 0; i < timestamps.length; i += batchSize) {
        const batch = timestamps.slice(i, i + batchSize);
        
        // Fetch prices for batch
        const prices = await alchemyService.batchGetHistoricalPrices(
          tokenAddress,
          network,
          batch
        );

        // Store prices in storage
        for (let j = 0; j < prices.length; j++) {
          const price = prices[j];
          if (price) {
            await storage.createHistoricalPrice({
              tokenAddress,
              network,
              timestamp: batch[j],
              price: price.price.toString(),
              marketCap: price.marketCap?.toString() || null,
              volume: price.volume?.toString() || null,
            });
          }
        }

        // Update progress
        const progress = Math.floor(((i + batchSize) / timestamps.length) * 100);
        await storage.updateBulkFetchJob(jobId, { progress });

        // Update job progress in Bull
        await job.updateProgress(progress);
      }

      // Mark job as completed
      await storage.updateBulkFetchJob(jobId, { 
        status: 'completed',
        progress: 100,
      });

    } catch (error) {
      console.error('Bulk fetch job failed:', error);
      await storage.updateBulkFetchJob(jobId, { status: 'failed' });
      throw error;
    }
  }

  async getJobStatus(jobId: number) {
    try {
      if (this.queue) {
        const jobs = await this.queue.getJobs(['active', 'waiting', 'completed', 'failed']);
        return jobs.find(job => job.data.jobId === jobId);
      }
    } catch (error) {
      console.warn('Failed to get job status from queue:', error);
    }
    return null;
  }
}

export const queueService = new QueueService();
