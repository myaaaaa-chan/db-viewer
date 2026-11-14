import { afterEach, describe, it } from "vitest";
import { type Limits, resolveLimits } from "../../limits";
import type { SuiteContext } from "./context";
import { executeCases } from "./execute-cases";
import type { AdapterEnvironment, AdapterHarness } from "./harness";
import { metadataCases } from "./metadata-cases";
import { countRowsCases, fetchCellCases, fetchRowsCases } from "./rows-cases";
import { seedStatements } from "./seed";

export type {
  AdapterCase,
  AdapterCaseContext,
  AdapterEnvironment,
  AdapterHarness,
  OpenOptions,
} from "./harness";

/**
 * 方言に依らない、DbAdapter の共通テスト（06_品質と運用 §3）。
 * アダプターごとのテストファイルから、harness を渡して 1 回呼ぶ。
 * 同じ表・同じ値のシードを流し、同じ期待値で確かめる。
 */
export const describeAdapterSuite = (harness: AdapterHarness): void => {
  describe(`DbAdapter 共通テスト: ${harness.name}`, () => {
    const opened: Array<AdapterEnvironment> = [];

    afterEach(async () => {
      await Promise.all(opened.splice(0).map((env) => env.close()));
    });

    const context: SuiteContext = {
      open: async (options = {}) => {
        const env = await harness.open({ readOnly: options.readOnly ?? true });
        opened.push(env);
        for (const statement of seedStatements(harness.dialect)) await env.exec(statement);
        return env;
      },
      limits: (overrides: Partial<Limits> = {}) => resolveLimits(overrides),
    };

    metadataCases(context);
    fetchRowsCases(context);
    countRowsCases(context);
    fetchCellCases(context);
    executeCases(harness, context);

    describe("方言固有", () => {
      const extraCases = harness.extraCases ?? [];
      if (extraCases.length === 0) it.skip("追加のテストなし", () => {});
      for (const extra of extraCases) {
        it(extra.name, () =>
          extra.run({
            dialect: harness.dialect,
            open: context.open,
            limits: context.limits,
          }),
        );
      }
    });
  });
};
