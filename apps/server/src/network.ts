import { networkInterfaces } from "node:os";

/**
 * Host that phones on the same Wi-Fi can reach, for the TV's QR.
 * `LAN_HOST` overrides detection (needed e.g. under WSL2, where the detected IP is the VM's).
 */
export function detectLanHost(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.LAN_HOST) return env.LAN_HOST;
  for (const addresses of Object.values(networkInterfaces())) {
    for (const addr of addresses ?? []) {
      if (addr.family === "IPv4" && !addr.internal) return addr.address;
    }
  }
  return null;
}
