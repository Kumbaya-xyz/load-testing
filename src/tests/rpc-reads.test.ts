/**
 * RPC Read Tests for Kumbaya DEX
 *
 * Tests basic RPC read operations that the DEX frontend performs.
 * These tests do NOT apply any rate limiting - they will fail if the RPC
 * infrastructure cannot handle the load. This is intentional.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createMainnetClient } from '../utils/client.js';
import { MEGAETH_MAINNET } from '../config/addresses.js';
import {
  UNISWAP_V3_POOL_ABI,
  UNISWAP_V3_FACTORY_ABI,
  QUOTER_V2_ABI,
  ERC20_ABI,
  MULTICALL_ABI,
} from '../abis/index.js';
import type { PublicClient, Address } from 'viem';
import { parseEther } from 'viem';

describe('RPC Read Operations', () => {
  let client: PublicClient;
  const network = MEGAETH_MAINNET;
  const duckWethPool = network.pools['DUCK-WETH-10000'];

  beforeAll(() => {
    client = createMainnetClient();
  });

  describe('Pool State Reads', () => {
    it('should read pool slot0 (current price and tick)', async () => {
      const result = await client.readContract({
        address: duckWethPool.address as Address,
        abi: UNISWAP_V3_POOL_ABI,
        functionName: 'slot0',
      });

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      // slot0 returns [sqrtPriceX96, tick, observationIndex, ...]
      const [sqrtPriceX96, tick] = result as [bigint, number, ...unknown[]];
      expect(typeof sqrtPriceX96).toBe('bigint');
      expect(sqrtPriceX96).toBeGreaterThan(0n);
      expect(typeof tick).toBe('number');
    });

    it('should read pool liquidity', async () => {
      const liquidity = await client.readContract({
        address: duckWethPool.address as Address,
        abi: UNISWAP_V3_POOL_ABI,
        functionName: 'liquidity',
      });

      expect(typeof liquidity).toBe('bigint');
      // Pool should have some liquidity
      expect(liquidity).toBeGreaterThanOrEqual(0n);
    });

    it('should read pool tokens', async () => {
      const [token0, token1] = await Promise.all([
        client.readContract({
          address: duckWethPool.address as Address,
          abi: UNISWAP_V3_POOL_ABI,
          functionName: 'token0',
        }),
        client.readContract({
          address: duckWethPool.address as Address,
          abi: UNISWAP_V3_POOL_ABI,
          functionName: 'token1',
        }),
      ]);

      expect(token0).toBe(duckWethPool.token0);
      expect(token1).toBe(duckWethPool.token1);
    });

    it('should read pool fee', async () => {
      const fee = await client.readContract({
        address: duckWethPool.address as Address,
        abi: UNISWAP_V3_POOL_ABI,
        functionName: 'fee',
      });

      expect(fee).toBe(duckWethPool.fee);
    });
  });

  describe('Factory Reads', () => {
    it('should lookup pool address from factory', async () => {
      const poolAddress = await client.readContract({
        address: network.contracts.UniswapV3Factory as Address,
        abi: UNISWAP_V3_FACTORY_ABI,
        functionName: 'getPool',
        args: [
          duckWethPool.token0 as Address,
          duckWethPool.token1 as Address,
          duckWethPool.fee,
        ],
      });

      expect(poolAddress.toLowerCase()).toBe(duckWethPool.address.toLowerCase());
    });

    it('should read fee amount tick spacing for all fee tiers', async () => {
      const feeTiers = [100, 500, 3000, 10000];
      const expectedSpacing = [1, 10, 60, 200];

      const results = await Promise.all(
        feeTiers.map((fee) =>
          client.readContract({
            address: network.contracts.UniswapV3Factory as Address,
            abi: UNISWAP_V3_FACTORY_ABI,
            functionName: 'feeAmountTickSpacing',
            args: [fee],
          })
        )
      );

      results.forEach((spacing, i) => {
        expect(spacing).toBe(expectedSpacing[i]);
      });
    });
  });

  describe('Quote Operations', () => {
    it('should get quote for WETH -> DUCK swap', async () => {
      const amountIn = parseEther('0.01'); // 0.01 ETH

      // QuoterV2.quoteExactInputSingle uses eth_call (simulated, not a real tx)
      const result = await client.simulateContract({
        address: network.contracts.QuoterV2 as Address,
        abi: QUOTER_V2_ABI,
        functionName: 'quoteExactInputSingle',
        args: [
          {
            tokenIn: duckWethPool.token1 as Address, // WETH
            tokenOut: duckWethPool.token0 as Address, // DUCK
            amountIn,
            fee: duckWethPool.fee,
            sqrtPriceLimitX96: 0n,
          },
        ],
      });

      expect(result.result).toBeDefined();
      const [amountOut, sqrtPriceX96After, initializedTicksCrossed, gasEstimate] = result.result as [bigint, bigint, number, bigint];
      expect(amountOut).toBeGreaterThan(0n);
      expect(sqrtPriceX96After).toBeGreaterThan(0n);
      expect(gasEstimate).toBeGreaterThan(0n);
    });

    it('should get quote for DUCK -> WETH swap', async () => {
      const amountIn = parseEther('1000'); // 1000 DUCK

      const result = await client.simulateContract({
        address: network.contracts.QuoterV2 as Address,
        abi: QUOTER_V2_ABI,
        functionName: 'quoteExactInputSingle',
        args: [
          {
            tokenIn: duckWethPool.token0 as Address, // DUCK
            tokenOut: duckWethPool.token1 as Address, // WETH
            amountIn,
            fee: duckWethPool.fee,
            sqrtPriceLimitX96: 0n,
          },
        ],
      });

      expect(result.result).toBeDefined();
      const [amountOut] = result.result as [bigint, ...unknown[]];
      expect(amountOut).toBeGreaterThan(0n);
    });
  });

  describe('Token Reads', () => {
    it('should read WETH token details', async () => {
      const [symbol, decimals, totalSupply] = await Promise.all([
        client.readContract({
          address: network.tokens.WETH as Address,
          abi: ERC20_ABI,
          functionName: 'symbol',
        }),
        client.readContract({
          address: network.tokens.WETH as Address,
          abi: ERC20_ABI,
          functionName: 'decimals',
        }),
        client.readContract({
          address: network.tokens.WETH as Address,
          abi: ERC20_ABI,
          functionName: 'totalSupply',
        }),
      ]);

      expect(symbol).toBe('WETH');
      expect(decimals).toBe(18);
      expect(totalSupply).toBeGreaterThan(0n);
    });

    it('should read DUCK token details', async () => {
      const [symbol, decimals] = await Promise.all([
        client.readContract({
          address: network.tokens.DUCK as Address,
          abi: ERC20_ABI,
          functionName: 'symbol',
        }),
        client.readContract({
          address: network.tokens.DUCK as Address,
          abi: ERC20_ABI,
          functionName: 'decimals',
        }),
      ]);

      expect(symbol).toBe('DUCK');
      expect(decimals).toBe(18);
    });
  });

  describe('Multicall Operations', () => {
    it('should batch multiple reads via Multicall', async () => {
      const multicallAddress = network.contracts.Multicall as Address;

      const result = await client.readContract({
        address: multicallAddress,
        abi: MULTICALL_ABI,
        functionName: 'getCurrentBlockTimestamp',
      });

      expect(result).toBeGreaterThan(0n);
    });

    it('should get ETH balance via Multicall', async () => {
      const multicallAddress = network.contracts.Multicall as Address;

      const balance = await client.readContract({
        address: multicallAddress,
        abi: MULTICALL_ABI,
        functionName: 'getEthBalance',
        args: [network.contracts.UniswapV3Factory as Address],
      });

      expect(typeof balance).toBe('bigint');
    });
  });

  describe('Concurrent Reads (Simulates Frontend Load)', () => {
    it('should handle 10 concurrent pool state reads', async () => {
      const reads = Array(10).fill(null).map(() =>
        client.readContract({
          address: duckWethPool.address as Address,
          abi: UNISWAP_V3_POOL_ABI,
          functionName: 'slot0',
        })
      );

      const results = await Promise.all(reads);
      expect(results).toHaveLength(10);
      results.forEach((result) => {
        expect(result).toBeDefined();
      });
    });

    it('should handle 20 concurrent mixed reads', async () => {
      const reads = [
        // Pool reads
        ...Array(5).fill(null).map(() =>
          client.readContract({
            address: duckWethPool.address as Address,
            abi: UNISWAP_V3_POOL_ABI,
            functionName: 'slot0',
          })
        ),
        // Liquidity reads
        ...Array(5).fill(null).map(() =>
          client.readContract({
            address: duckWethPool.address as Address,
            abi: UNISWAP_V3_POOL_ABI,
            functionName: 'liquidity',
          })
        ),
        // Token reads
        ...Array(5).fill(null).map(() =>
          client.readContract({
            address: network.tokens.WETH as Address,
            abi: ERC20_ABI,
            functionName: 'symbol',
          })
        ),
        // Factory reads
        ...Array(5).fill(null).map(() =>
          client.readContract({
            address: network.contracts.UniswapV3Factory as Address,
            abi: UNISWAP_V3_FACTORY_ABI,
            functionName: 'feeAmountTickSpacing',
            args: [3000],
          })
        ),
      ];

      const results = await Promise.all(reads);
      expect(results).toHaveLength(20);
      results.forEach((result) => {
        expect(result).toBeDefined();
      });
    });

    it('should handle 50 concurrent quote requests', async () => {
      const amountIn = parseEther('0.001');

      const quotes = Array(50).fill(null).map(() =>
        client.simulateContract({
          address: network.contracts.QuoterV2 as Address,
          abi: QUOTER_V2_ABI,
          functionName: 'quoteExactInputSingle',
          args: [
            {
              tokenIn: duckWethPool.token1 as Address,
              tokenOut: duckWethPool.token0 as Address,
              amountIn,
              fee: duckWethPool.fee,
              sqrtPriceLimitX96: 0n,
            },
          ],
        })
      );

      const results = await Promise.all(quotes);
      expect(results).toHaveLength(50);
      results.forEach((result) => {
        expect(result.result).toBeDefined();
      });
    });
  });
});
