# wmux OSC 133 shell integration for zsh.

if [[ -n "${WMUX_SHELL_INTEGRATION:-}" ]]; then
  return 0 2>/dev/null || exit 0
fi
export WMUX_SHELL_INTEGRATION=1

autoload -Uz add-zsh-hook

__wmux_osc133_precmd() {
  local exit_code=$?
  printf '\033]133;D;%s\007' "$exit_code"
  printf '\033]133;A\007'
  printf '\033]133;B\007'
}

__wmux_osc133_preexec() {
  printf '\033]133;C\007'
}

add-zsh-hook precmd __wmux_osc133_precmd
add-zsh-hook preexec __wmux_osc133_preexec
PROMPT=$'\033]133;A\007'"${PROMPT:-%# }"$'\033]133;B\007'
