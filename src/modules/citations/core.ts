export type Source = "openalex" | "manual";
export type Status = "ok" | "not-found" | "ambiguous" | "error";

export interface Identity {
  key: string;
  doi?: string;
  title: string;
  year?: number;
  author?: string;
}

export interface Candidate {
  id: string;
  doi?: string;
  title: string;
  year?: number;
  authors: string[];
  count: number;
  url: string;
  venue?: string;
}

export interface ReviewCandidate extends Candidate {
  reasons: string[];
}

export interface Result {
  count: number;
  source: Source;
  paperID: string;
  url: string;
  matchedBy: "doi" | "title" | "confirmed" | "manual";
  updatedAt: number;
}

export interface RecordEntry {
  identity: string;
  status: Status;
  checkedAt: number;
  retryAt: number;
  result?: Result;
  error?: string;
  detail?: string;
  candidates?: ReviewCandidate[];
  boundPaperID?: string;
}

export interface Lookup {
  status: Exclude<Status, "error">;
  result?: Omit<Result, "updatedAt">;
  detail?: string;
  candidates?: ReviewCandidate[];
}

export interface Provider {
  lookup(identity: Identity, boundPaperID?: string): Promise<Lookup>;
}

export const DAY = 86_400_000;

/** Zotero sorts custom columns as text. */
export function countSortKey(count: number): string {
  return String(count).padStart(16, "0");
}

export function normalizeDOI(input: string): string | undefined {
  let value = input
    .trim()
    .replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, "");
  try {
    value = decodeURIComponent(value);
  } catch {
    return undefined;
  }
  return /^10\.\d{4,9}\/\S+$/i.test(value) ? value.toLowerCase() : undefined;
}

export function normalizeTitle(input: string): string {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function fingerprint(identity: Identity): string {
  return JSON.stringify([
    identity.doi || "",
    normalizeTitle(identity.title),
    identity.year || null,
    normalizeTitle(identity.author || ""),
  ]);
}

export function normalizeOpenAlexID(input: string): string | undefined {
  if (typeof input !== "string") return undefined;
  const match = input
    .trim()
    .match(/^(?:https:\/\/openalex\.org\/(?:works\/)?)?(W\d+)\/?$/i);
  return match ? `https://openalex.org/${match[1].toUpperCase()}` : undefined;
}

function titleSimilarity(a: string, b: string): number {
  const left = new Set(a.split(" "));
  const right = new Set(b.split(" "));
  const overlap = [...left].filter((word) => right.has(word)).length;
  return (2 * overlap) / Math.max(1, left.size + right.size);
}

export function matchCandidates(
  identity: Identity,
  candidates: Candidate[],
): {
  status: "ok" | "not-found" | "ambiguous";
  candidate?: Candidate;
  matchedBy?: "doi" | "title";
  candidates: ReviewCandidate[];
  detail: string;
} {
  const unique = [...new Map(candidates.map((c) => [c.id, c])).values()];
  const doiMatches = identity.doi
    ? unique.filter((c) => c.doi === identity.doi)
    : [];
  if (doiMatches.length === 1) {
    return {
      status: "ok",
      candidate: doiMatches[0],
      matchedBy: "doi",
      candidates: [{ ...doiMatches[0], reasons: [] }],
      detail: "DOI 精确匹配",
    };
  }
  if (doiMatches.length > 1)
    return {
      status: "ambiguous",
      detail: "同一 DOI 对应多个记录，请确认论文",
      candidates: doiMatches.map((c) => ({
        ...c,
        reasons: ["同一 DOI 对应多个记录"],
      })),
    };
  const title = normalizeTitle(identity.title);
  // Short titles cannot reliably identify a paper.
  if (title.replace(/\s/g, "").length < 12)
    return {
      status: "not-found",
      candidates: [],
      detail: "标题过短，无法可靠识别论文，请补充 DOI",
    };
  const reviewed = unique.flatMap((c) => {
    const candidateTitle = normalizeTitle(c.title);
    const exact = candidateTitle === title;
    if (!exact && titleSimilarity(title, candidateTitle) < 0.75) return [];
    const reasons: string[] = [];
    const doiConflict = Boolean(
      identity.doi && c.doi && c.doi !== identity.doi,
    );
    const yearConflict = Boolean(
      identity.year && c.year && c.year !== identity.year,
    );
    const authorMatches = Boolean(
      identity.author &&
      c.authors.some((a) =>
        ` ${normalizeTitle(a)} `.includes(
          ` ${normalizeTitle(identity.author!)} `,
        ),
      ),
    );
    const authorConflict = Boolean(
      identity.author && c.authors.length && !authorMatches,
    );
    if (!exact) reasons.push("标题存在差异");
    if (doiConflict) reasons.push("DOI 不一致，可能是不同版本或不同论文");
    if (yearConflict)
      reasons.push(`年份不一致（条目 ${identity.year}，候选 ${c.year}）`);
    if (authorConflict) reasons.push("作者不一致");
    if (identity.author && !c.authors.length)
      reasons.push("OpenAlex 作者信息缺失");
    if (identity.year && !c.year) reasons.push("OpenAlex 年份信息缺失");
    const corroborated = Boolean(
      (identity.year && c.year === identity.year) || authorMatches,
    );
    if (!corroborated) reasons.push("缺少可核对的年份或作者信息");
    return [
      {
        candidate: { ...c, reasons },
        auto:
          exact &&
          !doiConflict &&
          !yearConflict &&
          !authorConflict &&
          corroborated,
        exact,
      },
    ];
  });
  const matches = reviewed.filter((c) => c.auto);
  const reviewOptions = reviewed
    .sort((a, b) => Number(b.exact) - Number(a.exact))
    .slice(0, 10)
    .map((c) => c.candidate);
  if (matches.length === 1)
    return {
      status: "ok",
      candidate: matches[0].candidate,
      matchedBy: "title",
      candidates: reviewOptions,
      detail: ["标题及可用元数据一致", ...matches[0].candidate.reasons].join(
        "；",
      ),
    };
  return {
    status: reviewOptions.length ? "ambiguous" : "not-found",
    candidates: reviewOptions,
    detail:
      matches.length > 1
        ? "多个候选符合匹配条件，请确认论文"
        : reviewOptions.length
          ? "找到候选，但元数据不完整或存在差异，请确认论文"
          : "未检索到标题相符的候选记录",
  };
}
