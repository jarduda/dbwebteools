#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
dotnet restore --locked-mode
dotnet build --no-restore -c Release -warnaserror
dotnet test --no-build -c Release --logger trx --results-directory artifacts/test-results
npm --prefix frontend ci
npm --prefix tests/playwright ci
npm --prefix frontend test
npm --prefix frontend run build
dotnet publish backend/DbWeb.Api --no-restore -c Release -o artifacts/api
mkdir -p artifacts/web
cp -R frontend/dist/. artifacts/web/
