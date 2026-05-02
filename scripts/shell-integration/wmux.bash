# wmux OSC 133 shell integration for bash.

if [[ -n "${WMUX_SHELL_INTEGRATION:-}" ]]; then
  return 0 2>/dev/null || exit 0
fi
export WMUX_SHELL_INTEGRATION=1

__wmux_original_prompt_command=${PROMPT_COMMAND:-}
__wmux_prompt_started=0

__wmux_osc133_prompt_command() {
  local exit_code=$?
  if [[ "$__wmux_prompt_started" == "1" ]]; then
    printf '\033]133;D;%s\007' "$exit_code"
  fi
  __wmux_prompt_started=1
  if [[ -n "$__wmux_original_prompt_command" ]]; then
    eval "$__wmux_original_prompt_command"
  fi
  return "$exit_code"
}

PROMPT_COMMAND=__wmux_osc133_prompt_command
PS0=$'\033]133;C\007'
PS1=$'\033]133;A\007'"${PS1:-\\$ }"$'\033]133;B\007'
