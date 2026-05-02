// 终端"agent 等待用户输入"提示检测：扫描终端最近输出文本，匹配预设
// marker，命中则把语义化 message 写入 workspace.notice 与 recentEvents。
//
// 实现要点：
// - 输入文本可能含 ANSI 控制序列与 \r —— 用 terminalControlSequencePattern
//   去掉 ESC 引导的 CSI/OSC/单字符控制，再把 \r 折成 \n 统一断行
// - 匹配大小写不敏感：marker 全小写，整段先 toLowerCase
// - prompts 顺序代表优先级：第一个命中即返回
//
// marker 文本来自 Claude Code / Codex CLI 的实际 prompt 字面量，更新需要
// 同步实测一次端到端

export type TerminalAttentionPrompt = {
  marker: string;
  message: string;
};

// eslint 默认未启用 no-control-regex；此处直接写 \x1b
const terminalControlSequencePattern =
  /\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/g;

const terminalAttentionPrompts: TerminalAttentionPrompt[] = [
  {
    marker: "would you like to run the following command?",
    message: "Agent is waiting for command approval"
  },
  {
    marker: "press enter to confirm or esc to cancel",
    message: "Agent is waiting for confirmation"
  }
];

export function detectTerminalAttentionPrompt(output: string): TerminalAttentionPrompt | undefined {
  if (!output) {
    return undefined;
  }
  const normalizedOutput = output
    .replace(terminalControlSequencePattern, "")
    .replace(/\r/g, "\n")
    .toLowerCase();
  return terminalAttentionPrompts.find((prompt) => normalizedOutput.includes(prompt.marker));
}

// 仅供单元测试访问：保持封装但避免反射式探查
export const __testing = {
  terminalControlSequencePattern,
  terminalAttentionPrompts
};
