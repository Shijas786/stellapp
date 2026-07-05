/**
 * Key derivation. Unlike the previous design, every key is **contract-bound**:
 * the viewing key folds in `addr_f` (the token contract's address-as-field), so
 * a key set generated for one deployment is meaningless against another.
 *
 *   sk  (random F_r scalar, the only secret)
 *    ├─ vk  = Poseidon2(VIEWING_KEY, sk, addr_f)
 *    ├─ Y   = sk · H        (spending public key)
 *    └─ PVK = vk · H        (public viewing key — others' ECDH target for you)
 */

import { H, scalarMul, type Point } from "./grumpkin.js";
import { vkFromSk } from "./poseidon2.js";
import { randomScalar, toHex32 } from "./field.js";

/** BN254 scalar-field modulus used by the key derivation primitives. */
const FIELD_MODULUS =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

const CANONICAL_HEX_32 = /^0x[0-9a-f]{64}$/;

export interface KeyPair {
  /** Secret spending scalar (the root secret). */
  sk: bigint;
  /** Contract-bound viewing key `vk = Poseidon2(VIEWING_KEY, sk, addr_f)`. */
  vk: bigint;
  /** Spending public key `Y = sk · H`. */
  Y: Point;
  /** Public viewing key `PVK = vk · H`. */
  PVK: Point;
  /** The `addr_f` these keys are bound to. */
  addrF: bigint;
}

export interface SerializedKeyPair {
  sk: string;
  addrF: string;
}

function assertCanonicalFieldElement(
  value: bigint,
  name: string,
  allowZero = true,
): void {
  if (typeof value !== "bigint") {
    throw new TypeError(`${name} must be a bigint`);
  }

  if (value < 0n || value >= FIELD_MODULUS) {
    throw new RangeError(`${name} is not a canonical field element`);
  }

  if (!allowZero && value === 0n) {
    throw new RangeError(`${name} must not be zero`);
  }
}

function parseCanonicalHex32(value: string, name: string): bigint {
  if (typeof value !== "string" || !CANONICAL_HEX_32.test(value)) {
    throw new TypeError(`${name} must be a canonical lowercase 32-byte hex string`);
  }

  const parsed = BigInt(value);
  assertCanonicalFieldElement(parsed, name);

  if (toHex32(parsed) !== value) {
    throw new RangeError(`${name} is not canonically encoded`);
  }

  return parsed;
}

/** Derive the full key set for a given secret and contract `addr_f`. */
export function deriveKeys(sk: bigint, addrF: bigint): KeyPair {
  assertCanonicalFieldElement(sk, "sk", false);
  assertCanonicalFieldElement(addrF, "addrF");

  const vk = vkFromSk(sk, addrF);
  assertCanonicalFieldElement(vk, "vk", false);

  const Y = scalarMul(sk, H);
  const PVK = scalarMul(vk, H);
  return { sk, vk, Y, PVK, addrF };
}

/** Generate a fresh key set bound to `addr_f`. */
export function generateKeys(addrF: bigint): KeyPair {
  assertCanonicalFieldElement(addrF, "addrF");

  for (;;) {
    const sk = randomScalar();

    if (sk === 0n) {
      continue;
    }

    const vk = vkFromSk(sk, addrF);
    assertCanonicalFieldElement(vk, "vk");

    if (vk === 0n) {
      continue;
    }

    const Y = scalarMul(sk, H);
    const PVK = scalarMul(vk, H);
    return { sk, vk, Y, PVK, addrF };
  }
}

/** A key pair is fully determined by `(sk, addr_f)`. */
export function serializeKeys(keys: KeyPair): SerializedKeyPair {
  assertCanonicalFieldElement(keys.sk, "sk", false);
  assertCanonicalFieldElement(keys.addrF, "addrF");

  const vk = vkFromSk(keys.sk, keys.addrF);
  assertCanonicalFieldElement(vk, "vk", false);

  return { sk: toHex32(keys.sk), addrF: toHex32(keys.addrF) };
}

export function deserializeKeys(data: SerializedKeyPair): KeyPair {
  if (data === null || typeof data !== "object") {
    throw new TypeError("Serialized key pair must be an object");
  }

  const sk = parseCanonicalHex32(data.sk, "sk");
  const addrF = parseCanonicalHex32(data.addrF, "addrF");
  return deriveKeys(sk, addrF);
}