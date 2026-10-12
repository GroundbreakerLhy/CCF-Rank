export interface HTTPResponse {
  status: number;
  data: unknown;
  retryAfter?: string;
}

type FetchJSON = (
  url: string,
  headers: Record<string, string>,
) => Promise<HTTPResponse>;

export class CitationHTTP {
  private lastStart = -Infinity;
  private cooldown = new Map<string, number>();
  private credentials = new Map<string, string>();

  constructor(
    private fetchJSON: FetchJSON,
    private now: () => number,
    private sleep: (ms: number) => Promise<void>,
    private alive: () => boolean,
  ) {}

  async get(
    source: string,
    url: string,
    headers: Record<string, string>,
  ): Promise<unknown | null> {
    if (!this.alive()) throw new Error("查询已停止");
    // New credentials must not inherit the previous quota cooldown.
    const credential = headers.Authorization || "";
    if (this.credentials.get(source) !== credential) {
      this.credentials.set(source, credential);
      this.cooldown.delete(source);
    }
    if (this.now() < (this.cooldown.get(source) || 0))
      throw new Error(`${source} 暂时不可用，请稍后刷新`);
    for (let attempt = 0; attempt < 2; attempt++) {
      await this.sleep(Math.max(0, this.lastStart + 1100 - this.now()));
      if (!this.alive()) throw new Error("查询已停止");
      this.lastStart = this.now();
      let response: HTTPResponse;
      try {
        response = await this.fetchJSON(url, headers);
      } catch {
        if (attempt === 0) {
          await this.sleep(1100);
          continue;
        }
        this.cooldown.set(source, this.now() + 15_000);
        throw new Error(`${source} 网络错误或响应无效`);
      }
      if (response.status === 404) return null;
      if (response.status === 200) return response.data;
      if (response.status === 429) {
        const seconds = Number(response.retryAfter);
        const date = Date.parse(response.retryAfter || "");
        const delay = Math.max(
          1100,
          Number.isFinite(seconds) && response.retryAfter
            ? seconds * 1000
            : Number.isFinite(date)
              ? date - this.now()
              : 5000,
        );
        this.cooldown.set(source, this.now() + delay);
        if (attempt === 0 && delay <= 30_000) {
          await this.sleep(delay);
          continue;
        }
        throw new Error(`${source} 请求限流，请稍后刷新`);
      }
      if (response.status >= 500 && attempt === 0) {
        await this.sleep(1100);
        continue;
      }
      this.cooldown.set(
        source,
        this.now() + (response.status >= 500 ? 15_000 : 15 * 60_000),
      );
      throw new Error(
        `${source} HTTP ${response.status}${[401, 403].includes(response.status) ? "，请检查 API Key" : ""}`,
      );
    }
    throw new Error(`${source} 查询失败`);
  }
}
