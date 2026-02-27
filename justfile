# Load nvm and switch to Node 22
_nvm := 'export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm use 22'

# Run tests (optionally filtered by path)
test *args:
    {{_nvm}} && rtk pnpm vitest run {{args}}

# Build (tsc + post-build scripts)
build:
    {{_nvm}} && rtk pnpm build

# Lint
lint:
    {{_nvm}} && rtk pnpm lint

# Format
format:
    {{_nvm}} && rtk pnpm format
