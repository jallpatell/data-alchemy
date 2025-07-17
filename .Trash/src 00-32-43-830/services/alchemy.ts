import { Alchemy, Network } from 'alchemy-sdk';
import pRetry from 'p-retry';

const config = {
  apiKey: process.env.ALCHEMY_API_KEY || 'demo',
  network: Network.ETH_MAINNET,
};

const polygonConfig = {
  apiKey: process.env.ALCHEMY_API_KEY || 'demo',
  network: Network.MATIC_MAINNET,
};

const ethAlchemy = new Alchemy(config);
const polygonAlchemy = new Alchemy(polygonConfig);

export interface TokenPrice {
  price: number;
  timestamp: number;
  marketCap?: number;
  volume?: number;
}

export class AlchemyService {
  private getAlchemyInstance(network: string): Alchemy {
    return network === 'polygon' ? polygonAlchemy : ethAlchemy;
  }

  async getTokenPrice(tokenAddress: string, network: string, timestamp: number): Promise<TokenPrice | null> {
    const alchemy = this.getAlchemyInstance(network);
    
    try {
      const result = await pRetry(
        async () => {
          // Note: Alchemy's historical prices API endpoint would be used here
          // For demo purposes, we'll simulate the API call
          const response = await fetch(`https://api.alchemy.com/v2/${config.apiKey}/historical-prices`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              token: tokenAddress,
              network,
              timestamp,
            }),
          });
          
          if (response.status === 429) {
            throw new Error('Rate limited');
          }
          
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }
          
          const data = await response.json();
          return data;
        },
        {
          retries: 3,
          factor: 2,
          minTimeout: 1000,
          maxTimeout: 5000,
        }
      );
      
      return result;
    } catch (error) {
      console.error('Error fetching token price from Alchemy:', error);
      return null;
    }
  }

  async getTokenCreationDate(tokenAddress: string, network: string): Promise<number | null> {
    const alchemy = this.getAlchemyInstance(network);
    
    try {
      const result = await pRetry(
        async () => {
          const transfers = await alchemy.core.getAssetTransfers({
            contractAddresses: [tokenAddress],
            order: 'asc',
            maxCount: 1,
            category: ['erc20'],
          });
          
          if (transfers.transfers.length === 0) {
            throw new Error('No transfers found');
          }
          
          const firstTransfer = transfers.transfers[0];
          const block = await alchemy.core.getBlock(firstTransfer.blockNum);
          
          return block.timestamp;
        },
        {
          retries: 3,
          factor: 2,
          minTimeout: 1000,
          maxTimeout: 5000,
        }
      );
      
      return result;
    } catch (error) {
      console.error('Error fetching token creation date:', error);
      return null;
    }
  }

  async batchGetHistoricalPrices(
    tokenAddress: string,
    network: string,
    timestamps: number[]
  ): Promise<(TokenPrice | null)[]> {
    const batchSize = 10; // Limit batch size to avoid rate limits
    const results: (TokenPrice | null)[] = [];
    
    for (let i = 0; i < timestamps.length; i += batchSize) {
      const batch = timestamps.slice(i, i + batchSize);
      const batchPromises = batch.map(timestamp =>
        this.getTokenPrice(tokenAddress, network, timestamp)
      );
      
      const batchResults = await Promise.allSettled(batchPromises);
      results.push(...batchResults.map(result => 
        result.status === 'fulfilled' ? result.value : null
      ));
      
      // Add delay between batches to respect rate limits
      if (i + batchSize < timestamps.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    return results;
  }
}

export const alchemyService = new AlchemyService();
