import type { QueryId } from "@myaaaaa_chan/db-viewer-core";
import { CancelTimeoutError } from "./errors";

// 実行の段階。中断が DB に届くのは running の間だけ（R5）。pid が分かるのも running のときだけにして、
// pid のない running を作れないようにする。
// - preparing: 接続を待っている間と、BEGIN などの準備の間。まだ文を送っていないので、DB には何も送らない
// - running: 利用者の文を送ってから、結果が返るまで
// - finishing: 結果が返った後。この後の COMMIT / ROLLBACK や、同じ接続で次に始まるクエリを止めてはいけない
type Stage =
  | { readonly phase: "preparing" }
  | { readonly phase: "running"; readonly pid: number }
  | { readonly phase: "finishing" };

type Entry = {
  stage: Stage;
  cancelRequested: boolean;
  delivery: Promise<boolean> | null;
  // 中断の依頼が時間内に終わらなかった。後から DB に届くかもしれない
  abandoned: boolean;
  // 準備の間に中断が来たことを、接続を待っている側に知らせる
  signalPreparingCancel: () => void;
};

export type InFlightRequest = {
  /** 準備の間（接続を待っている間を含む）に中断が来たら、解決する。 */
  readonly whenCancelRequested: Promise<void>;
  /**
   * 利用者の文を送る直前に呼ぶ。pid は、その文を流す接続の backend pid。
   * 準備の間に中断が来ていたら "cancelled" で、文は送らない。
   */
  readonly startStatement: (pid: number) => "go" | "cancelled";
  /**
   * 結果が返ったら（失敗でも）呼ぶ。届けている最中の中断があれば、DB への依頼が終わるまで待つ。
   * 呼び出し側は、これが終わるまで COMMIT / ROLLBACK も、接続を Pool に戻すこともしない。
   * "abandoned" は、依頼が時間内に終わらず、後から届くかもしれないこと。その接続は Pool に戻さず捨てる
   * （戻すと、次に始まる別のクエリを止めうる）。
   */
  readonly finishStatement: () => Promise<"clean" | "abandoned">;
  /** DB が受け付けた中断の依頼があるか。57014 を cancelled にするかの根拠。finishStatement の後に読む。 */
  readonly cancelRequested: () => boolean;
  /** 最後に必ず呼ぶ。 */
  readonly end: () => void;
};

export type InFlightOptions = {
  // 中断の依頼を DB に届ける接続が使えないとき（max_connections の枯渇、経路の断）に、待つのをやめる時間
  readonly deliveryTimeoutMs: number;
};

/**
 * queryId と、そのクエリを流している接続の backend pid を組にして覚える（03 §4 中断、ADR 002 §5）。
 * 中断の対象は、段階が running の間だけ。終わったクエリの pid に依頼を送ると、同じ接続で次に始まった
 * 別のクエリを止めてしまうため（R5）。
 *
 * DB への依頼の送り方は deliver に任せる（Pool を通さない接続で pg_cancel_backend を呼ぶ）。
 */
export const createInFlightRegistry = (
  deliver: (pid: number) => Promise<boolean>,
  options: InFlightOptions,
) => {
  const entries = new Map<QueryId, Entry>();

  const deliverWithinTimeout = (entry: Entry, pid: number): Promise<boolean> =>
    new Promise<boolean>((resolve, reject) => {
      const timer = setTimeout(() => {
        entry.abandoned = true;
        reject(new CancelTimeoutError());
      }, options.deliveryTimeoutMs);
      deliver(pid).then(
        (delivered) => {
          clearTimeout(timer);
          resolve(delivered);
        },
        (cause: unknown) => {
          clearTimeout(timer);
          reject(cause);
        },
      );
    });

  // 失敗したり、止める対象がなかったりしたら、中断を依頼した印を戻す。やり直せるようにもする。
  const deliverTo = (entry: Entry, pid: number): Promise<boolean> => {
    entry.cancelRequested = true;
    const revert = () => {
      entry.cancelRequested = false;
      entry.delivery = null;
    };
    const delivery = deliverWithinTimeout(entry, pid).then(
      (delivered) => {
        if (!delivered) revert();
        return delivered;
      },
      (cause: unknown) => {
        revert();
        throw cause;
      },
    );
    entry.delivery = delivery;
    return delivery;
  };

  return {
    /** 同じ ID が使用中なら null（取り違えて、別の実行を止めないため）。 */
    begin: (queryId: QueryId): InFlightRequest | null => {
      if (entries.has(queryId)) return null;
      let signalPreparingCancel: () => void = () => {};
      const whenCancelRequested = new Promise<void>((resolve) => {
        signalPreparingCancel = resolve;
      });
      const entry: Entry = {
        stage: { phase: "preparing" },
        cancelRequested: false,
        delivery: null,
        abandoned: false,
        signalPreparingCancel,
      };
      entries.set(queryId, entry);
      return {
        whenCancelRequested,
        startStatement: (pid) => {
          if (entry.cancelRequested) return "cancelled";
          entry.stage = { phase: "running", pid };
          return "go";
        },
        finishStatement: async () => {
          entry.stage = { phase: "finishing" };
          await entry.delivery?.then(
            () => undefined,
            () => undefined,
          );
          return entry.abandoned ? "abandoned" : "clean";
        },
        cancelRequested: () => entry.cancelRequested,
        end: () => {
          if (entries.get(queryId) === entry) entries.delete(queryId);
        },
      };
    },

    cancel: async (queryId: QueryId): Promise<boolean> => {
      const entry = entries.get(queryId);
      if (entry === undefined) return false;
      const { stage } = entry;
      switch (stage.phase) {
        case "finishing":
          return false;
        case "preparing":
          entry.cancelRequested = true;
          entry.signalPreparingCancel();
          return true;
        case "running":
          return entry.delivery ?? deliverTo(entry, stage.pid);
      }
    },
  };
};

export type InFlightRegistry = ReturnType<typeof createInFlightRegistry>;
