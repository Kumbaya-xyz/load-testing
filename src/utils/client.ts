/**
 * Viem client setup for MegaETH
 */

import { createPublicClient, http, type PublicClient, type Chain } from 'viem';
import { MEGAETH_MAINNET, MEGAETH_TESTNET, type NetworkConfig } from '../config/addresses.js';

// Define MegaETH chains for viem
export const megaethMainnet: Chain = {
  id: 4326,
  name: 'MegaETH',
  nativeCurrency: {
    decimals: 18,
    name: 'Ether',
    symbol: 'ETH',
  },
  rpcUrls: {
    default: { http: ['https://mainnet.megaeth.com/rpc'] },
  },
  blockExplorers: {
    default: { name: 'Blockscout', url: 'https://megaeth.blockscout.com' },
  },
};

export const megaethTestnet: Chain = {
  id: 6343,
  name: 'MegaETH Testnet',
  nativeCurrency: {
    decimals: 18,
    name: 'Ether',
    symbol: 'ETH',
  },
  rpcUrls: {
    default: { http: ['https://timothy.megaeth.com/rpc'] },
  },
  blockExplorers: {
    default: { name: 'Blockscout', url: 'https://megaeth-testnet-v2.blockscout.com' },
  },
};

/**
 * Create a public client for the specified network
 * NOTE: No rate limiting is applied - this is intentional to expose RPC limits
 */
export function createClient(network: NetworkConfig): PublicClient {
  const chain = network.chainId === 4326 ? megaethMainnet : megaethTestnet;

  return createPublicClient({
    chain,
    transport: http(network.rpc, {
      // No retries - we want to see failures
      retryCount: 0,
      // No timeout adjustment - use defaults
    }),
  });
}

/**
 * Create mainnet client
 */
export function createMainnetClient(): PublicClient {
  return createClient(MEGAETH_MAINNET);
}

/**
 * Create testnet client
 */
export function createTestnetClient(): PublicClient {
  return createClient(MEGAETH_TESTNET);
}

/**
 * Metrics tracking for load tests
 */
export interface LoadTestMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  rateLimitErrors: number;
  otherErrors: number;
  totalDurationMs: number;
  requestDurations: number[];
  errors: Array<{ message: string; timestamp: number }>;
}

export function createMetrics(): LoadTestMetrics {
  return {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    rateLimitErrors: 0,
    otherErrors: 0,
    totalDurationMs: 0,
    requestDurations: [],
    errors: [],
  };
}

export function recordSuccess(metrics: LoadTestMetrics, durationMs: number): void {
  metrics.totalRequests++;
  metrics.successfulRequests++;
  metrics.requestDurations.push(durationMs);
}

export function recordError(metrics: LoadTestMetrics, error: Error): void {
  metrics.totalRequests++;
  metrics.failedRequests++;

  const message = error.message.toLowerCase();
  if (message.includes('rate') || message.includes('limit') || message.includes('429') || message.includes('too many')) {
    metrics.rateLimitErrors++;
  } else {
    metrics.otherErrors++;
  }

  metrics.errors.push({
    message: error.message,
    timestamp: Date.now(),
  });
}

export function printMetricsSummary(metrics: LoadTestMetrics, testName: string): void {
  const avgDuration = metrics.requestDurations.length > 0
    ? metrics.requestDurations.reduce((a, b) => a + b, 0) / metrics.requestDurations.length
    : 0;

  const sortedDurations = [...metrics.requestDurations].sort((a, b) => a - b);
  const p50 = sortedDurations[Math.floor(sortedDurations.length * 0.5)] ?? 0;
  const p95 = sortedDurations[Math.floor(sortedDurations.length * 0.95)] ?? 0;
  const p99 = sortedDurations[Math.floor(sortedDurations.length * 0.99)] ?? 0;

  console.log(`\n========== ${testName} ==========`);
  console.log(`Total Requests: ${metrics.totalRequests}`);
  console.log(`Successful: ${metrics.successfulRequests} (${((metrics.successfulRequests / metrics.totalRequests) * 100).toFixed(1)}%)`);
  console.log(`Failed: ${metrics.failedRequests} (${((metrics.failedRequests / metrics.totalRequests) * 100).toFixed(1)}%)`);
  console.log(`  - Rate Limit Errors: ${metrics.rateLimitErrors}`);
  console.log(`  - Other Errors: ${metrics.otherErrors}`);
  console.log(`\nLatency:`);
  console.log(`  - Average: ${avgDuration.toFixed(2)}ms`);
  console.log(`  - P50: ${p50.toFixed(2)}ms`);
  console.log(`  - P95: ${p95.toFixed(2)}ms`);
  console.log(`  - P99: ${p99.toFixed(2)}ms`);
  console.log(`Total Duration: ${metrics.totalDurationMs.toFixed(2)}ms`);
  console.log(`Throughput: ${(metrics.totalRequests / (metrics.totalDurationMs / 1000)).toFixed(2)} req/s`);

  if (metrics.errors.length > 0) {
    console.log(`\nFirst 5 Errors:`);
    metrics.errors.slice(0, 5).forEach((e, i) => {
      console.log(`  ${i + 1}. ${e.message.slice(0, 100)}`);
    });
  }
  console.log('================================\n');
}
