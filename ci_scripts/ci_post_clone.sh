#!/bin/sh
set -e

echo "Xcode: $(xcodebuild -version | tr '\n' ' ')"
if [ -x ./scripts/verify.sh ]; then
  ./scripts/verify.sh
fi
