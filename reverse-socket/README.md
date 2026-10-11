# Usage
- in local .ssh/config:
  ```
  Match originalhost my-server1 my-server2 exec "check-ssh"
    RemoteForward /home/%r/ssh-sock 127.0.0.1:4280
    # for VS Code Remote SSH in FreeBSD or Termux
    # RemoteForward /home/%r/ssh-sock2 127.0.0.1:47001

  ```
Note that SSH_VSCODE_SOCK_DIR is not exported.
- in `.ssh/rc`:
  ```shell
  SOCK_PATH=~/.cache/ssh-sock/$(echo $SSH_CONNECTION | sed 's/ /-/g')
  # for servers with shared /home, use this instead
  # SOCK_PATH=~/.ssh/ssh-sock-$hostname/$(echo $SSH_CONNECTION | sed 's/ /-/g')
  mv ~/ssh-sock $SOCK_PATH 2> /dev/null
  # for VS Code Remote SSH in FreeBSD or Termux
  # mv ~/ssh-sock2 $SOCK_PATH-2 2> /dev/null
  ```
- near the beginning of .bashrc etc. (NOT .profile, because it's not used before VS Code Remote SSH starts):
  ```shell
  # for servers with shared /home
  # SSH_VSCODE_SOCK_DIR=~/.ssh/ssh-sock-$hostname
  remote_name=my-server1
  SSH_VSCODE_PREFIX=/path/to/ssh-vscode-scripts
  . $SSH_VSCODE_PREFIX/reverse-socket/client/setup-sockets
  ```
- near the end of .profile etc.:
  ```shell
  SSH_VSCODE_PREFIX=/path/to/ssh-vscode-scripts
  . $SSH_VSCODE_PREFIX/reverse-socket/client/clean-sockets
  # Optionally:
  # if [ -n "$VSCODE_AGENT_FOLDER" ]; then
  # ( ( $SSH_VSCODE_PREFIX/misc/vscode-clean & ) )
  # fi
  ```
