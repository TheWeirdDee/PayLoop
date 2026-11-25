// Thin wrapper around Freighter so the rest of the app never imports the
// wallet SDK directly. All calls are guarded for SSR (window undefined).

import {
  isConnected,
  isAllowed,
  setAllowed,
  getAddress,
  getNetwork,
  signTransaction,
} from "@stellar/freighter-api";
import { config } from "./config";
import { PayLoopError, toPayLoopError } from "./errors";

export type WalletState = {
  installed: boolean;
  address: string | null;
  network: string | null;
};

export async function detectWallet(): Promise<WalletState> {
  if (typeof window === "undefined") {
    return { installed: false, address: null, network: null };
  }
  try {
    const connected = await isConnected();
    if (!connected.isConnected) {
      return { installed: false, address: null, network: null };
    }
    const allowed = await isAllowed();
    if (!allowed.isAllowed) {
      return { installed: true, address: null, network: null };
    }
    const [addr, net] = await Promise.all([getAddress(), getNetwork()]);
    return {
      installed: true,
      address: addr.address || null,
      network: net.network || null,
    };
  } catch {
    return { installed: false, address: null, network: null };
  }
}

export async function connectWallet(): Promise<string> {
  if (typeof window === "undefined") throw new Error("No window");
  const connected = await isConnected();
  if (!connected.isConnected) {
    throw new PayLoopError("WALLET_UNAVAILABLE", {
      message:
        "Freighter wallet not found. Install it from freighter.app to continue.",
    });
  }
  const res = await setAllowed();
  if (!res.isAllowed) {
    throw new PayLoopError("USER_REJECTED", {
      message: "Wallet connection was declined.",
    });
  }
  const addr = await getAddress();
  if (addr.error || !addr.address) {
    throw new PayLoopError("WALLET_UNAVAILABLE", {
      cause: addr.error,
      message:
        "Could not read your wallet address. Unlock Freighter and try again.",
    });
  }
  return addr.address;
}

// Signs a base64 XDR transaction envelope and returns the signed XDR.
export async function signXdr(xdr: string): Promise<string> {
  let res: Awaited<ReturnType<typeof signTransaction>>;
  try {
    res = await signTransaction(xdr, {
      networkPassphrase: config.networkPassphrase,
    });
  } catch (e) {
    throw toPayLoopError(e);
  }
  if (res.error) {
    // Freighter's `error` is an object ({ code, message }), not a string. Passing
    // it to `new Error()` produced "[object Object]". A declined request is
    // { code: -4 }.
    const mapped = toPayLoopError(res.error);
    throw mapped.code === "UNKNOWN"
      ? new PayLoopError("WALLET_UNAVAILABLE", { cause: res.error })
      : mapped;
  }
  return res.signedTxXdr;
}
