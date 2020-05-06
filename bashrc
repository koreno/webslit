# ~/.bashrc: executed by bash(1) for non-login shells.

export LS_OPTIONS='--color=auto'
eval "`dircolors -b`"
alias ls='ls $LS_OPTIONS'
alias ll='ls $LS_OPTIONS -l'
alias l='ls $LS_OPTIONS -lA'

echo
echo "WebSlit Shell"
echo