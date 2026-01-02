/**
 * Frontend Pattern Load Tests
 *
 * These tests simulate the actual RPC patterns used by the Kumbaya DEX frontend:
 * 1. Multicall batched pool state fetches (slot0 + liquidity for multiple pools)
 * 2. Multi-fee-tier pool discovery (check all 4 fee tiers for a token pair)
 * 3. Route enumeration with batched quotes
 * 4. Chunked QuoterV2 multicall patterns
 *
 * These patterns are more realistic than individual RPC calls and will expose
 * different bottlenecks in the RPC infrastructure.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createMainnetClient } from '../utils/client.js';
import { MEGAETH_MAINNET, FEE_TIERS } from '../config/addresses.js';
import {
  UNISWAP_V3_POOL_ABI,
  UNISWAP_V3_FACTORY_ABI,
  QUOTER_V2_ABI,
} from '../abis/index.js';
import type { PublicClient, Address } from 'viem';
import { parseEther, encodeFunctionData, getAddress, keccak256, concat, encodeAbiParameters } from 'viem';
import { createMetrics, recordSuccess, recordError, printMetricsSummary } from '../utils/client.js';

// Multicall3 ABI - using tryAggregate (view function, same as frontend)
// This matches the frontend pattern in state/multicall/updater.tsx
const MULTICALL3_ABI = [
  {
    inputs: [
      { name: 'requireSuccess', type: 'bool' },
      {
        components: [
          { name: 'target', type: 'address' },
          { name: 'callData', type: 'bytes' },
        ],
        name: 'calls',
        type: 'tuple[]',
      },
    ],
    name: 'tryAggregate',
    outputs: [
      {
        components: [
          { name: 'success', type: 'bool' },
          { name: 'returnData', type: 'bytes' },
        ],
        name: 'returnData',
        type: 'tuple[]',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

// Helper type for tryAggregate calls
type MulticallCall = { target: Address; callData: `0x${string}` };

describe('Frontend Pattern Load Tests', () => {
  let client: PublicClient;
  const network = MEGAETH_MAINNET;

  beforeAll(() => {
    client = createMainnetClient();
  });

  /**
   * Computes the pool address for a given token pair and fee tier
   * Uses the CREATE2 formula: keccak256(0xff + factory + salt + initCodeHash)
   */
  function computePoolAddress(
    factoryAddress: Address,
    tokenA: Address,
    tokenB: Address,
    fee: number,
    initCodeHash: `0x${string}`
  ): Address {
    // Sort tokens
    const [token0, token1] = tokenA.toLowerCase() < tokenB.toLowerCase()
      ? [tokenA, tokenB]
      : [tokenB, tokenA];

    // Compute salt: keccak256(abi.encode(token0, token1, fee))
    const salt = keccak256(
      encodeAbiParameters(
        [{ type: 'address' }, { type: 'address' }, { type: 'uint24' }],
        [token0 as Address, token1 as Address, fee]
      )
    );

    // Compute CREATE2 address
    const create2Input = concat([
      '0xff',
      factoryAddress,
      salt,
      initCodeHash,
    ]);

    const hash = keccak256(create2Input);
    return getAddress(`0x${hash.slice(-40)}`) as Address;
  }

  describe('Multicall Batched Pool State Fetches', () => {
    it('should batch fetch slot0 + liquidity for multiple pools via Multicall3', async () => {
      const multicallAddress = network.contracts.Multicall3 as Address;
      const pools = Object.values(network.pools);

      // Build multicall for slot0 and liquidity for each pool
      const calls: MulticallCall[] = [];

      for (const pool of pools) {
        // slot0 call
        calls.push({
          target: pool.address as Address,
          callData: encodeFunctionData({
            abi: UNISWAP_V3_POOL_ABI,
            functionName: 'slot0',
          }),
        });

        // liquidity call
        calls.push({
          target: pool.address as Address,
          callData: encodeFunctionData({
            abi: UNISWAP_V3_POOL_ABI,
            functionName: 'liquidity',
          }),
        });
      }

      const result = await client.readContract({
        address: multicallAddress,
        abi: MULTICALL3_ABI,
        functionName: 'tryAggregate',
        args: [false, calls], // requireSuccess = false to allow failures
      });

      expect(result).toBeDefined();
      expect(result.length).toBe(calls.length);

      // Verify all calls succeeded
      const successCount = result.filter((r) => r.success).length;
      console.log(`Multicall batch: ${successCount}/${result.length} calls succeeded`);
      expect(successCount).toBe(result.length);
    });

    it('should batch fetch pool states for 10 pools concurrently', async () => {
      const multicallAddress = network.contracts.Multicall3 as Address;
      const duckWethPool = network.pools['DUCK-WETH-10000'];

      // Simulate fetching state for 10 pools (using same pool for simplicity)
      const calls: MulticallCall[] = [];

      for (let i = 0; i < 10; i++) {
        calls.push({
          target: duckWethPool.address as Address,
          callData: encodeFunctionData({
            abi: UNISWAP_V3_POOL_ABI,
            functionName: 'slot0',
          }),
        });
        calls.push({
          target: duckWethPool.address as Address,
          callData: encodeFunctionData({
            abi: UNISWAP_V3_POOL_ABI,
            functionName: 'liquidity',
          }),
        });
      }

      const startTime = Date.now();
      const result = await client.readContract({
        address: multicallAddress,
        abi: MULTICALL3_ABI,
        functionName: 'tryAggregate',
        args: [false, calls],
      });
      const duration = Date.now() - startTime;

      expect(result.length).toBe(20);
      console.log(`Batch fetch 10 pools (20 calls): ${duration}ms`);
    });
  });

  describe('Multi-Fee-Tier Pool Discovery', () => {
    it('should discover pools across all 4 fee tiers for WETH/DUCK pair', async () => {
      const tokenA = network.tokens.WETH as Address;
      const tokenB = network.tokens.DUCK as Address;
      const feeTiers = [FEE_TIERS.LOWEST, FEE_TIERS.LOW, FEE_TIERS.MEDIUM, FEE_TIERS.HIGH];

      // Compute pool addresses for all fee tiers
      const poolAddresses = feeTiers.map((fee) =>
        computePoolAddress(
          network.contracts.UniswapV3Factory as Address,
          tokenA,
          tokenB,
          fee,
          network.poolInitCodeHash
        )
      );

      console.log('Computed pool addresses for WETH/DUCK:');
      feeTiers.forEach((fee, i) => {
        console.log(`  ${fee / 10000}%: ${poolAddresses[i]}`);
      });

      // Batch check which pools exist (have liquidity)
      const multicallAddress = network.contracts.Multicall3 as Address;
      const calls: MulticallCall[] = poolAddresses.map((address) => ({
        target: address,
        callData: encodeFunctionData({
          abi: UNISWAP_V3_POOL_ABI,
          functionName: 'liquidity',
        }),
      }));

      const result = await client.readContract({
        address: multicallAddress,
        abi: MULTICALL3_ABI,
        functionName: 'tryAggregate',
        args: [false, calls],
      });

      const activePools = result.filter((r) => r.success && r.returnData !== '0x');
      console.log(`Active pools: ${activePools.length}/${feeTiers.length}`);

      expect(result.length).toBe(4);
    });

    it('should discover pools via factory getPool for all fee tiers', async () => {
      const tokenA = network.tokens.WETH as Address;
      const tokenB = network.tokens.DUCK as Address;
      const feeTiers = [FEE_TIERS.LOWEST, FEE_TIERS.LOW, FEE_TIERS.MEDIUM, FEE_TIERS.HIGH];

      // Use factory.getPool to find pools (this is what the backend does)
      const multicallAddress = network.contracts.Multicall3 as Address;
      const calls: MulticallCall[] = feeTiers.map((fee) => ({
        target: network.contracts.UniswapV3Factory as Address,
        callData: encodeFunctionData({
          abi: UNISWAP_V3_FACTORY_ABI,
          functionName: 'getPool',
          args: [tokenA, tokenB, fee],
        }),
      }));

      const result = await client.readContract({
        address: multicallAddress,
        abi: MULTICALL3_ABI,
        functionName: 'tryAggregate',
        args: [false, calls],
      });

      expect(result.length).toBe(4);

      // Parse pool addresses from results
      const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
      result.forEach((r, i) => {
        if (r.success && r.returnData.length >= 66) {
          const poolAddress = `0x${r.returnData.slice(-40)}`;
          const exists = poolAddress.toLowerCase() !== ZERO_ADDRESS.toLowerCase();
          console.log(`  ${feeTiers[i] / 10000}% fee: ${exists ? poolAddress : 'not deployed'}`);
        }
      });
    });
  });

  describe('Route Enumeration with Batched Quotes', () => {
    it('should get quotes for multiple routes in single multicall', async () => {
      const multicallAddress = network.contracts.Multicall3 as Address;
      const amountIn = parseEther('0.01');

      // Simulate quoting multiple routes (different fee tiers)
      const feeTiers = [FEE_TIERS.MEDIUM, FEE_TIERS.HIGH];
      const tokenIn = network.tokens.WETH as Address;
      const tokenOut = network.tokens.DUCK as Address;

      const calls: MulticallCall[] = feeTiers.map((fee) => ({
        target: network.contracts.QuoterV2 as Address,
        callData: encodeFunctionData({
          abi: QUOTER_V2_ABI,
          functionName: 'quoteExactInputSingle',
          args: [
            {
              tokenIn,
              tokenOut,
              amountIn,
              fee,
              sqrtPriceLimitX96: 0n,
            },
          ],
        }),
      }));

      const startTime = Date.now();
      const result = await client.readContract({
        address: multicallAddress,
        abi: MULTICALL3_ABI,
        functionName: 'tryAggregate',
        args: [false, calls],
      });
      const duration = Date.now() - startTime;

      console.log(`Batched ${feeTiers.length} quotes in ${duration}ms`);

      // Count successful quotes
      const successfulQuotes = result.filter((r) => r.success);
      console.log(`Successful quotes: ${successfulQuotes.length}/${feeTiers.length}`);

      expect(result.length).toBe(feeTiers.length);
    });

    it('should simulate frontend route discovery pattern', async () => {
      /**
       * Frontend pattern:
       * 1. Get all possible pools for token pair (all fee tiers)
       * 2. Fetch slot0 + liquidity for each pool
       * 3. Quote each valid route
       * 4. Return best quote
       */
      const multicallAddress = network.contracts.Multicall3 as Address;
      const tokenIn = network.tokens.WETH as Address;
      const tokenOut = network.tokens.DUCK as Address;
      const amountIn = parseEther('0.01');

      const metrics = createMetrics();
      const startTime = Date.now();

      // Step 1: Discover pools via factory (all 4 fee tiers)
      const feeTiers = [FEE_TIERS.LOWEST, FEE_TIERS.LOW, FEE_TIERS.MEDIUM, FEE_TIERS.HIGH];

      let reqStart = Date.now();
      const poolDiscoveryCalls: MulticallCall[] = feeTiers.map((fee) => ({
        target: network.contracts.UniswapV3Factory as Address,
        callData: encodeFunctionData({
          abi: UNISWAP_V3_FACTORY_ABI,
          functionName: 'getPool',
          args: [tokenIn, tokenOut, fee],
        }),
      }));

      const poolAddresses = await client.readContract({
        address: multicallAddress,
        abi: MULTICALL3_ABI,
        functionName: 'tryAggregate',
        args: [false, poolDiscoveryCalls],
      });
      recordSuccess(metrics, Date.now() - reqStart);

      // Filter to valid pool addresses
      const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
      const validPools: { address: Address; fee: number }[] = [];
      poolAddresses.forEach((r, i) => {
        if (r.success && r.returnData.length >= 66) {
          const addr = getAddress(`0x${r.returnData.slice(-40)}`);
          if (addr.toLowerCase() !== ZERO_ADDRESS.toLowerCase()) {
            validPools.push({ address: addr, fee: feeTiers[i] });
          }
        }
      });

      console.log(`Found ${validPools.length} valid pools`);

      // Step 2: Fetch slot0 + liquidity for valid pools
      if (validPools.length > 0) {
        reqStart = Date.now();
        const stateCalls: MulticallCall[] = [];

        for (const pool of validPools) {
          stateCalls.push({
            target: pool.address,
            callData: encodeFunctionData({
              abi: UNISWAP_V3_POOL_ABI,
              functionName: 'slot0',
            }),
          });
          stateCalls.push({
            target: pool.address,
            callData: encodeFunctionData({
              abi: UNISWAP_V3_POOL_ABI,
              functionName: 'liquidity',
            }),
          });
        }

        await client.readContract({
          address: multicallAddress,
          abi: MULTICALL3_ABI,
          functionName: 'tryAggregate',
          args: [false, stateCalls],
        });
        recordSuccess(metrics, Date.now() - reqStart);

        // Step 3: Quote each pool with liquidity
        reqStart = Date.now();
        const quoteCalls: MulticallCall[] = validPools.map((pool) => ({
          target: network.contracts.QuoterV2 as Address,
          callData: encodeFunctionData({
            abi: QUOTER_V2_ABI,
            functionName: 'quoteExactInputSingle',
            args: [
              {
                tokenIn,
                tokenOut,
                amountIn,
                fee: pool.fee,
                sqrtPriceLimitX96: 0n,
              },
            ],
          }),
        }));

        const quotes = await client.readContract({
          address: multicallAddress,
          abi: MULTICALL3_ABI,
          functionName: 'tryAggregate',
          args: [false, quoteCalls],
        });
        recordSuccess(metrics, Date.now() - reqStart);

        const successfulQuotes = quotes.filter((q) => q.success);
        console.log(`Got ${successfulQuotes.length} successful quotes`);
      }

      metrics.totalDurationMs = Date.now() - startTime;
      printMetricsSummary(metrics, 'Frontend Route Discovery Pattern');
    });
  });

  describe('Chunked QuoterV2 Multicall Patterns', () => {
    it('should handle chunked quote requests (simulating frontend batching)', async () => {
      /**
       * Frontend chunks quote requests to stay under gas limits.
       * Each quote can use 2-5M gas, so they batch with QUOTER_GAS_REQUIRED = 2.4M
       * to ensure each batch stays under 10M eth_call limit.
       */
      const multicallAddress = network.contracts.Multicall3 as Address;
      const tokenIn = network.tokens.WETH as Address;
      const tokenOut = network.tokens.DUCK as Address;

      // Simulate 10 different quote amounts (like frontend comparing routes)
      const amounts = [
        parseEther('0.001'),
        parseEther('0.005'),
        parseEther('0.01'),
        parseEther('0.05'),
        parseEther('0.1'),
        parseEther('0.5'),
        parseEther('1'),
        parseEther('2'),
        parseEther('5'),
        parseEther('10'),
      ];

      const fee = FEE_TIERS.HIGH; // 1% fee tier

      // Chunk into batches of 3 (simulating gas-aware batching)
      const CHUNK_SIZE = 3;
      const chunks: bigint[][] = [];
      for (let i = 0; i < amounts.length; i += CHUNK_SIZE) {
        chunks.push(amounts.slice(i, i + CHUNK_SIZE));
      }

      console.log(`Processing ${amounts.length} quotes in ${chunks.length} chunks`);

      const metrics = createMetrics();
      const allResults: boolean[] = [];

      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
        const chunk = chunks[chunkIndex];
        const reqStart = Date.now();

        const calls: MulticallCall[] = chunk.map((amountIn) => ({
          target: network.contracts.QuoterV2 as Address,
          callData: encodeFunctionData({
            abi: QUOTER_V2_ABI,
            functionName: 'quoteExactInputSingle',
            args: [
              {
                tokenIn,
                tokenOut,
                amountIn,
                fee,
                sqrtPriceLimitX96: 0n,
              },
            ],
          }),
        }));

        try {
          const result = await client.readContract({
            address: multicallAddress,
            abi: MULTICALL3_ABI,
            functionName: 'tryAggregate',
            args: [false, calls],
          });

          recordSuccess(metrics, Date.now() - reqStart);
          result.forEach((r) => allResults.push(r.success));
          console.log(`  Chunk ${chunkIndex + 1}: ${result.filter((r) => r.success).length}/${chunk.length} successful`);
        } catch (error) {
          recordError(metrics, error as Error);
          console.log(`  Chunk ${chunkIndex + 1}: FAILED - ${(error as Error).message.slice(0, 50)}`);
        }
      }

      const successRate = (allResults.filter((r) => r).length / allResults.length) * 100;
      console.log(`\nTotal success rate: ${successRate.toFixed(1)}%`);

      printMetricsSummary(metrics, 'Chunked Quote Requests');
    });
  });

  describe('Concurrent Frontend Sessions', () => {
    it('should handle 5 concurrent frontend-style route discoveries', async () => {
      const metrics = createMetrics();
      const startTime = Date.now();

      // Simulate 5 users simultaneously discovering routes
      const sessions = Array(5).fill(null).map(async (_, sessionIndex) => {
        const multicallAddress = network.contracts.Multicall3 as Address;
        const tokenIn = network.tokens.WETH as Address;
        const tokenOut = network.tokens.DUCK as Address;
        const amountIn = parseEther(`0.0${sessionIndex + 1}`); // Different amounts

        const reqStart = Date.now();

        try {
          // Pool discovery
          const feeTiers = [FEE_TIERS.LOWEST, FEE_TIERS.LOW, FEE_TIERS.MEDIUM, FEE_TIERS.HIGH];
          const poolDiscoveryCalls: MulticallCall[] = feeTiers.map((fee) => ({
            target: network.contracts.UniswapV3Factory as Address,
            callData: encodeFunctionData({
              abi: UNISWAP_V3_FACTORY_ABI,
              functionName: 'getPool',
              args: [tokenIn, tokenOut, fee],
            }),
          }));

          await client.readContract({
            address: multicallAddress,
            abi: MULTICALL3_ABI,
            functionName: 'tryAggregate',
            args: [false, poolDiscoveryCalls],
          });

          // Quote request
          const quoteCalls: MulticallCall[] = feeTiers.map((fee) => ({
            target: network.contracts.QuoterV2 as Address,
            callData: encodeFunctionData({
              abi: QUOTER_V2_ABI,
              functionName: 'quoteExactInputSingle',
              args: [
                {
                  tokenIn,
                  tokenOut,
                  amountIn,
                  fee,
                  sqrtPriceLimitX96: 0n,
                },
              ],
            }),
          }));

          await client.readContract({
            address: multicallAddress,
            abi: MULTICALL3_ABI,
            functionName: 'tryAggregate',
            args: [false, quoteCalls],
          });

          recordSuccess(metrics, Date.now() - reqStart);
          return { session: sessionIndex, success: true };
        } catch (error) {
          recordError(metrics, error as Error);
          return { session: sessionIndex, success: false, error: (error as Error).message };
        }
      });

      const results = await Promise.all(sessions);
      metrics.totalDurationMs = Date.now() - startTime;

      const successCount = results.filter((r) => r.success).length;
      console.log(`\nConcurrent sessions: ${successCount}/${results.length} completed successfully`);

      printMetricsSummary(metrics, '5 Concurrent Frontend Sessions');

      expect(successCount).toBeGreaterThan(0);
    });

    it('should handle 20 concurrent multicall batches', async () => {
      const metrics = createMetrics();
      const startTime = Date.now();

      const batches = Array(20).fill(null).map(async (_, batchIndex) => {
        const multicallAddress = network.contracts.Multicall3 as Address;
        const pool = network.pools['DUCK-WETH-10000'];
        const reqStart = Date.now();

        try {
          const calls: MulticallCall[] = [
            {
              target: pool.address as Address,
              callData: encodeFunctionData({
                abi: UNISWAP_V3_POOL_ABI,
                functionName: 'slot0',
              }),
            },
            {
              target: pool.address as Address,
              callData: encodeFunctionData({
                abi: UNISWAP_V3_POOL_ABI,
                functionName: 'liquidity',
              }),
            },
            {
              target: pool.address as Address,
              callData: encodeFunctionData({
                abi: UNISWAP_V3_POOL_ABI,
                functionName: 'fee',
              }),
            },
          ];

          const result = await client.readContract({
            address: multicallAddress,
            abi: MULTICALL3_ABI,
            functionName: 'tryAggregate',
            args: [false, calls],
          });

          recordSuccess(metrics, Date.now() - reqStart);
          return { batch: batchIndex, success: true, callsSucceeded: result.filter((r) => r.success).length };
        } catch (error) {
          recordError(metrics, error as Error);
          return { batch: batchIndex, success: false };
        }
      });

      const results = await Promise.all(batches);
      metrics.totalDurationMs = Date.now() - startTime;

      const successCount = results.filter((r) => r.success).length;
      console.log(`\n20 concurrent multicall batches: ${successCount}/20 succeeded`);

      printMetricsSummary(metrics, '20 Concurrent Multicall Batches');

      expect(successCount).toBe(20);
    });
  });

  describe('Heavy Load Frontend Patterns', () => {
    it('should handle 50 concurrent quote + pool state requests', async () => {
      const metrics = createMetrics();
      const startTime = Date.now();

      const requests = Array(50).fill(null).map(async (_, i) => {
        const multicallAddress = network.contracts.Multicall3 as Address;
        const pool = network.pools['DUCK-WETH-10000'];
        const reqStart = Date.now();

        try {
          // Mixed calls: pool state + quote
          const calls: MulticallCall[] = [
            {
              target: pool.address as Address,
              callData: encodeFunctionData({
                abi: UNISWAP_V3_POOL_ABI,
                functionName: 'slot0',
              }),
            },
            {
              target: pool.address as Address,
              callData: encodeFunctionData({
                abi: UNISWAP_V3_POOL_ABI,
                functionName: 'liquidity',
              }),
            },
            {
              target: network.contracts.QuoterV2 as Address,
              callData: encodeFunctionData({
                abi: QUOTER_V2_ABI,
                functionName: 'quoteExactInputSingle',
                args: [
                  {
                    tokenIn: pool.token1 as Address,
                    tokenOut: pool.token0 as Address,
                    amountIn: parseEther(`0.00${i + 1}`),
                    fee: pool.fee,
                    sqrtPriceLimitX96: 0n,
                  },
                ],
              }),
            },
          ];

          const result = await client.readContract({
            address: multicallAddress,
            abi: MULTICALL3_ABI,
            functionName: 'tryAggregate',
            args: [false, calls],
          });

          recordSuccess(metrics, Date.now() - reqStart);
          return { success: true, callsSucceeded: result.filter((r) => r.success).length };
        } catch (error) {
          recordError(metrics, error as Error);
          return { success: false };
        }
      });

      const results = await Promise.all(requests);
      metrics.totalDurationMs = Date.now() - startTime;

      const successCount = results.filter((r) => r.success).length;
      console.log(`\n50 concurrent mixed multicalls: ${successCount}/50 succeeded`);

      printMetricsSummary(metrics, '50 Concurrent Quote + State Requests');
    });
  });
});
