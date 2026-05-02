// 终端输出环形缓冲：按 surface id 切片保留近期输出
// 解决 renderer 重挂载（切 surface、调整布局）后 xterm 缓冲清空的问题
// 抽取为纯函数以便单元测试；生产 ptyManager 持有外部 Map 调用此 helper
export const outputBufferMaxBytes = 256 * 1024;
export const outputBufferTrimBytes = 192 * 1024;

export function appendToOutputBuffer(
  state: Map<string, string>,
  id: string,
  chunk: string
): void {
  if (!chunk) {
    return;
  }
  const previous = state.get(id) ?? "";
  const next = previous + chunk;
  if (next.length <= outputBufferMaxBytes) {
    state.set(id, next);
    return;
  }
  // 超阈值：保留尾部 trim 大小，再对齐到下一个换行避免半截 ANSI 序列
  const sliced = next.slice(-outputBufferTrimBytes);
  const newlineIdx = sliced.indexOf("\n");
  state.set(id, newlineIdx >= 0 ? sliced.slice(newlineIdx + 1) : sliced);
}
