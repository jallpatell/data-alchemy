import { HistoricalPrice } from '@shared/schema';

export interface InterpolationResult {
  price: number;
  source: 'interpolated';
  details: {
    beforePrice: number;
    afterPrice: number;
    beforeTimestamp: number;
    afterTimestamp: number;
    ratio: number;
  };
}

export class InterpolationService {
  /**
   * Interpolates price between two data points using linear interpolation
   * with weighted timestamp calculations
   */
  interpolatePrice(
    targetTimestamp: number,
    beforePrice: HistoricalPrice,
    afterPrice: HistoricalPrice
  ): InterpolationResult {
    const beforeTs = beforePrice.timestamp;
    const afterTs = afterPrice.timestamp;
    const beforePriceValue = parseFloat(beforePrice.price);
    const afterPriceValue = parseFloat(afterPrice.price);
    
    // Calculate ratio: how far the target timestamp is between before and after
    const ratio = (targetTimestamp - beforeTs) / (afterTs - beforeTs);
    
    // Linear interpolation: price = beforePrice + (afterPrice - beforePrice) * ratio
    const interpolatedPrice = beforePriceValue + (afterPriceValue - beforePriceValue) * ratio;
    
    return {
      price: interpolatedPrice,
      source: 'interpolated',
      details: {
        beforePrice: beforePriceValue,
        afterPrice: afterPriceValue,
        beforeTimestamp: beforeTs,
        afterTimestamp: afterTs,
        ratio,
      },
    };
  }

  /**
   * Validates that interpolation is reasonable
   * - Time gap shouldn't be too large (e.g., > 7 days)
   * - Price difference shouldn't be too extreme
   */
  canInterpolate(
    beforePrice: HistoricalPrice,
    afterPrice: HistoricalPrice,
    targetTimestamp: number
  ): boolean {
    const beforeTs = beforePrice.timestamp;
    const afterTs = afterPrice.timestamp;
    const beforePriceValue = parseFloat(beforePrice.price);
    const afterPriceValue = parseFloat(afterPrice.price);
    
    // Check if target timestamp is within range
    if (targetTimestamp <= beforeTs || targetTimestamp >= afterTs) {
      return false;
    }
    
    // Check if time gap is reasonable (max 7 days)
    const timeGap = afterTs - beforeTs;
    const maxGap = 7 * 24 * 60 * 60; // 7 days in seconds
    if (timeGap > maxGap) {
      return false;
    }
    
    // Check if price change is reasonable (max 50% change)
    const priceChange = Math.abs(afterPriceValue - beforePriceValue) / beforePriceValue;
    if (priceChange > 0.5) {
      return false;
    }
    
    return true;
  }
}

export const interpolationService = new InterpolationService();
