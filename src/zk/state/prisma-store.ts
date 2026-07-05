/**
 * Prisma-backed StateStore — persists confidential account state in the database
 * so it survives Railway redeploys, process restarts, and horizontal scaling.
 *
 * The JSON file store (json-store.ts) is ephemeral on Railway (filesystem is
 * wiped on every deploy). This store uses the `ConfidentialState` Prisma model
 * keyed by the same `stateKey` hash that `getStateStore()` in confidential_token.ts
 * computes, so the two are interchangeable without any migration of existing data
 * (existing file-based state will just be re-synced from the RPC on first request).
 */

import { PrismaClient } from "@prisma/client";
import { type StateStore, bigintReplacer, reviveState } from "./store.js";
import type { AccountState } from "./types.js";

export class PrismaStateStore implements StateStore {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly stateKey: string,
  ) {}

  async load(address: string): Promise<AccountState | null> {
    const row = await this.prisma.confidentialState.findUnique({
      where: { stateKey: this.stateKey },
    });
    if (!row) return null;
    try {
      const raw = JSON.parse(row.stateJson) as Record<string, unknown>;
      // Double-check address matches (safety guard against key collisions)
      if (raw.address !== address) return null;
      return reviveState(raw);
    } catch {
      return null;
    }
  }

  async save(state: AccountState): Promise<void> {
    const stateJson = JSON.stringify(state, bigintReplacer);
    await this.prisma.confidentialState.upsert({
      where: { stateKey: this.stateKey },
      update: { stateJson },
      create: { stateKey: this.stateKey, stateJson },
    });
  }
}
