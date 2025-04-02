#!/bin/bash

EXTENSION_NAME="lamebrowserSynch"

EXTENSION_DIR="."
ZIP_NAME="build/${EXTENSION_NAME}.zip"
CRX_NAME="build/${EXTENSION_NAME}.crx"

PRIVATE_KEY_FILE="privateKey.pem"
PUBLIC_KEY_FILE="publicKey.pem"

rm -Rf build
mkdir -p build

# Step 1: Create the zip file, excluding vendor material and js sources which had been webpacked
zip -r $ZIP_NAME $EXTENSION_DIR/ -x "./node_modules/*" "privateKey.pem" ".gitignore" "eslint.config.mjs" "./.git/*"  "*/.DS_Store" ".DS_Store" "./js/*" "*/build" "pack.sh"

echo "Generating SHA-1 hash of the zip file"
openssl dgst -sha1 -binary $ZIP_NAME > $ZIP_NAME.hash

echo "Signing the hash"
openssl pkeyutl -sign -inkey $PRIVATE_KEY_FILE -in $ZIP_NAME.hash -out $ZIP_NAME.sig

echo "Verifying the signature"
openssl pkeyutl -verify -in $ZIP_NAME.hash -sigfile $ZIP_NAME.sig -pubin -inkey $PUBLIC_KEY_FILE


openssl rsa -in $PRIVATE_KEY_FILE -pubout -outform DER -out publicKey.der

PUBLIC_KEY_REG=$(openssl rsa -in $PRIVATE_KEY_FILE -pubout)
PUBLIC_KEY_REG_NO_HEADER=$(openssl rsa -in $PRIVATE_KEY_FILE -pubout | sed '1d;$d')

echo "Public key file is:"
cat $PUBLIC_KEY_FILE

echo "Public key as regenerated is:"
echo $PUBLIC_KEY_REG

echo "Public key without header is:"
echo $PUBLIC_KEY_REG_NO_HEADER

# To detect the signatur length, macos and linux use different command (we do not care about M$ here)
# Check the operating system
if [[ "$(uname)" == "Darwin" ]]; then
  # macOS (Darwin)
  SIGNATURE_LENGTH=$(stat -f %z $ZIP_NAME.sig)  # macOS version of stat
  PUBKEY_LENGTH=$(stat -f %z publicKey.der)
else
  # Linux
  SIGNATURE_LENGTH=$(stat -c %s $ZIP_NAME.sig)  # Linux version of stat
  PUBKEY_LENGTH=$(stat -c %z publicKey.der)
fi

echo "Signature length is $SIGNATURE_LENGTH"
echo "Public key length is $PUBKEY_LENGTH"

# convert lengths to little-endian, 4 bytes
PUBKEY_LENGTH_LE=$(printf "%08x" $PUBKEY_LENGTH | sed 's/\(..\)/\1 /g' | awk '{print $4$3$2$1}' | xxd -r -p)
SIG_LENGTH_LE=$(printf "%08x" $SIG_LENGTH | sed 's/\(..\)/\1 /g' | awk '{print $4$3$2$1}' | xxd -r -p)




# From Chromium source:
# A CRX₃ file is a binary file of the following format:
# [4 octets]: "Cr24", a magic number.
# [4 octets]: The version of the *.crx file format used (currently 3).
# [4 octets]: N, little-endian, the length of the header section.
# [N octets]: The header (the binary encoding of a CrxFileHeader).
# [M octets]: The ZIP archive.
# Clients should reject CRX₃ files that contain an N that is too large for the
# client to safely handle in memory.
#




CRX_HEADER="Cr24"
{
#  4 header bytes magic word
  echo -n "$CRX_HEADER"

# CRX version (3 for CRX3 format) - little-endian
  printf '\x03\x00\x00\x00'

 # Public key length (4 bytes, little-endian)
  echo -n "$PUBKEY_LENGTH_LE"

  # Signature length (4 bytes, little-endian)
  echo -n "$SIG_LENGTH_LE"




## Signature length (4 bytes, in little-endian format)
##  printf "%08x" $SIGNATURE_LENGTH | xxd -r -p

# Public key in DER form
  cat publicKey.der
# Zip file
  cat $ZIP_NAME                # .zip file (extension code)
  cat $ZIP_NAME.sig            # signature
} > $CRX_NAME




echo "Generated CRX file: $CRX_NAME"
