// 只响应活动文件变化，异步目录结果必须仍匹配当前活动文件才能显示。
export class ActiveFolderFollower {
  constructor({ current, root, load, apply, align, onError }) {
    Object.assign(this, { current, root, load, apply, align, onError });
    this.identity = null; this.sequence = 0; this.pending = null;
  }
  browse() { this.identity = this.current().identity; this.pending = null; return ++this.sequence; }
  follow(force = false) {
    const target = this.current();
    if (!force && target.identity === this.identity) return Promise.resolve();
    this.identity = target.identity;
    if (this.pending?.identity === target.identity) return this.pending.promise;
    const sequence = ++this.sequence;
    if (!target.key) { this.pending = null; return Promise.resolve(); }
    if (target.directory && target.directory === this.root()) {
      this.pending = null; this.align(target, target.directory); return Promise.resolve();
    }
    const pending = { identity: target.identity };
    this.pending = pending;
    pending.promise = Promise.resolve().then(() => this.load(target.key)).then(folder => {
      if (sequence !== this.sequence || this.current().identity !== target.identity) return;
      this.align(target, folder.path); this.apply(folder);
    }).catch(error => {
      if (sequence === this.sequence && this.current().identity === target.identity) this.onError(error);
    }).finally(() => { if (this.pending === pending) this.pending = null; });
    return pending.promise;
  }
}
