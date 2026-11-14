// 技术验证：同一文档的两种编辑视图共享 Markdown 快照历史。
export class DocumentHistory {
  constructor(markdown) {
    this.entries = [{ markdown, caret: 0 }];
    this.index = 0;
    this.lastGroup = null;
    this.lastTime = 0;
  }

  get current() { return this.entries[this.index]; }
  get canUndo() { return this.index > 0; }
  get canRedo() { return this.index < this.entries.length - 1; }
  closeGroup() { this.lastGroup = null; }

  record(markdown, caret = 0, group = null) {
    if (markdown === this.current.markdown) {
      this.current.caret = caret;
      return false;
    }
    const now = Date.now();
    const merge = group !== null && group === this.lastGroup &&
      now - this.lastTime < 600 && !this.canRedo && this.index > 0;
    this.entries.splice(this.index + 1);
    if (merge) this.entries[this.index] = { markdown, caret };
    else {
      this.entries.push({ markdown, caret });
      this.index++;
    }
    this.lastGroup = group;
    this.lastTime = now;
    return true;
  }

  undo() {
    this.closeGroup();
    if (this.canUndo) this.index--;
    return this.current;
  }

  redo() {
    this.closeGroup();
    if (this.canRedo) this.index++;
    return this.current;
  }
}
