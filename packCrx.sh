#!/bin/bash

EXTENSION_NAME="lamebrowserSynch"

EXTENSION_DIR="."
ZIP_FILE="build/${EXTENSION_NAME}.zip"
CRX_FILE="build/${EXTENSION_NAME}.crx"

PRIVATE_KEY_FILE="privateKey.pem"
PUBLIC_KEY_FILE="publicKey.pem"

rm -Rf build
mkdir -p build

# Step 1: Create the zip file, excluding vendor material and js sources which had been webpacked
zip -r $ZIP_FILE $EXTENSION_DIR/ -x "./node_modules/*" "privateKey.pem" ".gitignore" "eslint.config.mjs" "./.git/*"  "*/.DS_Store" ".DS_Store" "./js/*" "*/build" "pack.sh"

cat $ZIP_FILE | crx3 -p $PRIVATE_KEY_FILE -o $CRX_FILE