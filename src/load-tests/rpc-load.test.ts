/**
 * RPC Load Tests for Kumbaya DEX
 *
 * These tests are designed to stress test the RPC infrastructure.
 * They intentionally DO NOT implement rate limiting or backoff.
 * If these tests fail due to rate limits, that indicates a problem
 * with RPC capacity that needs to be addressed.
 *
 * Test Scenarios:
 * 1. Burst load - many requests in quick succession
 * 2. Sustained load - continuous requests over time
 * 3. Mixed workload - simulates real frontend usage patterns
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createMainnetClient, createMetrics, recordSuccess, recordError, printMetricsSummary } from '../utils/client.js';
import { MEGAETH_MAINNET } from '../config/addresses.js';
import {
  UNISWAP_V3_POOL_ABI,
  QUOTER_V2_ABI,
  ERC20_ABI,
} from '../abis/index.js';
import type { PublicClient, Address } from 'viem';
import { parseEther } from 'viem';

describe('RPC Load Tests', () => {
  let client: PublicClient;
  const network = MEGAETH_MAINNET;
  const pool = network.pools['DUCK-WETH-10000'];

  beforeAll(() => {
    client = createMainnetClient();
  });

  describe('Burst Load Tests', () => {
    it('should handle 100 concurrent slot0 reads', async () => {
      const metrics = createMetrics();
      const startTime = Date.now();

      const requests = Array(100).fill(null).map(async () => {
        const reqStart = Date.now();
        try {
          await client.readContract({
            address: pool.address as Address,
            abi: UNISWAP_V3_POOL_ABI,
            functionName: 'slot0',
          });
          recordSuccess(metrics, Date.now() - reqStart);
        } catch (error) {
          recordError(metrics, error as Error);
        }
      });

      await Promise.all(requests);
      metrics.totalDurationMs = Date.now() - startTime;

      printMetricsSummary(metrics, 'Burst: 100 slot0 reads');

      // We expect all requests to succeed - failures indicate RPC issues
      expect(metrics.successfulRequests).toBe(100);
      expect(metrics.rateLimitErrors).toBe(0);
    });

    it('should handle 100 concurrent quote requests', async () => {
      const metrics = createMetrics();
      const startTime = Date.now();
      const amountIn = parseEther('0.001');

      const requests = Array(100).fill(null).map(async () => {
        const reqStart = Date.now();
        try {
          await client.simulateContract({
            address: network.contracts.QuoterV2 as Address,
            abi: QUOTER_V2_ABI,
            functionName: 'quoteExactInputSingle',
            args: [
              {
                tokenIn: pool.token1 as Address,
                tokenOut: pool.token0 as Address,
                amountIn,
                fee: pool.fee,
                sqrtPriceLimitX96: 0n,
              },
            ],
          });
          recordSuccess(metrics, Date.now() - reqStart);
        } catch (error) {
          recordError(metrics, error as Error);
        }
      });

      await Promise.all(requests);
      metrics.totalDurationMs = Date.now() - startTime;

      printMetricsSummary(metrics, 'Burst: 100 quote requests');

      expect(metrics.successfulRequests).toBe(100);
      expect(metrics.rateLimitErrors).toBe(0);
    });

    it('should handle 200 concurrent mixed reads', async () => {
      const metrics = createMetrics();
      const startTime = Date.now();

      const requests = Array(200).fill(null).map(async (_, i) => {
        const reqStart = Date.now();
        try {
          // Alternate between different read types
          switch (i % 4) {
            case 0:
              await client.readContract({
                address: pool.address as Address,
                abi: UNISWAP_V3_POOL_ABI,
                functionName: 'slot0',
              });
              break;
            case 1:
              await client.readContract({
                address: pool.address as Address,
                abi: UNISWAP_V3_POOL_ABI,
                functionName: 'liquidity',
              });
              break;
            case 2:
              await client.readContract({
                address: network.tokens.WETH as Address,
                abi: ERC20_ABI,
                functionName: 'totalSupply',
              });
              break;
            case 3:
              await client.readContract({
                address: network.tokens.DUCK as Address,
                abi: ERC20_ABI,
                functionName: 'totalSupply',
              });
              break;
          }
          recordSuccess(metrics, Date.now() - reqStart);
        } catch (error) {
          recordError(metrics, error as Error);
        }
      });

      await Promise.all(requests);
      metrics.totalDurationMs = Date.now() - startTime;

      printMetricsSummary(metrics, 'Burst: 200 mixed reads');

      expect(metrics.successfulRequests).toBe(200);
      expect(metrics.rateLimitErrors).toBe(0);
    });
  });

  describe('Sustained Load Tests', () => {
    it('should handle sustained load of 10 req/s for 10 seconds', async () => {
      const metrics = createMetrics();
      const startTime = Date.now();
      const durationMs = 10000; // 10 seconds
      const requestsPerSecond = 10;
      const intervalMs = 1000 / requestsPerSecond;

      const requests: Promise<void>[] = [];
      let requestCount = 0;

      // Schedule requests at fixed intervals
      while (Date.now() - startTime < durationMs) {
        const reqStart = Date.now();
        requests.push(
          client.readContract({
            address: pool.address as Address,
            abi: UNISWAP_V3_POOL_ABI,
            functionName: 'slot0',
          }).then(() => {
            recordSuccess(metrics, Date.now() - reqStart);
          }).catch((error) => {
            recordError(metrics, error as Error);
          })
        );
        requestCount++;

        // Wait for next interval
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }

      await Promise.all(requests);
      metrics.totalDurationMs = Date.now() - startTime;

      printMetricsSummary(metrics, `Sustained: ${requestsPerSecond} req/s for ${durationMs / 1000}s`);

      // Allow for some timing variance
      expect(metrics.totalRequests).toBeGreaterThanOrEqual(requestsPerSecond * (durationMs / 1000) * 0.9);
      expect(metrics.rateLimitErrors).toBe(0);
    });

    it('should handle sustained load of 50 req/s for 5 seconds', async () => {
      const metrics = createMetrics();
      const startTime = Date.now();
      const durationMs = 5000;
      const requestsPerSecond = 50;
      const intervalMs = 1000 / requestsPerSecond;

      const requests: Promise<void>[] = [];

      while (Date.now() - startTime < durationMs) {
        const reqStart = Date.now();
        requests.push(
          client.readContract({
            address: pool.address as Address,
            abi: UNISWAP_V3_POOL_ABI,
            functionName: 'liquidity',
          }).then(() => {
            recordSuccess(metrics, Date.now() - reqStart);
          }).catch((error) => {
            recordError(metrics, error as Error);
          })
        );

        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }

      await Promise.all(requests);
      metrics.totalDurationMs = Date.now() - startTime;

      printMetricsSummary(metrics, `Sustained: ${requestsPerSecond} req/s for ${durationMs / 1000}s`);

      expect(metrics.rateLimitErrors).toBe(0);
    });
  });

  describe('Simulated Frontend Load', () => {
    /**
     * Simulates a user viewing the swap page:
     * - Initial page load: fetch pool state, token balances, prices
     * - User types amount: fetch quote
     * - Repeated quote fetches as user adjusts amount
     */
    it('should handle simulated swap page session', async () => {
      const metrics = createMetrics();
      const startTime = Date.now();
      const amountIn = parseEther('0.01');

      // Phase 1: Initial page load (burst)
      const initialLoadPromises = [
        // Pool state
        client.readContract({
          address: pool.address as Address,
          abi: UNISWAP_V3_POOL_ABI,
          functionName: 'slot0',
        }),
        client.readContract({
          address: pool.address as Address,
          abi: UNISWAP_V3_POOL_ABI,
          functionName: 'liquidity',
        }),
        // Token info
        client.readContract({
          address: network.tokens.WETH as Address,
          abi: ERC20_ABI,
          functionName: 'symbol',
        }),
        client.readContract({
          address: network.tokens.DUCK as Address,
          abi: ERC20_ABI,
          functionName: 'symbol',
        }),
      ];

      for (const promise of initialLoadPromises) {
        const reqStart = Date.now();
        try {
          await promise;
          recordSuccess(metrics, Date.now() - reqStart);
        } catch (error) {
          recordError(metrics, error as Error);
        }
      }

      // Phase 2: User types amount - quote fetches (with debounce simulation)
      for (let i = 0; i < 10; i++) {
        await new Promise((resolve) => setTimeout(resolve, 300)); // 300ms debounce

        const reqStart = Date.now();
        try {
          await client.simulateContract({
            address: network.contracts.QuoterV2 as Address,
            abi: QUOTER_V2_ABI,
            functionName: 'quoteExactInputSingle',
            args: [
              {
                tokenIn: pool.token1 as Address,
                tokenOut: pool.token0 as Address,
                amountIn: amountIn + BigInt(i) * parseEther('0.001'),
                fee: pool.fee,
                sqrtPriceLimitX96: 0n,
              },
            ],
          });
          recordSuccess(metrics, Date.now() - reqStart);
        } catch (error) {
          recordError(metrics, error as Error);
        }
      }

      // Phase 3: Periodic pool state refresh (every 5 seconds, simulated as 2 refreshes)
      for (let i = 0; i < 2; i++) {
        await new Promise((resolve) => setTimeout(resolve, 1000));

        const reqStart = Date.now();
        try {
          await client.readContract({
            address: pool.address as Address,
            abi: UNISWAP_V3_POOL_ABI,
            functionName: 'slot0',
          });
          recordSuccess(metrics, Date.now() - reqStart);
        } catch (error) {
          recordError(metrics, error as Error);
        }
      }

      metrics.totalDurationMs = Date.now() - startTime;

      printMetricsSummary(metrics, 'Simulated Swap Page Session');

      expect(metrics.rateLimitErrors).toBe(0);
      expect(metrics.successfulRequests).toBeGreaterThanOrEqual(14); // 4 initial + 10 quotes + 2 refreshes
    });

    /**
     * Simulates multiple users on the platform simultaneously
     */
    it('should handle 10 concurrent user sessions', async () => {
      const metrics = createMetrics();
      const startTime = Date.now();

      const userSessions = Array(10).fill(null).map(async (_, userIndex) => {
        // Stagger user arrivals slightly
        await new Promise((resolve) => setTimeout(resolve, userIndex * 100));

        // Each user does: initial load + 3 quotes
        const userOps = [
          client.readContract({
            address: pool.address as Address,
            abi: UNISWAP_V3_POOL_ABI,
            functionName: 'slot0',
          }),
          client.readContract({
            address: pool.address as Address,
            abi: UNISWAP_V3_POOL_ABI,
            functionName: 'liquidity',
          }),
        ];

        for (const op of userOps) {
          const reqStart = Date.now();
          try {
            await op;
            recordSuccess(metrics, Date.now() - reqStart);
          } catch (error) {
            recordError(metrics, error as Error);
          }
        }

        // User quote requests
        for (let i = 0; i < 3; i++) {
          await new Promise((resolve) => setTimeout(resolve, 200));
          const reqStart = Date.now();
          try {
            await client.simulateContract({
              address: network.contracts.QuoterV2 as Address,
              abi: QUOTER_V2_ABI,
              functionName: 'quoteExactInputSingle',
              args: [
                {
                  tokenIn: pool.token1 as Address,
                  tokenOut: pool.token0 as Address,
                  amountIn: parseEther('0.01'),
                  fee: pool.fee,
                  sqrtPriceLimitX96: 0n,
                },
              ],
            });
            recordSuccess(metrics, Date.now() - reqStart);
          } catch (error) {
            recordError(metrics, error as Error);
          }
        }
      });

      await Promise.all(userSessions);
      metrics.totalDurationMs = Date.now() - startTime;

      printMetricsSummary(metrics, '10 Concurrent User Sessions');

      // 10 users * (2 initial loads + 3 quotes) = 50 requests
      expect(metrics.totalRequests).toBe(50);
      expect(metrics.rateLimitErrors).toBe(0);
    });
  });
});
