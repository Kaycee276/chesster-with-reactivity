#!/bin/bash
PROJECT=~/Desktop/Desktop/Hackathon/Chesster-copy

tmux new-session -d -s chesster -c "$PROJECT"

# Top pane: nvim
tmux send-keys -t chesster 'nvim .' Enter
sleep 5
tmux send-keys -t chesster C-n

# Bottom-left pane: claude
tmux split-window -v -l 12 -t chesster -c "$PROJECT"
tmux send-keys -t chesster "env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT claude" Enter

# Bottom-right pane: terminal
tmux split-window -h -t chesster -c "$PROJECT"

# Focus top pane
tmux select-pane -t chesster:0.0

# Attach only if running in a terminal
[ -t 1 ] && tmux attach -t chesster
