// Combined edge weight (FR-21).
//
//   w = Σ coef[s] · value[s]   over the enabled signals s
//
// where the coefficients of the enabled signals are renormalised to sum to 1,
// so the `minWeight` threshold (FR-22) keeps its meaning while a signal is
// unavailable (no embeddings in M1, no dependencies before M4). `semantic` is
// rescaled from `semanticRange` to [0, 1] (clamped); `mention`, `dependency`
// and `owner` count as 1 when set.

import type { SignalName } from "../../config/graph.config.ts";
import type { EdgeSignals } from "./signals.ts";

export type SignalWeights = Readonly<Record<SignalName, number>>;

export const SIGNAL_NAMES: readonly SignalName[] = [
  "semantic",
  "topic",
  "mention",
  "dependency",
  "owner",
];

/**
 * Coefficients with disabled signals set to 0 and the rest scaled to sum to
 * 1. Throws when no enabled signal has a positive coefficient.
 */
export function renormalizeWeights(
  weights: SignalWeights,
  enabled: Iterable<SignalName>,
): Record<SignalName, number> {
  const on = new Set(enabled);
  let total = 0;
  for (const name of SIGNAL_NAMES) {
    const w = weights[name];
    if (!Number.isFinite(w) || w < 0) {
      throw new Error(`weight for ${name} must be a finite number >= 0`);
    }
    if (on.has(name)) total += w;
  }
  if (total <= 0) {
    throw new Error("no enabled signal has a positive weight");
  }
  const out = {} as Record<SignalName, number>;
  for (const name of SIGNAL_NAMES) {
    out[name] = on.has(name) ? weights[name] / total : 0;
  }
  return out;
}

/** Rescale a raw cosine from `[min, max]` to `[0, 1]`, clamped. */
export function rescaleSemantic(
  cosine: number,
  [min, max]: readonly [number, number],
): number {
  if (!(max > min)) throw new Error("semanticRange must have max > min");
  const t = (cosine - min) / (max - min);
  return Math.min(1, Math.max(0, t));
}

/**
 * Combined weight in [0, 1] from a signal breakdown and renormalised
 * coefficients (see `renormalizeWeights`).
 */
export function combinedWeight(
  signals: EdgeSignals,
  coef: Readonly<Record<SignalName, number>>,
  semanticRange: readonly [number, number],
): number {
  let w = 0;
  if (signals.semantic !== undefined) {
    w += coef.semantic * rescaleSemantic(signals.semantic, semanticRange);
  }
  if (signals.topic !== undefined) w += coef.topic * signals.topic;
  if (signals.mention) w += coef.mention;
  if (signals.dependency) w += coef.dependency;
  if (signals.owner) w += coef.owner;
  return Math.min(1, Math.max(0, w));
}

/** Mention, dependency and manual edges are always kept (FR-22). */
export function isForced(signals: EdgeSignals & { manual?: string }): boolean {
  return (
    signals.mention === true ||
    signals.dependency === true ||
    signals.manual !== undefined
  );
}
