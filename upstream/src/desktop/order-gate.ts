import { useSyncExternalStore } from "react";
import type { VenueId } from "../../../adapters/types.ts";

/**
 * OpenCharts Desktop addition: the questions the order router asks before an
 * order leaves the paper account. `askGate` resolves when the trader answers
 * in <OrderGate>, which renders whichever prompt is current.
 */

export type GateAnswer = "keys" | "paper" | "cancel" | "confirm";

export type GatePrompt =
  | { kind: "missing-key"; venue: VenueId; venueLabel: string; symbol: string; summary: string; keyWord: string }
  | {
      kind: "confirm-real";
      venue: VenueId;
      venueLabel: string;
      symbol: string;
      summary: string;
      lines: Array<[string, string]>;
      testnet: boolean;
    };

interface Pending {
  prompt: GatePrompt;
  resolve: (answer: GateAnswer) => void;
}

let current: Pending | null = null;
const queue: Pending[] = [];
const listeners = new Set<() => void>();
const notify = () => {
  for (const l of [...listeners]) l();
};

/** Show a prompt (after any already open) and wait for the answer. */
export function askGate(prompt: GatePrompt): Promise<GateAnswer> {
  return new Promise((resolve) => {
    queue.push({ prompt, resolve });
    if (!current) {
      current = queue.shift() ?? null;
      notify();
    }
  });
}

/** Answer the open prompt and move on to the next one. */
export function answerGate(answer: GateAnswer): void {
  const done = current;
  current = queue.shift() ?? null;
  notify();
  done?.resolve(answer);
}

export function useGatePrompt(): GatePrompt | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    () => current?.prompt ?? null,
  );
}
