import assert from "node:assert/strict";
import { describe, it as nodeIt, type TestContext } from "node:test";

type TestFn<T = TestContext> = (value: T) => void | Promise<void>;

export { describe };

export const it = Object.assign(
  (name: string, fn: TestFn) => nodeIt(name, fn),
  {
    each<T>(cases: readonly T[]) {
      return (name: string, fn: TestFn<T>) => {
        for (const item of cases) {
          nodeIt(name.replace(/%s/g, String(item)), () => fn(item));
        }
      };
    },
  },
);

export function expect(received: unknown) {
  const positive = buildMatchers(received, false);
  return {
    ...positive,
    not: buildMatchers(received, true),
  };
}

expect.arrayContaining = function arrayContaining(items: unknown[]) {
  return { __sc13ArrayContaining: items };
};

function buildMatchers(received: unknown, negate: boolean) {
  const check = (condition: boolean, message: string) => {
    if (negate ? condition : !condition) {
      throw new assert.AssertionError({
        message: negate ? `Expected not: ${message}` : message,
        actual: received,
      });
    }
  };

  return {
    toBe(expected: unknown) {
      check(Object.is(received, expected), `Expected ${formatValue(received)} to be ${formatValue(expected)}`);
    },
    toEqual(expected: unknown) {
      check(matchesExpected(received, expected), `Expected ${formatValue(received)} to equal ${formatValue(expected)}`);
    },
    toMatchObject(expected: unknown) {
      check(matchesSubset(received, expected), `Expected ${formatValue(received)} to match ${formatValue(expected)}`);
    },
    toContain(expected: unknown) {
      const condition =
        typeof received === "string"
          ? received.includes(String(expected))
          : Array.isArray(received)
            ? received.includes(expected)
            : false;
      check(condition, `Expected ${formatValue(received)} to contain ${formatValue(expected)}`);
    },
    toContainEqual(expected: unknown) {
      const condition = Array.isArray(received) && received.some((item) => matchesExpected(item, expected));
      check(condition, `Expected ${formatValue(received)} to contain equal ${formatValue(expected)}`);
    },
    toHaveProperty(key: string) {
      const condition = Boolean(received && typeof received === "object" && key in received);
      check(condition, `Expected object to have property ${key}`);
    },
    toHaveLength(expected: number) {
      const condition =
        (typeof received === "string" || Array.isArray(received)) && received.length === expected;
      check(condition, `Expected ${formatValue(received)} to have length ${expected}`);
    },
    toBeNull() {
      check(received === null, `Expected ${formatValue(received)} to be null`);
    },
    toBeTruthy() {
      check(Boolean(received), `Expected ${formatValue(received)} to be truthy`);
    },
    toBeGreaterThan(expected: number) {
      check(typeof received === "number" && received > expected, `Expected ${formatValue(received)} to be greater than ${expected}`);
    },
    toBeGreaterThanOrEqual(expected: number) {
      check(typeof received === "number" && received >= expected, `Expected ${formatValue(received)} to be >= ${expected}`);
    },
    toBeLessThanOrEqual(expected: number) {
      check(typeof received === "number" && received <= expected, `Expected ${formatValue(received)} to be <= ${expected}`);
    },
    toMatch(expected: RegExp) {
      check(typeof received === "string" && expected.test(received), `Expected ${formatValue(received)} to match ${expected}`);
    },
  };
}

function matchesExpected(received: unknown, expected: unknown): boolean {
  if (isArrayContaining(expected)) {
    return Array.isArray(received) && expected.__sc13ArrayContaining.every((item) => received.some((value) => matchesExpected(value, item)));
  }

  try {
    assert.deepEqual(received, expected);
    return true;
  } catch {
    return false;
  }
}

function matchesSubset(received: unknown, expected: unknown): boolean {
  if (isArrayContaining(expected)) return matchesExpected(received, expected);
  if (Array.isArray(expected)) {
    return (
      Array.isArray(received) &&
      expected.length <= received.length &&
      expected.every((item, index) => matchesSubset(received[index], item))
    );
  }
  if (!expected || typeof expected !== "object") return matchesExpected(received, expected);
  if (!received || typeof received !== "object") return false;

  const actualRecord = received as Record<string, unknown>;
  for (const [key, value] of Object.entries(expected as Record<string, unknown>)) {
    if (!(key in actualRecord) || !matchesSubset(actualRecord[key], value)) return false;
  }
  return true;
}

function isArrayContaining(value: unknown): value is { __sc13ArrayContaining: unknown[] } {
  return Boolean(value && typeof value === "object" && Array.isArray((value as Record<string, unknown>).__sc13ArrayContaining));
}

function formatValue(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
