

// Convert a string to ArrayBuffer
function str2ab(str) {const encoder = new TextEncoder(); return encoder.encode(str);}

// Convert ArrayBuffer to string
function ab2str(buffer) {const decoder = new TextDecoder(); return decoder.decode(buffer);}

// Generate a key from a password
async function generateKey(password) {
  const keyMaterial = await crypto.subtle.importKey( "raw",  str2ab(password),  { name: "PBKDF2" },  false,   ["deriveKey"] );
  return crypto.subtle.deriveKey ( { name: "PBKDF2", salt: str2ab("salt"), iterations: 100000, hash: "SHA-256" }, keyMaterial, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}


function arrayBufferToBase64(arrayBuffer) { // Convert binary string to Base64
    const uint8Array = new Uint8Array(arrayBuffer);
    let binaryString = '';
    uint8Array.forEach(byte => {binaryString += String.fromCharCode(byte);});
    return btoa(binaryString); 
}

function base64ToArrayBuffer(base64) {
  const binaryString = atob(base64);
  const length = binaryString.length;
  const arrayBuffer = new ArrayBuffer(length);
  const uint8Array = new Uint8Array(arrayBuffer);
  for (let i = 0; i < length; i++) {uint8Array[i] = binaryString.charCodeAt(i);}
  return arrayBuffer;
}


// Encrypt data with AES-GCM, returns initialization vector and base64 string representation
async function encryptData (password, data) {
  const key = await generateKey(password);
  const iv = crypto.getRandomValues(new Uint8Array(12)); // Initialization vector
  const buffer = await crypto.subtle.encrypt( { name: "AES-GCM", iv }, key, str2ab(data) );
  const encrypted = arrayBufferToBase64 (buffer);
  return { encrypted, iv };
}

// Decrypt data with AES-GCM
async function decryptData (password, encryptedData, iv) {
  const key = await generateKey(password);
  const buffer = base64ToArrayBuffer (encryptedData);
  console.warn ("DECRYPTING ", iv, key, buffer);
  const decrypted = await crypto.subtle.decrypt( { name: "AES-GCM", iv }, key, buffer);
  return ab2str(decrypted);
}

export {encryptData, decryptData};


