import {
  DAY,
  fingerprint,
  normalizeOpenAlexID,
  type Candidate,
  type Identity,
  type Lookup,
  type Provider,
  type RecordEntry,
  type Result,
} from "./core.js";

function validResult(value: unknown): value is Result {
  if (!value || typeof value !== "object") return false;
  const r = value as Result;
  return (
    Number.isSafeInteger(r.count) &&
    r.count >= 0 &&
    ["openalex", "manual"].includes(r.source) &&
    ["doi", "title", "confirmed", "manual"].includes(r.matchedBy) &&
    typeof r.paperID === "string" &&
    typeof r.url === "string" &&
    Number.isFinite(r.updatedAt) &&
    Number.isFinite(new Date(r.updatedAt).getTime()) &&
    r.updatedAt >= 0
  );
}

export function parseCache(raw: string): Map<string, RecordEntry> {
  const entries = new Map<string, RecordEntry>();
  try {
    const store = JSON.parse(raw);
    if (
      ![1, 2].includes(store.version) ||
      !store.items ||
      typeof store.items !== "object"
    )
      return entries;
    for (const [key, value] of Object.entries(store.items)) {
      const e = value as RecordEntry;
      if (
        !e ||
        typeof e.identity !== "string" ||
        !["ok", "not-found", "ambiguous", "error"].includes(e.status) ||
        !Number.isFinite(e.checkedAt) ||
        !Number.isFinite(e.retryAt) ||
        !Number.isFinite(new Date(e.checkedAt).getTime()) ||
        !Number.isFinite(new Date(e.retryAt).getTime()) ||
        e.checkedAt < 0 ||
        e.retryAt < 0 ||
        (e.result !== undefined && !validResult(e.result)) ||
        (e.status === "ok" && !e.result) ||
        (e.error !== undefined && typeof e.error !== "string")
      )
        continue;
      if (e.boundPaperID !== undefined && !normalizeOpenAlexID(e.boundPaperID))
        continue;
      if (e.detail !== undefined && typeof e.detail !== "string") continue;
      // Re-query misses from the older matcher.
      if (
        store.version === 1 &&
        ["not-found", "ambiguous"].includes(e.status) &&
        !e.result
      )
        continue;
      // Refresh candidate previews on demand.
      delete e.candidates;
      // Keep OpenAlex results when discarding a retired provider's failure.
      if (
        e.error?.includes("semantic-scholar") &&
        e.result?.source !== "manual"
      ) {
        if (!e.result) continue;
        entries.set(key, { ...e, status: "ok", retryAt: 0, error: undefined });
      } else entries.set(key, e);
    }
  } catch {
    // Ignore damaged cache.
  }
  return entries;
}

export class CitationService {
  private entries = new Map<string, RecordEntry>();
  private pending = new Map<
    string,
    { identity: string; promise: Promise<void> }
  >();
  private generations = new Map<string, number>();
  private tail: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(
    private options: {
      provider: Provider;
      now: () => number;
      ttl: () => number;
      changed: (key: string) => void;
    },
  ) {}

  load(raw: string) {
    this.entries = parseCache(raw);
  }
  serialize(): string {
    return JSON.stringify({
      version: 2,
      items: Object.fromEntries(this.entries),
    });
  }
  get(identity: Identity): RecordEntry | undefined {
    const entry = this.entries.get(identity.key);
    return entry?.identity === fingerprint(identity) ? entry : undefined;
  }
  isPending(identity: Identity): boolean {
    return this.pending.get(identity.key)?.identity === fingerprint(identity);
  }
  isStale(entry: RecordEntry): boolean {
    return (
      entry.result?.source !== "manual" &&
      (!entry.result ||
        this.options.now() - entry.result.updatedAt >= this.options.ttl())
    );
  }

  refresh(identity: Identity, force = false): Promise<void> {
    if (this.closed) return Promise.resolve();
    const signature = fingerprint(identity);
    const entry = this.get(identity);
    if (entry?.result?.source === "manual") return Promise.resolve();
    if (
      !force &&
      entry &&
      this.options.now() < entry.retryAt &&
      (entry.status !== "ok" || !this.isStale(entry))
    )
      return Promise.resolve();
    const existing = this.pending.get(identity.key);
    if (existing?.identity === signature) return existing.promise;
    // Limit work queued by column rendering.
    if (!force && this.pending.size >= 200) return Promise.resolve();
    const generation = (this.generations.get(identity.key) || 0) + 1;
    this.generations.set(identity.key, generation);
    const work = this.tail
      .then(async () => {
        if (this.closed || this.generations.get(identity.key) !== generation)
          return;
        let next: RecordEntry;
        try {
          const response = await this.options.provider.lookup(
            identity,
            entry?.boundPaperID,
          );
          const now = this.options.now();
          next = {
            identity: signature,
            status: response.status,
            checkedAt: now,
            retryAt:
              now + (response.status === "ok" ? this.options.ttl() : DAY),
            result: response.result
              ? { ...response.result, updatedAt: now }
              : entry?.result,
            detail: response.detail,
            candidates: response.candidates,
            boundPaperID: entry?.boundPaperID,
          };
        } catch (error) {
          const now = this.options.now();
          next = {
            identity: signature,
            status: "error",
            checkedAt: now,
            retryAt: now + 15 * 60_000,
            result: entry?.result,
            error: error instanceof Error ? error.message : "查询失败",
            candidates: entry?.candidates,
            boundPaperID: entry?.boundPaperID,
            detail: entry?.detail,
          };
        }
        if (this.closed || this.generations.get(identity.key) !== generation)
          return;
        this.entries.set(identity.key, next);
        this.options.changed(identity.key);
      })
      .finally(() => {
        if (this.pending.get(identity.key)?.promise === work)
          this.pending.delete(identity.key);
      });
    this.pending.set(identity.key, { identity: signature, promise: work });
    this.tail = work.catch(() => {});
    return work;
  }

  setManual(identity: Identity, count: number): void {
    if (!Number.isSafeInteger(count) || count < 0)
      throw new Error("请输入非负整数");
    this.invalidate(identity.key);
    const now = this.options.now();
    this.entries.set(identity.key, {
      identity: fingerprint(identity),
      status: "ok",
      checkedAt: now,
      retryAt: now,
      result: {
        count,
        source: "manual",
        paperID: "",
        url: "",
        matchedBy: "manual",
        updatedAt: now,
      },
    });
    this.options.changed(identity.key);
  }

  /** Search without replacing the displayed result. */
  findCandidates(identity: Identity): Promise<Lookup> {
    const work = this.tail.then(async () => {
      if (this.closed) throw new Error("查询已停止");
      return this.options.provider.lookup(identity);
    });
    this.tail = work.then(
      () => {},
      () => {},
    );
    return work;
  }

  confirmCandidate(identity: Identity, candidate: Candidate): void {
    const paperID = normalizeOpenAlexID(candidate.id);
    if (
      this.closed ||
      !paperID ||
      !Number.isSafeInteger(candidate.count) ||
      candidate.count < 0
    )
      throw new Error("候选记录无效");
    this.invalidate(identity.key);
    const now = this.options.now();
    this.entries.set(identity.key, {
      identity: fingerprint(identity),
      status: "ok",
      checkedAt: now,
      retryAt: now + this.options.ttl(),
      boundPaperID: paperID,
      result: {
        count: candidate.count,
        source: "openalex",
        paperID,
        url: paperID,
        matchedBy: "confirmed",
        updatedAt: now,
      },
      detail: "已由用户确认论文，后续按 OpenAlex 记录更新",
    });
    this.options.changed(identity.key);
  }

  remove(key: string): void {
    this.invalidate(key);
    this.entries.delete(key);
    this.options.changed(key);
  }
  private invalidate(key: string): void {
    this.generations.set(key, (this.generations.get(key) || 0) + 1);
    this.pending.delete(key);
  }
  cancelPending(): void {
    for (const key of this.pending.keys()) this.invalidate(key);
  }
  stop(): void {
    this.closed = true;
  }
}
