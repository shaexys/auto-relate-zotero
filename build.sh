#!/bin/bash
# Build the Zotero Auto-Relate plugin .xpi
cd "$(dirname "$0")" && rm -f ../auto-relate@shae.dev.xpi && zip -r ../auto-relate@shae.dev.xpi manifest.json bootstrap.js chrome/ && echo "Built: auto-relate@shae.dev.xpi"
