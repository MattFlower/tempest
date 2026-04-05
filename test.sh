#!/bin/bash
# test-osc633.sh ‚Äî prompts separated by enough output to see navigation

printf '\e]633;A\e\\'
echo -n '$ ls -la'
printf '\e]633;B\e\\'
printf '\e]633;E;ls -la\e\\'
printf '\e]633;C\e\\'
echo ""
for i in $(seq 1 80); do echo "output line $i from command 1"; done
printf '\e]633;D;0\e\\'

printf '\e]633;A\e\\'
echo -n '$ echo hello'
printf '\e]633;B\e\\'
printf '\e]633;E;echo hello\e\\'
printf '\e]633;C\e\\'
echo ""
for i in $(seq 1 80); do echo "output line $i from command 2"; done
printf '\e]633;D;0\e\\'

printf '\e]633;A\e\\'
echo '$ '
