// 記事1件に紐づく、利用者へ見せる指摘。
//
// `error`は「このままだとその記事が公開されない見込み」、`warning`は「公開はされるが
// 一部が落ちる・変わる」。**どちらもPushは止めない**（最終的な判定はサーバーが行い、
// `GET /pushes/{pushId}`の結果で確定する）。走査そのものを止めるのは、読み取り失敗や
// path衝突のように**manifestを作ってはいけない**場合だけ（`ScanAbortedError`）。

export type IssueLevel = "error" | "warning";

export interface ArticleIssue {
  level: IssueLevel;
  message: string;
}

/** 同じ文言を1件に畳んで集める。見出しリンクのように何度も出る指摘があるため */
export class IssueCollector {
  private readonly issues: ArticleIssue[] = [];
  private readonly seen = new Set<string>();

  error(message: string): void {
    this.add("error", message);
  }

  warning(message: string): void {
    this.add("warning", message);
  }

  add(level: IssueLevel, message: string): void {
    const key = `${level}\n${message}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.issues.push({ level, message });
  }

  list(): ArticleIssue[] {
    return [...this.issues];
  }

  hasError(): boolean {
    return this.issues.some((issue) => issue.level === "error");
  }
}
