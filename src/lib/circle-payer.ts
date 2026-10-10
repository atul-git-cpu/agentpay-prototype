/**
 * Pays x402 resources with a Circle developer-controlled wallet.
 *
 * The private key never leaves Circle: every payment authorization
 * (EIP-3009, EIP-712 typed data) is signed through Circle's
 * `signTypedData` API, then sent to the seller exactly like Circle's own
 * GatewayClient.pay() does.
 */
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { BatchEvmScheme } from "@circle-fin/x402-batching/client";
import { formatUnits, type Address, type Hex } from "viem";
import { config, CIRCLE_BLOCKCHAIN, ARC_TESTNET_NETWORK } from "./config.js";

export type PaidCall<T> = {
  data: T;
  amountAtomic: bigint;
  amountUsdc: string;
  nonce: string;
  transaction: string;
};

/** JSON.stringify that writes bigint values as strings (Circle expects a JSON string). */
const toJson = (value: unknown) =>
  JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v));

export function createCirclePayer() {
  const circle = initiateDeveloperControlledWalletsClient({
    apiKey: config.circleApiKey(),
    entitySecret: config.circleEntitySecret(),
  });
  const address = config.agentWalletAddress() as Address;

  const scheme = new BatchEvmScheme({
    address,
    async signTypedData({ domain, types, primaryType, message }) {
      const typedData = {
        types: {
          EIP712Domain: [
            { name: "name", type: "string" },
            { name: "version", type: "string" },
            { name: "chainId", type: "uint256" },
            { name: "verifyingContract", type: "address" },
          ],
          ...types,
        },
        // Circle expects chainId as a string (matches Circle's own buyer quickstart).
        domain: { ...domain, chainId: domain.chainId.toString() },
        primaryType,
        message,
      };
      const res = await circle.signTypedData({
        walletAddress: address,
        blockchain: CIRCLE_BLOCKCHAIN,
        data: toJson(typedData),
        memo: "x402 per-call payment",
      });
      const signature = res.data?.signature;
      if (!signature) throw new Error("Circle returned no signature");
      return (signature.startsWith("0x") ? signature : `0x${signature}`) as Hex;
    },
  });

  /** Request a paid URL: 402 -> sign via Circle -> retry with the payment header. */
  async function pay<T>(url: string): Promise<PaidCall<T>> {
    const first = await fetch(url);
    if (first.status !== 402) {
      if (!first.ok) throw new Error(`Request failed with status ${first.status}`);
      return { data: (await first.json()) as T, amountAtomic: 0n, amountUsdc: "0", nonce: "", transaction: "" };
    }

    const header = first.headers.get("PAYMENT-REQUIRED");
    if (!header) throw new Error("402 response is missing the PAYMENT-REQUIRED header");
    const required = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    const option = (required.accepts ?? []).find(
      (o: { network: string; extra?: Record<string, unknown> }) =>
        o.network === ARC_TESTNET_NETWORK &&
        o.extra?.name === "GatewayWalletBatched" &&
        typeof o.extra?.verifyingContract === "string",
    );
    if (!option) throw new Error(`Seller offers no Gateway batching option on ${ARC_TESTNET_NETWORK}`);

    const payload = await scheme.createPaymentPayload(required.x402Version ?? 2, option);
    const paymentHeader = Buffer.from(
      JSON.stringify({ ...payload, resource: required.resource, accepted: option }),
    ).toString("base64");

    const paid = await fetch(url, { headers: { "Payment-Signature": paymentHeader } });
    if (!paid.ok) {
      const body = (await paid.json().catch(() => ({}))) as { error?: string; message?: string };
      throw new Error(`Payment rejected (${paid.status}): ${body.message ?? body.error ?? paid.statusText}`);
    }

    const settleHeader = paid.headers.get("PAYMENT-RESPONSE");
    const settle = settleHeader
      ? (JSON.parse(Buffer.from(settleHeader, "base64").toString("utf8")) as { transaction?: string })
      : {};
    const auth = (payload.payload as { authorization?: { nonce?: string } }).authorization;
    const amountAtomic = BigInt(option.amount);

    return {
      data: (await paid.json()) as T,
      amountAtomic,
      amountUsdc: formatUnits(amountAtomic, 6),
      nonce: auth?.nonce ?? "",
      transaction: settle.transaction ?? "",
    };
  }

  return { address, pay };
}
