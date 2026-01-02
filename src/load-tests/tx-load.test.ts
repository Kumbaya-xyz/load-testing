/**
 * Transaction Load Tests for Kumbaya DEX
 *
 * These tests document the transaction patterns that would be used
 * for sequencer load testing. Since actual transactions require
 * funded wallets, these tests demonstrate the transaction encoding
 * and simulate the calls.
 *
 * For actual load testing with transactions:
 * 1. Create test wallets
 * 2. Fund them with ETH and test tokens
 * 3. Run the load scripts in src/scripts/
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createMainnetClient } from '../utils/client.js';
import { MEGAETH_MAINNET } from '../config/addresses.js';
import {
  SWAP_ROUTER_02_ABI,
  QUOTER_V2_ABI,
  NONFUNGIBLE_POSITION_MANAGER_ABI,
  UNIVERSAL_ROUTER_ABI,
  UNIVERSAL_ROUTER_COMMANDS,
} from '../abis/index.js';
import type { PublicClient, Address } from 'viem';
import { parseEther, encodeFunctionData, encodeAbiParameters, concat, toHex } from 'viem';

describe('Transaction Load Tests (Simulation)', () => {
  let client: PublicClient;
  const network = MEGAETH_MAINNET;
  const pool = network.pools['DUCK-WETH-10000'];

  beforeAll(() => {
    client = createMainnetClient();
  });

  describe('Swap Transaction Encoding', () => {
    it('should encode exactInputSingle swap transaction', () => {
      const swapParams = {
        tokenIn: pool.token1 as Address, // WETH
        tokenOut: pool.token0 as Address, // DUCK
        fee: pool.fee,
        recipient: '0x0000000000000000000000000000000000000001' as Address,
        amountIn: parseEther('0.01'),
        amountOutMinimum: 0n,
        sqrtPriceLimitX96: 0n,
      };

      const encoded = encodeFunctionData({
        abi: SWAP_ROUTER_02_ABI,
        functionName: 'exactInputSingle',
        args: [swapParams],
      });

      expect(encoded).toBeDefined();
      expect(encoded.startsWith('0x')).toBe(true);
      // exactInputSingle selector is 0x04e45aaf
      expect(encoded.slice(0, 10)).toBe('0x04e45aaf');
    });

    it('should generate swap calldata for different amounts', () => {
      const amounts = [
        parseEther('0.001'),
        parseEther('0.01'),
        parseEther('0.1'),
        parseEther('1'),
      ];

      const calldatas = amounts.map((amountIn) => {
        return encodeFunctionData({
          abi: SWAP_ROUTER_02_ABI,
          functionName: 'exactInputSingle',
          args: [
            {
              tokenIn: pool.token1 as Address,
              tokenOut: pool.token0 as Address,
              fee: pool.fee,
              recipient: '0x0000000000000000000000000000000000000001' as Address,
              amountIn,
              amountOutMinimum: 0n,
              sqrtPriceLimitX96: 0n,
            },
          ],
        });
      });

      expect(calldatas).toHaveLength(4);
      calldatas.forEach((calldata) => {
        expect(calldata.startsWith('0x04e45aaf')).toBe(true);
      });
    });
  });

  describe('Liquidity Transaction Encoding', () => {
    it('should encode mint (add liquidity) transaction', () => {
      const mintParams = {
        token0: pool.token0 as Address,
        token1: pool.token1 as Address,
        fee: pool.fee,
        tickLower: -887220, // Full range
        tickUpper: 887220,
        amount0Desired: parseEther('1000'), // 1000 DUCK
        amount1Desired: parseEther('0.1'), // 0.1 WETH
        amount0Min: 0n,
        amount1Min: 0n,
        recipient: '0x0000000000000000000000000000000000000001' as Address,
        deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
      };

      const encoded = encodeFunctionData({
        abi: NONFUNGIBLE_POSITION_MANAGER_ABI,
        functionName: 'mint',
        args: [mintParams],
      });

      expect(encoded).toBeDefined();
      expect(encoded.startsWith('0x')).toBe(true);
    });

    it('should encode decreaseLiquidity transaction', () => {
      const decreaseParams = {
        tokenId: 1n,
        liquidity: parseEther('1'),
        amount0Min: 0n,
        amount1Min: 0n,
        deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
      };

      const encoded = encodeFunctionData({
        abi: NONFUNGIBLE_POSITION_MANAGER_ABI,
        functionName: 'decreaseLiquidity',
        args: [decreaseParams],
      });

      expect(encoded).toBeDefined();
      expect(encoded.startsWith('0x')).toBe(true);
    });

    it('should encode collect fees transaction', () => {
      const collectParams = {
        tokenId: 1n,
        recipient: '0x0000000000000000000000000000000000000001' as Address,
        amount0Max: BigInt('0xffffffffffffffffffffffffffffffff'),
        amount1Max: BigInt('0xffffffffffffffffffffffffffffffff'),
      };

      const encoded = encodeFunctionData({
        abi: NONFUNGIBLE_POSITION_MANAGER_ABI,
        functionName: 'collect',
        args: [collectParams],
      });

      expect(encoded).toBeDefined();
      expect(encoded.startsWith('0x')).toBe(true);
    });
  });

  describe('Gas Estimation (via eth_estimateGas)', () => {
    it('should estimate gas for quote call', async () => {
      // QuoterV2 calls use eth_call with gas estimation
      const result = await client.simulateContract({
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

      // The quote result includes gasEstimate
      const [, , , gasEstimate] = result.result as [bigint, bigint, number, bigint];
      expect(gasEstimate).toBeGreaterThan(0n);
      console.log(`Quote gas estimate: ${gasEstimate.toString()}`);
    });
  });

  describe('Router Configuration Reads', () => {
    it('should verify SwapRouter02 configuration', async () => {
      const [weth9, factory] = await Promise.all([
        client.readContract({
          address: network.contracts.SwapRouter02 as Address,
          abi: SWAP_ROUTER_02_ABI,
          functionName: 'WETH9',
        }),
        client.readContract({
          address: network.contracts.SwapRouter02 as Address,
          abi: SWAP_ROUTER_02_ABI,
          functionName: 'factory',
        }),
      ]);

      expect(weth9.toLowerCase()).toBe(network.contracts.WETH9.toLowerCase());
      expect(factory.toLowerCase()).toBe(network.contracts.UniswapV3Factory.toLowerCase());
    });
  });

  describe('Position Reads (for monitoring)', () => {
    it('should read position count for an address', async () => {
      // Use a test address - this may return 0 positions
      const testAddress = '0x0000000000000000000000000000000000000001' as Address;

      const balance = await client.readContract({
        address: network.contracts.NonfungiblePositionManager as Address,
        abi: NONFUNGIBLE_POSITION_MANAGER_ABI,
        functionName: 'balanceOf',
        args: [testAddress],
      });

      expect(typeof balance).toBe('bigint');
    });
  });

  describe('Universal Router Transaction Encoding', () => {
    const MSG_SENDER = '0x0000000000000000000000000000000000000001' as const;
    const ADDRESS_THIS = '0x0000000000000000000000000000000000000002' as const;

    it('should encode V3_SWAP_EXACT_IN command for Universal Router', () => {
      // V3_SWAP_EXACT_IN path format: tokenIn (20 bytes) + fee (3 bytes) + tokenOut (20 bytes)
      const tokenIn = pool.token1; // WETH
      const tokenOut = pool.token0; // DUCK
      const fee = pool.fee;

      // Encode the path: tokenIn + fee + tokenOut
      const path = concat([
        tokenIn as `0x${string}`,
        toHex(fee, { size: 3 }),
        tokenOut as `0x${string}`,
      ]);

      // V3_SWAP_EXACT_IN input: (recipient, amountIn, amountOutMin, path, payerIsUser)
      const swapInput = encodeAbiParameters(
        [
          { type: 'address' }, // recipient
          { type: 'uint256' }, // amountIn
          { type: 'uint256' }, // amountOutMin
          { type: 'bytes' },   // path
          { type: 'bool' },    // payerIsUser
        ],
        [
          MSG_SENDER,           // recipient (use msg.sender constant)
          parseEther('0.01'),   // amountIn
          0n,                   // amountOutMin
          path,                 // path
          true,                 // payerIsUser
        ]
      );

      // Command byte for V3_SWAP_EXACT_IN
      const commands = toHex(new Uint8Array([UNIVERSAL_ROUTER_COMMANDS.V3_SWAP_EXACT_IN]));
      const inputs = [swapInput];
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

      const encoded = encodeFunctionData({
        abi: UNIVERSAL_ROUTER_ABI,
        functionName: 'execute',
        args: [commands, inputs, deadline],
      });

      expect(encoded).toBeDefined();
      expect(encoded.startsWith('0x')).toBe(true);
      // execute(bytes,bytes[],uint256) selector is 0x3593564c
      expect(encoded.slice(0, 10)).toBe('0x3593564c');
    });

    it('should encode WRAP_ETH command for Universal Router', () => {
      // WRAP_ETH input: (recipient, amountMin)
      const wrapInput = encodeAbiParameters(
        [
          { type: 'address' }, // recipient
          { type: 'uint256' }, // amountMin
        ],
        [
          ADDRESS_THIS,        // recipient (router address for subsequent commands)
          parseEther('0.01'),  // amountMin
        ]
      );

      const commands = toHex(new Uint8Array([UNIVERSAL_ROUTER_COMMANDS.WRAP_ETH]));
      const inputs = [wrapInput];
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

      const encoded = encodeFunctionData({
        abi: UNIVERSAL_ROUTER_ABI,
        functionName: 'execute',
        args: [commands, inputs, deadline],
      });

      expect(encoded).toBeDefined();
      expect(encoded.startsWith('0x3593564c')).toBe(true);
    });

    it('should encode multi-command transaction (WRAP + SWAP)', () => {
      const tokenIn = network.contracts.WETH9; // WETH
      const tokenOut = pool.token0; // DUCK
      const fee = pool.fee;
      const amountIn = parseEther('0.01');

      // Path for V3 swap
      const path = concat([
        tokenIn as `0x${string}`,
        toHex(fee, { size: 3 }),
        tokenOut as `0x${string}`,
      ]);

      // Command 1: WRAP_ETH
      const wrapInput = encodeAbiParameters(
        [
          { type: 'address' },
          { type: 'uint256' },
        ],
        [ADDRESS_THIS, amountIn]
      );

      // Command 2: V3_SWAP_EXACT_IN
      const swapInput = encodeAbiParameters(
        [
          { type: 'address' },
          { type: 'uint256' },
          { type: 'uint256' },
          { type: 'bytes' },
          { type: 'bool' },
        ],
        [
          MSG_SENDER,  // recipient
          amountIn,    // amountIn
          0n,          // amountOutMin
          path,        // path
          false,       // payerIsUser (false because router has the WETH from wrap)
        ]
      );

      // Two commands: WRAP_ETH + V3_SWAP_EXACT_IN
      const commands = toHex(new Uint8Array([
        UNIVERSAL_ROUTER_COMMANDS.WRAP_ETH,
        UNIVERSAL_ROUTER_COMMANDS.V3_SWAP_EXACT_IN,
      ]));
      const inputs = [wrapInput, swapInput];
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

      const encoded = encodeFunctionData({
        abi: UNIVERSAL_ROUTER_ABI,
        functionName: 'execute',
        args: [commands, inputs, deadline],
      });

      expect(encoded).toBeDefined();
      expect(encoded.startsWith('0x3593564c')).toBe(true);
      // Verify it's longer than a single command
      expect(encoded.length).toBeGreaterThan(500);
    });

    it('should encode UNWRAP_WETH command for Universal Router', () => {
      // UNWRAP_WETH input: (recipient, amountMin)
      const unwrapInput = encodeAbiParameters(
        [
          { type: 'address' }, // recipient
          { type: 'uint256' }, // amountMin
        ],
        [
          MSG_SENDER,          // recipient
          parseEther('0.01'),  // amountMin
        ]
      );

      const commands = toHex(new Uint8Array([UNIVERSAL_ROUTER_COMMANDS.UNWRAP_WETH]));
      const inputs = [unwrapInput];
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

      const encoded = encodeFunctionData({
        abi: UNIVERSAL_ROUTER_ABI,
        functionName: 'execute',
        args: [commands, inputs, deadline],
      });

      expect(encoded).toBeDefined();
      expect(encoded.startsWith('0x3593564c')).toBe(true);
    });

    it('should generate different Universal Router calldatas for various swap amounts', () => {
      const amounts = [
        parseEther('0.001'),
        parseEther('0.01'),
        parseEther('0.1'),
        parseEther('1'),
      ];

      const tokenIn = pool.token1;
      const tokenOut = pool.token0;
      const path = concat([
        tokenIn as `0x${string}`,
        toHex(pool.fee, { size: 3 }),
        tokenOut as `0x${string}`,
      ]);

      const calldatas = amounts.map((amountIn) => {
        const swapInput = encodeAbiParameters(
          [
            { type: 'address' },
            { type: 'uint256' },
            { type: 'uint256' },
            { type: 'bytes' },
            { type: 'bool' },
          ],
          [MSG_SENDER, amountIn, 0n, path, true]
        );

        return encodeFunctionData({
          abi: UNIVERSAL_ROUTER_ABI,
          functionName: 'execute',
          args: [
            toHex(new Uint8Array([UNIVERSAL_ROUTER_COMMANDS.V3_SWAP_EXACT_IN])),
            [swapInput],
            BigInt(Math.floor(Date.now() / 1000) + 3600),
          ],
        });
      });

      expect(calldatas).toHaveLength(4);
      calldatas.forEach((calldata) => {
        expect(calldata.startsWith('0x3593564c')).toBe(true);
      });

      // Verify calldatas are different (different amounts)
      const uniqueCalldatas = new Set(calldatas);
      expect(uniqueCalldatas.size).toBe(4);
    });
  });
});

/**
 * Documentation: Transaction Load Testing Strategy
 *
 * To perform actual transaction load testing on the sequencer:
 *
 * 1. SWAP TRANSACTIONS
 *    Contract: SwapRouter02 (0xE5BbEF8De2DB447a7432A47EBa58924d94eE470e)
 *    Method: exactInputSingle
 *    Parameters:
 *      - tokenIn: WETH (0x4200000000000000000000000000000000000006)
 *      - tokenOut: DUCK (0x021ee124cF23D302A7f725AE7a01B77A8ce9782B)
 *      - fee: 10000 (1%)
 *      - recipient: sender address
 *      - amountIn: variable (0.001 - 0.1 ETH)
 *      - amountOutMinimum: 0 or calculated from quote
 *      - sqrtPriceLimitX96: 0 (no limit)
 *
 *    For ETH -> Token swaps, send value with the transaction.
 *    For Token -> ETH swaps, approve SwapRouter02 first.
 *
 * 2. LIQUIDITY TRANSACTIONS
 *    Contract: NonfungiblePositionManager (0x2b781C57e6358f64864Ff8EC464a03Fdaf9974bA)
 *
 *    Add Liquidity (mint):
 *      - token0, token1: sorted token addresses
 *      - fee: 10000
 *      - tickLower, tickUpper: -887220 to 887220 for full range
 *      - amount0Desired, amount1Desired: token amounts
 *      - Requires token approvals first
 *
 *    Remove Liquidity (decreaseLiquidity + collect):
 *      - tokenId: position NFT ID
 *      - liquidity: amount to remove
 *
 * 3. LOAD PATTERNS
 *    - Burst: 100 swaps in 1 second
 *    - Sustained: 10 swaps/second for 60 seconds
 *    - Mixed: swaps + liquidity operations
 *
 * 4. METRICS TO COLLECT
 *    - Transaction inclusion time (submit to included in block)
 *    - Transaction confirmation time
 *    - Failed transaction rate
 *    - Gas used vs estimated
 *    - Nonce management issues
 */
