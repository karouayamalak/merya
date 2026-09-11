/**
 * Deprecated alias for 58 Wilayas normalization.
 * Redirects to normalize58Wilayas to ensure safety and prevent 69-wilaya regressions.
 */
import { normalize58Wilayas } from './normalize58Wilayas.js';

export async function migrate69Wilayas() {
  console.log('[Notice] migrate69Wilayas called — safely delegating to normalize58Wilayas for the canonical 58-Wilaya system.');
  return normalize58Wilayas();
}

export { normalize58Wilayas };
