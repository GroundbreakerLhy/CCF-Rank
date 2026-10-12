import {
  matchCandidates,
  normalizeDOI,
  normalizeTitle,
  normalizeOpenAlexID,
  type Candidate,
  type Identity,
  type Lookup,
  type Provider,
} from "./core.js";

import { CitationHTTP } from "./http.js";

function object(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("数据源响应格式无效");
  return value as Record<string, any>;
}

function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error("数据源未返回有效被引次数");
  return value;
}

function openAlexCandidate(value: unknown): Candidate {
  const w = object(value);
  if (
    typeof w.id !== "string" ||
    !/^https:\/\/openalex\.org\/W\d+$/.test(w.id) ||
    typeof w.display_name !== "string"
  )
    throw new Error("OpenAlex 响应格式无效");
  return {
    id: w.id,
    doi: typeof w.doi === "string" ? normalizeDOI(w.doi) : undefined,
    title: w.display_name,
    year:
      typeof w.publication_year === "number" ? w.publication_year : undefined,
    authors: Array.isArray(w.authorships)
      ? w.authorships
          .map((a: any) => a?.author?.display_name)
          .filter((a: unknown) => typeof a === "string")
      : [],
    count: count(w.cited_by_count),
    url: w.id,
    venue:
      w.primary_location?.raw_source_name ||
      w.primary_location?.source?.display_name ||
      undefined,
  };
}

export class OpenAlexProvider implements Provider {
  constructor(
    private http: CitationHTTP,
    private settings: () => {
      openAlexKey: string;
    },
  ) {}

  async lookup(identity: Identity, boundPaperID?: string): Promise<Lookup> {
    const source = "openalex";
    const settings = this.settings();
    const base = "https://api.openalex.org/works";
    const fields =
      "select=id,doi,display_name,publication_year,cited_by_count,authorships,primary_location";
    const headers: Record<string, string> = {};
    if (settings.openAlexKey)
      headers.Authorization = `Bearer ${settings.openAlexKey}`;
    const decode = openAlexCandidate;
    const select = (candidates: Candidate[]): Lookup => {
      const match = matchCandidates(identity, candidates);
      return {
        status: match.status,
        detail: match.detail,
        candidates: match.candidates,
        result: match.candidate
          ? {
              count: match.candidate.count,
              source,
              paperID: match.candidate.id,
              url: match.candidate.url,
              matchedBy: match.matchedBy!,
            }
          : undefined,
      };
    };
    if (boundPaperID) {
      const id = normalizeOpenAlexID(boundPaperID);
      if (!id) throw new Error("已确认的 OpenAlex 标识无效");
      const data = await this.http.get(
        source,
        `${base}/${id.split("/").pop()}?${fields}`,
        headers,
      );
      if (!data)
        return {
          status: "not-found",
          detail: "已确认的 OpenAlex 记录不可用，请重新确认论文",
          candidates: [],
        };
      const candidate = decode(data);
      return {
        status: "ok",
        detail: "按人工确认的 OpenAlex 记录更新",
        result: {
          count: candidate.count,
          source,
          paperID: candidate.id,
          url: candidate.url,
          matchedBy: "confirmed",
        },
        candidates: [{ ...candidate, reasons: ["已人工确认的论文"] }],
      };
    }
    if (identity.doi) {
      const id = `https://doi.org/${identity.doi}`;
      const data = await this.http.get(
        source,
        `${base}/${encodeURIComponent(id)}?${fields}`,
        headers,
      );
      if (data) {
        const result = select([decode(data)]);
        if (result.status === "ok") return result;
      }
    }
    const title = normalizeTitle(identity.title);
    if (!title)
      return {
        status: "not-found",
        detail: "条目没有可查询的 DOI 或标题",
        candidates: [],
      };
    let result: Lookup = {
      status: "not-found",
      candidates: [],
      detail: "未检索到标题相符的候选记录",
    };
    // Try a title phrase before widening to title keywords.
    for (const query of [`"${title}"`, title]) {
      const data = await this.http.get(
        source,
        `${base}?search.title=${encodeURIComponent(query)}&per_page=50&${fields}`,
        headers,
      );
      if (!data) continue;
      const response = object(data);
      if (!Array.isArray(response.results))
        throw new Error(`${source} 搜索响应格式无效`);
      result = select(response.results.map(decode));
      const total = response.meta?.count;
      if (
        result.status === "ok" &&
        result.result?.matchedBy === "title" &&
        typeof total === "number" &&
        total > response.results.length
      ) {
        result = {
          status: "ambiguous",
          candidates: result.candidates,
          detail: "搜索结果尚未取全，无法确认唯一性，请人工确认论文",
        };
      }
      if (result.status !== "not-found") return result;
    }
    return result;
  }
}
