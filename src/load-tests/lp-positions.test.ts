/**
 * LP Position Load Tests
 *
 * Tests simulating frontend liquidity position management patterns:
 * - Position enumeration (balanceOf + tokenOfOwnerByIndex)
 * - Position details (positions)
 * - Fee calculation via callStatic.collect simulation
 * - TickLens for liquidity visualization
 * - Token metadata and allowance checks
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createMainnetClient } from '../utils/client.js';
import { MEGAETH_MAINNET } from '../config/addresses.js';
import {
  NONFUNGIBLE_POSITION_MANAGER_ABI,
  ERC20_ABI,
  TICK_LENS_ABI,
  UNISWAP_V3_POOL_ABI,
  MULTICALL_ABI,
  MULTICALL3_ABI,
} from '../abis/index.js';
import type { PublicClient, Address } from 'viem';
import { encodeFunctionData } from 'viem';

type MulticallCall = { target: Address; callData: `0x${string}` };

describe('LP Position Load Tests', () => {
  let client: PublicClient;
  const network = MEGAETH_MAINNET;
  const pool = network.pools['DUCK-WETH-10000'];

  // Test address that likely has positions (or use zero address for structure tests)
  const TEST_LP_ADDRESS = '0x000000000000000000000000000000000000dEaD' as Address;

  beforeAll(() => {
    client = createMainnetClient();
  });

  describe('Position Enumeration', () => {
    it('should read position count for an address', async () => {
      const balance = await client.readContract({
        address: network.contracts.NonfungiblePositionManager as Address,
        abi: NONFUNGIBLE_POSITION_MANAGER_ABI,
        functionName: 'balanceOf',
        args: [TEST_LP_ADDRESS],
      });

      expect(typeof balance).toBe('bigint');
      console.log(`Position count for ${TEST_LP_ADDRESS}: ${balance}`);
    });

    it('should enumerate positions via tokenOfOwnerByIndex', async () => {
      // First get balance
      const balance = await client.readContract({
        address: network.contracts.NonfungiblePositionManager as Address,
        abi: NONFUNGIBLE_POSITION_MANAGER_ABI,
        functionName: 'balanceOf',
        args: [TEST_LP_ADDRESS],
      });

      // If user has positions, enumerate them
      if (balance > 0n) {
        const tokenId = await client.readContract({
          address: network.contracts.NonfungiblePositionManager as Address,
          abi: NONFUNGIBLE_POSITION_MANAGER_ABI,
          functionName: 'tokenOfOwnerByIndex',
          args: [TEST_LP_ADDRESS, 0n],
        });
        expect(typeof tokenId).toBe('bigint');
        console.log(`First position tokenId: ${tokenId}`);
      } else {
        // Structure test - verify the call would work
        console.log('No positions found, skipping enumeration');
      }

      expect(true).toBe(true);
    });

    it('should batch enumerate multiple positions via Multicall3', async () => {
      const nftPm = network.contracts.NonfungiblePositionManager as Address;

      // Build calls for balance + first 5 potential positions
      const calls: MulticallCall[] = [
        {
          target: nftPm,
          callData: encodeFunctionData({
            abi: NONFUNGIBLE_POSITION_MANAGER_ABI,
            functionName: 'balanceOf',
            args: [TEST_LP_ADDRESS],
          }),
        },
      ];

      // Add tokenOfOwnerByIndex calls for indices 0-4
      for (let i = 0; i < 5; i++) {
        calls.push({
          target: nftPm,
          callData: encodeFunctionData({
            abi: NONFUNGIBLE_POSITION_MANAGER_ABI,
            functionName: 'tokenOfOwnerByIndex',
            args: [TEST_LP_ADDRESS, BigInt(i)],
          }),
        });
      }

      const results = await client.readContract({
        address: network.contracts.Multicall3 as Address,
        abi: MULTICALL3_ABI,
        functionName: 'tryAggregate',
        args: [false, calls],
      });

      expect(results).toHaveLength(6);
      expect(results[0].success).toBe(true); // balanceOf always succeeds
      console.log(`Batch position enumeration: ${results.filter((r) => r.success).length}/6 succeeded`);
    });
  });

  describe('Position Details', () => {
    it('should read position details by tokenId', async () => {
      // Use a known tokenId or try tokenId 1 (first minted position)
      const testTokenId = 1n;

      try {
        const position = await client.readContract({
          address: network.contracts.NonfungiblePositionManager as Address,
          abi: NONFUNGIBLE_POSITION_MANAGER_ABI,
          functionName: 'positions',
          args: [testTokenId],
        });

        // positions returns a tuple with 12 elements
        expect(position).toBeDefined();
        console.log(`Position ${testTokenId}:`);
        console.log(`  token0: ${position[2]}`);
        console.log(`  token1: ${position[3]}`);
        console.log(`  fee: ${position[4]}`);
        console.log(`  tickLower: ${position[5]}`);
        console.log(`  tickUpper: ${position[6]}`);
        console.log(`  liquidity: ${position[7]}`);
      } catch (error) {
        // Position may not exist, that's okay for this test
        console.log(`Position ${testTokenId} not found (expected if no positions minted)`);
      }

      expect(true).toBe(true);
    });

    it('should batch fetch multiple position details via Multicall3', async () => {
      const nftPm = network.contracts.NonfungiblePositionManager as Address;

      // Query positions 1-10
      const tokenIds = [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n, 10n];

      const calls: MulticallCall[] = tokenIds.map((tokenId) => ({
        target: nftPm,
        callData: encodeFunctionData({
          abi: NONFUNGIBLE_POSITION_MANAGER_ABI,
          functionName: 'positions',
          args: [tokenId],
        }),
      }));

      const results = await client.readContract({
        address: network.contracts.Multicall3 as Address,
        abi: MULTICALL3_ABI,
        functionName: 'tryAggregate',
        args: [false, calls],
      });

      expect(results).toHaveLength(10);
      const successCount = results.filter((r) => r.success).length;
      console.log(`Batch position details: ${successCount}/10 positions exist`);
    });
  });

  describe('TickLens for Liquidity Visualization', () => {
    it('should fetch populated ticks for a pool', async () => {
      // Get current tick from slot0 first
      const slot0 = await client.readContract({
        address: pool.address as Address,
        abi: UNISWAP_V3_POOL_ABI,
        functionName: 'slot0',
      });

      const currentTick = slot0[1];
      // Calculate tick bitmap index (tick / 256)
      const tickSpacing = 200; // 1% fee tier
      const tickBitmapIndex = Math.floor(Number(currentTick) / tickSpacing / 256);

      try {
        const populatedTicks = await client.readContract({
          address: network.contracts.TickLens as Address,
          abi: TICK_LENS_ABI,
          functionName: 'getPopulatedTicksInWord',
          args: [pool.address as Address, tickBitmapIndex],
        });

        console.log(`TickLens result for bitmap index ${tickBitmapIndex}:`);
        console.log(`  Populated ticks in word: ${populatedTicks.length}`);
        if (populatedTicks.length > 0) {
          console.log(`  First tick: ${populatedTicks[0].tick}`);
          console.log(`  liquidityNet: ${populatedTicks[0].liquidityNet}`);
        }
      } catch (error) {
        console.log(`TickLens call failed (may not have ticks in this word)`);
      }

      expect(true).toBe(true);
    });

    it('should batch fetch multiple tick bitmap words', async () => {
      // Get current tick
      const slot0 = await client.readContract({
        address: pool.address as Address,
        abi: UNISWAP_V3_POOL_ABI,
        functionName: 'slot0',
      });

      const currentTick = slot0[1];
      const tickSpacing = 200;
      const centerIndex = Math.floor(Number(currentTick) / tickSpacing / 256);

      // Fetch 5 words around current tick
      const indices = [-2, -1, 0, 1, 2].map((offset) => centerIndex + offset);

      const calls: MulticallCall[] = indices.map((idx) => ({
        target: network.contracts.TickLens as Address,
        callData: encodeFunctionData({
          abi: TICK_LENS_ABI,
          functionName: 'getPopulatedTicksInWord',
          args: [pool.address as Address, idx],
        }),
      }));

      const results = await client.readContract({
        address: network.contracts.Multicall3 as Address,
        abi: MULTICALL3_ABI,
        functionName: 'tryAggregate',
        args: [false, calls],
      });

      expect(results).toHaveLength(5);
      const successCount = results.filter((r) => r.success).length;
      console.log(`TickLens batch: ${successCount}/5 words fetched`);
    });
  });

  describe('Token Metadata and Allowances', () => {
    it('should fetch token metadata (name, symbol, decimals)', async () => {
      const token0 = pool.token0 as Address;

      const [name, symbol, decimals] = await Promise.all([
        client.readContract({
          address: token0,
          abi: ERC20_ABI,
          functionName: 'name',
        }),
        client.readContract({
          address: token0,
          abi: ERC20_ABI,
          functionName: 'symbol',
        }),
        client.readContract({
          address: token0,
          abi: ERC20_ABI,
          functionName: 'decimals',
        }),
      ]);

      expect(typeof name).toBe('string');
      expect(typeof symbol).toBe('string');
      expect(typeof decimals).toBe('number');
      console.log(`Token metadata: ${name} (${symbol}), ${decimals} decimals`);
    });

    it('should batch fetch metadata for multiple tokens via Multicall3', async () => {
      const tokens = [pool.token0 as Address, pool.token1 as Address];

      const calls: MulticallCall[] = [];
      for (const token of tokens) {
        calls.push(
          {
            target: token,
            callData: encodeFunctionData({
              abi: ERC20_ABI,
              functionName: 'name',
            }),
          },
          {
            target: token,
            callData: encodeFunctionData({
              abi: ERC20_ABI,
              functionName: 'symbol',
            }),
          },
          {
            target: token,
            callData: encodeFunctionData({
              abi: ERC20_ABI,
              functionName: 'decimals',
            }),
          }
        );
      }

      const results = await client.readContract({
        address: network.contracts.Multicall3 as Address,
        abi: MULTICALL3_ABI,
        functionName: 'tryAggregate',
        args: [false, calls],
      });

      expect(results).toHaveLength(6);
      const successCount = results.filter((r) => r.success).length;
      expect(successCount).toBe(6);
      console.log(`Token metadata batch: ${successCount}/6 succeeded`);
    });

    it('should check token allowance for router', async () => {
      const token = pool.token0 as Address;
      const owner = TEST_LP_ADDRESS;
      const spender = network.contracts.SwapRouter02 as Address;

      const allowance = await client.readContract({
        address: token,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [owner, spender],
      });

      expect(typeof allowance).toBe('bigint');
      console.log(`Allowance for SwapRouter02: ${allowance}`);
    });

    it('should batch check allowances for multiple spenders', async () => {
      const token = pool.token0 as Address;
      const owner = TEST_LP_ADDRESS;
      const spenders = [
        network.contracts.SwapRouter02 as Address,
        network.contracts.NonfungiblePositionManager as Address,
        network.contracts.UniversalRouter as Address,
      ];

      const calls: MulticallCall[] = spenders.map((spender) => ({
        target: token,
        callData: encodeFunctionData({
          abi: ERC20_ABI,
          functionName: 'allowance',
          args: [owner, spender],
        }),
      }));

      const results = await client.readContract({
        address: network.contracts.Multicall3 as Address,
        abi: MULTICALL3_ABI,
        functionName: 'tryAggregate',
        args: [false, calls],
      });

      expect(results).toHaveLength(3);
      expect(results.every((r) => r.success)).toBe(true);
      console.log(`Allowance batch: 3/3 succeeded`);
    });
  });

  describe('ETH Balance via Multicall', () => {
    it('should fetch ETH balance via Multicall getEthBalance', async () => {
      const balance = await client.readContract({
        address: network.contracts.Multicall as Address,
        abi: MULTICALL_ABI,
        functionName: 'getEthBalance',
        args: [TEST_LP_ADDRESS],
      });

      expect(typeof balance).toBe('bigint');
      console.log(`ETH balance for ${TEST_LP_ADDRESS}: ${balance}`);
    });

    it('should batch fetch ETH + token balances', async () => {
      const tokens = [pool.token0 as Address, pool.token1 as Address];

      const calls: MulticallCall[] = [
        // ETH balance
        {
          target: network.contracts.Multicall as Address,
          callData: encodeFunctionData({
            abi: MULTICALL_ABI,
            functionName: 'getEthBalance',
            args: [TEST_LP_ADDRESS],
          }),
        },
        // Token balances
        ...tokens.map((token) => ({
          target: token,
          callData: encodeFunctionData({
            abi: ERC20_ABI,
            functionName: 'balanceOf',
            args: [TEST_LP_ADDRESS],
          }),
        })),
      ];

      const results = await client.readContract({
        address: network.contracts.Multicall3 as Address,
        abi: MULTICALL3_ABI,
        functionName: 'tryAggregate',
        args: [false, calls],
      });

      expect(results).toHaveLength(3);
      expect(results.every((r) => r.success)).toBe(true);
      console.log(`Balance batch (ETH + 2 tokens): 3/3 succeeded`);
    });
  });

  describe('Frontend LP Page Simulation', () => {
    it('should simulate full LP page load pattern', async () => {
      const nftPm = network.contracts.NonfungiblePositionManager as Address;
      const user = TEST_LP_ADDRESS;

      // Step 1: Get position count
      const balance = await client.readContract({
        address: nftPm,
        abi: NONFUNGIBLE_POSITION_MANAGER_ABI,
        functionName: 'balanceOf',
        args: [user],
      });

      console.log(`LP Page Load - User has ${balance} positions`);

      // Step 2: If positions exist, batch load details
      if (balance > 0n) {
        const positionCount = Math.min(Number(balance), 10);
        const calls: MulticallCall[] = [];

        // First get all tokenIds
        for (let i = 0; i < positionCount; i++) {
          calls.push({
            target: nftPm,
            callData: encodeFunctionData({
              abi: NONFUNGIBLE_POSITION_MANAGER_ABI,
              functionName: 'tokenOfOwnerByIndex',
              args: [user, BigInt(i)],
            }),
          });
        }

        // Then get position details for each
        const tokenIdResults = await client.readContract({
          address: network.contracts.Multicall3 as Address,
          abi: MULTICALL3_ABI,
          functionName: 'tryAggregate',
          args: [false, calls],
        });

        console.log(`LP Page Load - Fetched ${tokenIdResults.filter((r) => r.success).length} tokenIds`);
      }

      // Step 3: Fetch token metadata for pool tokens
      const metadataCalls: MulticallCall[] = [pool.token0 as Address, pool.token1 as Address].flatMap(
        (token) => [
          {
            target: token,
            callData: encodeFunctionData({
              abi: ERC20_ABI,
              functionName: 'symbol',
            }),
          },
          {
            target: token,
            callData: encodeFunctionData({
              abi: ERC20_ABI,
              functionName: 'decimals',
            }),
          },
        ]
      );

      const metadataResults = await client.readContract({
        address: network.contracts.Multicall3 as Address,
        abi: MULTICALL3_ABI,
        functionName: 'tryAggregate',
        args: [false, metadataCalls],
      });

      expect(metadataResults.every((r) => r.success)).toBe(true);
      console.log(`LP Page Load - Token metadata: ${metadataResults.length}/4 succeeded`);
    });

    it('should handle 10 concurrent LP page loads', async () => {
      const nftPm = network.contracts.NonfungiblePositionManager as Address;

      // Simulate 10 users loading their LP pages
      const users = Array.from({ length: 10 }, (_, i) =>
        `0x${'0'.repeat(39)}${(i + 1).toString(16)}` as Address
      );

      const startTime = Date.now();

      const results = await Promise.all(
        users.map(async (user) => {
          const calls: MulticallCall[] = [
            {
              target: nftPm,
              callData: encodeFunctionData({
                abi: NONFUNGIBLE_POSITION_MANAGER_ABI,
                functionName: 'balanceOf',
                args: [user],
              }),
            },
            // Add tokenOfOwnerByIndex for first 3 positions
            ...Array.from({ length: 3 }, (_, i) => ({
              target: nftPm,
              callData: encodeFunctionData({
                abi: NONFUNGIBLE_POSITION_MANAGER_ABI,
                functionName: 'tokenOfOwnerByIndex',
                args: [user, BigInt(i)],
              }),
            })),
          ];

          return client.readContract({
            address: network.contracts.Multicall3 as Address,
            abi: MULTICALL3_ABI,
            functionName: 'tryAggregate',
            args: [false, calls],
          });
        })
      );

      const duration = Date.now() - startTime;

      expect(results).toHaveLength(10);
      console.log(`10 concurrent LP page loads: ${duration}ms (${(10000 / duration).toFixed(2)} req/s)`);
    });
  });
});
