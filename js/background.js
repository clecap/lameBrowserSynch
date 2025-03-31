// This is the main background worker script

// IMPORTS
import { S3Client, ListBucketsCommand, ListObjectVersionsCommand, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import * as CRYPTO from "./crypto.js";

const USING_CRYPTO = true;

let AES_Password;
let AWS_ACCESS_KEY_ID;
let AWS_SECRET_ACCESS_KEY;
let AWS_DEFAULT_REGION;
let AWS_BUCKETNAME;

let s3Client;

// Get AWS credentials from storage
async function getAwsCredentials () {
  const keys = ["AES_Password", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_DEFAULT_REGION", "AWS_BUCKETNAME"];
  chrome.storage.sync.get(keys, (data) => {
    console.log ("loaded credentials are",data);
    AES_Password          = data.AES_Password;
    AWS_ACCESS_KEY_ID     = data.AWS_ACCESS_KEY_ID;
    AWS_SECRET_ACCESS_KEY = data.AWS_SECRET_ACCESS_KEY;
    AWS_DEFAULT_REGION    = data.AWS_DEFAULT_REGION;
    AWS_BUCKETNAME        = data.AWS_BUCKETNAME;
    s3Client = new S3Client({ region: AWS_DEFAULT_REGION,  credentials: { accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_ACCESS_KEY } });
  });
}

await getAwsCredentials ();

// Listen for all kinds of bookmark changes
chrome.bookmarks.onCreated.addListener ( function(id, bookmark) {
  M.markDirty();
  //console.log(`Bookmark created: id=${id}, bookmark.id=${bookmark.id} title=${bookmark.title}  url=${bookmark.url}`, bookmark);
});

chrome.bookmarks.onRemoved.addListener ( function(id, parentId, index) {
  M.markDirty();
  //console.log('Bookmark removed: id=', id, "parentid=", parentId, "index=", index);
});

chrome.bookmarks.onChanged.addListener (function(id, changeInfo) {
  M.markDirty();
  //console.log('Bookmark changed:', id, changeInfo);
});

chrome.bookmarks.onMoved.addListener (function(id, oldParentId, oldIndex, newParentId, newIndex) {
  M.markDirty();
  //console.log('Bookmark moved:', id, oldParentId, oldIndex, newParentId, newIndex);
});


chrome.bookmarks.onImportEnded.addListener ( function() {
  M.markDirty();
  //console.log('Bookmark import completed');
});


chrome.bookmarks.onChildrenReordered.addListener ( function() {
  M.markDirty();
  //console.log('Bookmark children have been reordered');
});



chrome.runtime.onMessage.addListener( async (message, sender, sendResponse) => {
  // console.log ("got message ", message);
  await getAwsCredentials ();
  switch ( message.action) {
    case "down":            downloadBookmarksFromS3();  break;
    case "up":              uploadBookmarksToS3();      break;
    case "list":            listBookmarksFromS3();      break;
    case "clearBookmarks":  clearBookmarks ();          break;
    case "clearCookies":    clearCookies ();            break;
  }
});

 


let M = (() => {  // functionality for marking synchronoizer clean or dirty

  let enabled = true;
  let numberOfChanges = 0;  // total number of bookmark changes since last upload

  const markDirty = async () => {
    if (!enabled) {return;}  // if not enabled: nothing to do

    numberOfChanges++;
    chrome.action.setBadgeText({ text: "" + numberOfChanges });  // up to 4 characters are shown
    chrome.action.setBadgeBackgroundColor({ color: "red" });
    chrome.action.setIcon({ path: "../media/circle-red.png" });

    await chrome.notifications.create('lameNotification', 
      { type: 'basic', iconUrl: '../media/circle-red.png', title: 'Bookmarks have changed', message: 'Please remember to upload!', priority: 2, requireInteraction: true,
        buttons: [ { title: "Dismiss" },  { title: "Upload" } ]
 }
    );

  chrome.notifications.onClicked.addListener((notificationId, buttonIndex) => {
    if (notificationId === "custom_action") {
      if (buttonIndex === 0) { return; }  // dismiss
      if (buttonindex === 1) { uploadBookmarksToS3();}
  }
});


  };

  const markClean = () => {
    numberOfChanges = 0;
    chrome.action.setBadgeText({ text: "OK" });  // up to 4 characters are shown
    chrome.action.setBadgeBackgroundColor({ color: "green" });
    chrome.action.setIcon({ path: "../media/bookmark.32.png" });
    chrome.notifications.clear('lameNotification');
  };

  const enable = () => {enabled = true};

  const disable = () => {enabled = false};

  return {markDirty, markClean, enable, disable};
})();



async function clearBookmarks () {  console.log ("clearing bookmarks");
  M.disable();
  let bookmarkTree = await chrome.bookmarks.getTree();
  //console.log ("got bookmarks tree ", bookmarkTree);
  const rootFolder = bookmarkTree[0];  // Get the root folder
  //console.log ("root folder is", rootFolder);
  try {
    if (rootFolder.children) { await deleteBookmarksTree(rootFolder.children); }
  } catch (x) { console.error (x);}
  M.enable();
}

function deleteBookmarksTree (bookmarkNodes) {
  return new Promise((resolve, reject) => {
    let promises = [];
    bookmarkNodes.forEach(node => {
      if (node.children) {promises.push ( deleteBookmarksTree(node.children) );}
      if (node.parentId === "0") {  console.warn ("skipping parentid 0"); }
      else {promises.push(deleteBookmark(node.id));}
    });
    Promise.all(promises).then(resolve).catch(reject);
  });
}

function deleteBookmark(bookmarkId) {
  return new Promise((resolve, reject) => {
    chrome.bookmarks.remove(bookmarkId, () => {
      if (chrome.runtime.lastError) {reject(chrome.runtime.lastError);} else {resolve();}
    });
  });
}








async function uploadBookmarksToS3() {
  try {
    let bookmarks = await chrome.bookmarks.getTree ();
    let bText     = JSON.stringify (bookmarks);
    let uploadText;
    if (USING_CRYPTO) {
      let cipher     = await CRYPTO.encryptData (AES_Password, bText);
      console.log ("result from encryption is ", cipher);
      uploadText     = JSON.stringify (cipher);
      console.log ("encrypted upload ", uploadText);
    }
    else { uploadText = bText; }
    uploadStringToS3 (uploadText, "bookmarks-file");
  } catch (error) { console.error("Error syncing bookmarks:", error); }
  M.markClean();
}

async function downloadBookmarksFromS3 () {
  M.disable ();
  let downloadText = await downloadFromS3 ( "bookmarks-file" );
  console.log ("downloaded text from S3 ", downloadText);
  let downloadObj  = JSON.parse (downloadText);
  console.log ("downloaded object from S3", downloadObj);
  let bookmarks;
  if ( Object.hasOwn (downloadObj, "iv") ) {
    console.log ("initialization vector is ", downloadObj.iv, typeof downloadObj.iv, Array.isArray (downloadObj.iv));
    const bufferSource = new Uint8Array( Object.values (downloadObj.iv));            // must convert initialization vector into a buffer source.
    console.log ("initialization vector as bufferSource is ", bufferSource);
    let plainText = await CRYPTO.decryptData ( AES_Password, downloadObj.encrypted, bufferSource );

    console.log ("plaintext is ", plainText);
    bookmarks = JSON.parse (plainText);
  }
  else { bookmarks = downloadObj;}

  console.log ("DOWNLOADED WAS: ", bookmarks);
    bookmarks = bookmarks[0].children;
  console.log ("DOWNSTEP ", bookmarks);
  //installBookmarks (bookmarks);
  for (let kid of bookmarks) {
    if (kid.folderType == 'bookmarks-bar') {installBookmarks (kid.children)}
  }
  M.enable ();
}


async function storeBookmarksToFilesystem () {
  let bookmarks = await chrome.bookmarks.getTree();
  let jsonData  = JSON.stringify(bookmarks, null, 2);

// dataUrl TODO maybe bad idea since size limited - do different
/*
    chrome.downloads.download({
      url: dataUrl,
      filename: "bookmarks.json",
      saveAs: true,
      conflictAction: uniquify,
      headers: [ {name: 'nonce', value: ''}, {name:'sig-nonce', value: ''} ]
    });
*/

}



/*
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === "down") {
//    chrome.runtime.sendMessage({ action: "syncBookmarks" });
  }
});

*/


async function listBookmarksFromS3 () {




}


chrome.action.onClicked.addListener(async (tab) => {
  // console.log ("action clicked");
  try {
  } catch (error) {
    console.error('Error downloading or installing bookmarks:', error);
  }
});


async function installBookmarks (bookmarkData, pid) {  // console.log ("installing bookmarks data", bookmarkData);
  for (const bookmark of bookmarkData) {
    if (bookmark.folderType == "other") { /* console.log ("skipping other"); */ return;}
    if (bookmark.parentId === undefined || bookmark.parentId === "0") {bookmark.parentId = "1";} 
    if (pid !== undefined) {bookmark.parentId = pid;}
    if (bookmark.children) {
      // console.log (`installing node with ${bookmark.children.length} children \ntitle=${bookmark.title}, folderType=${bookmark.folderType}, id=${bookmark.id}, parentId=${bookmark.parentId} url=${bookmark.url}`, bookmark);
      let created;
      try {
        created = await chrome.bookmarks.create( {parentId: bookmark.parentId, title: bookmark.title, url: bookmark.url} ); 
        // console.warn ("CREATED ", created);
      } catch (x) { console.error (x); console.error (`ERROR installing node with ${bookmark.children.length} children \ntitle=${bookmark.title}, folderType=${bookmark.folderType}, id=${bookmark.id}, parentId=${bookmark.parentId} url=${bookmark.url}`, bookmark);     }
      installBookmarks (bookmark.children, created.id);
    }
    else {
      // console.log (`installing leaf node \ntitle=${bookmark.title}, folderType=${bookmark.folderType}, id=${bookmark.id}, parentId=${bookmark.parentId} url=${bookmark.url} `, bookmark);
      try {
        await chrome.bookmarks.create( {parentId: bookmark.parentId, title: bookmark.title, url: bookmark.url} );
      } catch (x) { console.error (x); console.error (`ERROR installing leaf node \ntitle=${bookmark.title}, folderType=${bookmark.folderType}, id=${bookmark.id}, parentId=${bookmark.parentId} url=${bookmark.url} `, bookmark); }
    }
 
  };

// '1' is the ID of the root folder
}




async function uploadStringToS3( txt, filename ) {
  try {
    const data = await s3Client.send( new PutObjectCommand( { Bucket: AWS_BUCKETNAME,  Key: filename, Body: txt, ContentType: 'text/plain' } ) );
    console.log('Successfully uploaded file to S3:', data);
  } catch (err) {
    console.error('Error uploading file to S3:', err);
  }
}


// Function promising to convert a readable stream to a string
const streamToString = (stream) => {
  return new Promise((resolve, reject) => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let done = false;
    let chunks = [];

    // Read the stream data
    function readStream() {
      reader.read().then(({ value, done: isDone }) => {
        if (isDone) {
          done = true;
          resolve(chunks.join(''));
          return;
        }

        // Decode and store the chunk as a string
        chunks.push(decoder.decode(value, { stream: true }));
        if (!done) {readStream();}
      }).catch(reject);
    }

    // Start reading the stream
    readStream();
  });
};


async function downloadFromS3 ( fileName ) {
  let version = await getLatestVersionNumber ( "bookmarks-file" );
  console.log ("latest version number is: ", version);
  let data;
  try {
    data = await s3Client.send(new GetObjectCommand( { Bucket: AWS_BUCKETNAME, Key: fileName, /* VersionId: version, */requestCacheOptions: { cache: "no-store" } } ) ); // Explicitly disable caching ));  // console.log ("data is", data);
    const { Body } = data;  // console.log ("body is", Body);
    const fileContents = await streamToString(Body);
    return fileContents;
  } catch (x) { console.error ("error while downloading"); console.error ( x );  console.error ( data);}
}


async function getLatestVersionNumber (fileName ) {
  const listCommand  = new ListObjectVersionsCommand ( { Bucket: AWS_BUCKETNAME, Prefix: fileName } );
  const listResponse = await s3Client.send ( listCommand );
  console.log ("listing all versions: " , listResponse);

  const latestVersion = listResponse.Versions?.sort((a, b) => b.LastModified - a.LastModified)[0];
  return latestVersion?.VersionId;
}
