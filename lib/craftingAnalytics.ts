/** Count settled valid user edits, not renders, locale changes or every keystroke. */
export class CraftingAnalytics {
  private timer?: ReturnType<typeof setTimeout>;
  private lastSent: string | null = null;
  constructor(private authorized: (token: number | null) => boolean, private send: (token: number) => void, private delay = 800) {}
  cancel(): void { clearTimeout(this.timer); this.timer = undefined; }
  update(signature: string | null, authorization: number | null): void {
    this.cancel();
    if (signature === null || signature === this.lastSent || authorization === null || !this.authorized(authorization)) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (!this.authorized(authorization)) return;
      this.lastSent = signature;
      this.send(authorization);
    }, this.delay);
  }
}
