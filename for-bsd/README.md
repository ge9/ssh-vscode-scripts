# Usage
- prerequisite: bash, Node.js (including npm), Python (for node-gyp used in the build script)
  - `node` has to be in PATH for npm to work correctly
- setup "reverse-socket" component
- create `rg` in this directory (can be copied from `rg.example`)
- put in `.bashrc` or some script called from `command=` in authorized_keys:
  ```
  if [ ! -t 0 ] && [ -n "$SSH_CONNECTION" ] &&
  ([ -z "$SSH_ORIGINAL_COMMAND" ] || [ "$SSH_ORIGINAL_COMMAND" = "sh" ] || [ "$SSH_ORIGINAL_COMMAND" = "bash" ])
  then #VS Code
    export SSH_VSCODE_PREFIX=/path/to/ssh-vscode-scripts
    # useLocalServer=true
    export BASH_ENV=$SSH_VSCODE_PREFIX/for-bsd/bashenv-out
    # useLocalServer=false
    # export BASH_ENV=$SSH_VSCODE_PREFIX/for-bsd/bashenv
    # if node and npm is not in PATH by default
    # export PATH=/path/to/node/usr/local/bin:$PATH
    exec bash
  fi
  ```
