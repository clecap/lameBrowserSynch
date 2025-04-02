// This is the main background worker script

// IMPORTS
import { S3Client, ListBucketsCommand, ListObjectVersionsCommand, ListObjectsV2Command, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import * as CRYPTO from "./crypto.js";

const USING_CRYPTO = true;

let AES_Password;
let AWS_ACCESS_KEY_ID;
let AWS_SECRET_ACCESS_KEY;
let AWS_DEFAULT_REGION;
let AWS_BUCKETNAME;

let s3Client;


// Get AWS credentials from storage
async function getAWSCredentials () {
  const keys = ["AES_Password", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_DEFAULT_REGION", "AWS_BUCKETNAME"];

/*
  return chrome.storage.sync.get(keys, (data) => {
    console.log ("loaded credentials are",data);
    AES_Password          = data.AES_Password;
    AWS_ACCESS_KEY_ID     = data.AWS_ACCESS_KEY_ID;
    AWS_SECRET_ACCESS_KEY = data.AWS_SECRET_ACCESS_KEY;
    AWS_DEFAULT_REGION    = data.AWS_DEFAULT_REGION;
    AWS_BUCKETNAME        = data.AWS_BUCKETNAME;
    s3Client = new S3Client({ region: AWS_DEFAULT_REGION,  credentials: { accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_ACCESS_KEY } });
  });
*/

  let data = await chrome.storage.sync.get(keys);
    console.log ("loaded credentials are",data);
    AES_Password          = data.AES_Password;
    AWS_ACCESS_KEY_ID     = data.AWS_ACCESS_KEY_ID;
    AWS_SECRET_ACCESS_KEY = data.AWS_SECRET_ACCESS_KEY;
    AWS_DEFAULT_REGION    = data.AWS_DEFAULT_REGION;
    AWS_BUCKETNAME        = data.AWS_BUCKETNAME;
    s3Client = new S3Client({ region: AWS_DEFAULT_REGION,  credentials: { accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_ACCESS_KEY } });
  console.warn ("CLIENT IS ", s3Client);
  return Promise.resolve ( );

}




// Listen for all kinds of bookmark changes
chrome.bookmarks.onCreated.addListener ( function(id, bookmark) {
  M.markDirty();
  console.log(`Bookmark created: id=${id}, bookmark.id=${bookmark.id} title=${bookmark.title}  url=${bookmark.url}`, bookmark);
});

chrome.bookmarks.onRemoved.addListener ( function(id, parentId, index) {
  M.markDirty();
  console.log('Bookmark removed: id=', id, "parentid=", parentId, "index=", index);
});

chrome.bookmarks.onChanged.addListener (function(id, changeInfo) {
  M.markDirty();
  console.log('Bookmark changed:', id, changeInfo);
});

chrome.bookmarks.onMoved.addListener (function(id, oldParentId, oldIndex, newParentId, newIndex) {
  M.markDirty();
  console.log('Bookmark moved:', id, oldParentId, oldIndex, newParentId, newIndex);
});


chrome.bookmarks.onImportEnded.addListener ( function() {
  M.markDirty();
  console.log('Bookmark import completed');
});


chrome.bookmarks.onChildrenReordered.addListener ( function() {
  M.markDirty();
  console.log('Bookmark children have been reordered');
});


// CAVE: this is a bit tricky. it NEEDS the return true and the non-await type of promise.then
// if not, we get weird errors
chrome.runtime.onMessage.addListener( (message, sender, sendResponse) => {
   console.log ("got message ", message, sender);
  switch ( message.action) {
    case "down":            downloadBookmarksFromS3(message.src);  break;
    case "up":              uploadBookmarksToS3(message.src);      break;
    case "list":            listBookmarksFromS3().then ( listing => { console.log ("sending response", listing );sendResponse ( {answer: listing} ); });  return true;   break;

    case "del":              deleteAllVersions().then ( response => sendResponse ( {response} ) ); return true; break;  // catch !!
    case "clearBookmarks":  clearBookmarks ();          break;
    case "clearCookies":    clearCookies ();            break;
  }
});

 


chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
  console.log ("clicked notification ", notificationId, buttonIndex);
  if (notificationId === "lameNotification") {
    if (buttonIndex === 0) { return; }  // dismiss
    if (buttonIndex === 1) { uploadBookmarksToS3();}
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



async function clearBookmarks () {                        // console.log ("clearing bookmarks");
  M.disable();
  let bookmarkTree = await chrome.bookmarks.getTree();    // console.log ("got bookmarks tree ", bookmarkTree);
  const rootFolder = bookmarkTree[0];                     // console.log ("root folder is", rootFolder);
  try {
    if (rootFolder.children) { await deleteBookmarksTree(rootFolder.children); }
  } catch (x) { console.error (x);}
  M.enable(); M.markClean();
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

function deleteBookmark (bookmarkId) {
  return new Promise((resolve, reject) => {
    chrome.bookmarks.remove(bookmarkId, () => {
      if (chrome.runtime.lastError) {reject(chrome.runtime.lastError);} else {resolve();}
    });
  });
}








async function uploadBookmarksToS3 (keyName) {
  await getAWSCredentials ();
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
    uploadStringToS3 (uploadText, keyName);
  } catch (error) { console.error("Error uploading bookmarks to ", keyName); console.error (error); }
  M.markClean();
}

async function downloadBookmarksFromS3 (file) {
  await getAWSCredentials ();
  console.log ("Will download file ", file);
  M.disable (); console.warn ("M disabled");
  let downloadText = await downloadStringFromS3 ( file );
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
  let promises = [];
  for (let kid of bookmarks) { if (kid.folderType == 'bookmarks-bar') { promises.push ( installBookmarks (kid.children) ); } }

  await Promise.all ( promises );

  setTimeout ( () => { // let thread go for a moment to allow last event to be serviced  // TODO: THE SAME still must be done in the deletion function !!!!!


  console.warn ("all bookmarks installed");
  M.enable (); console.warn ("M enabled");
}, 5

);

}




async function deleteAllVersions (objectKey) {
  await getAWSCredentials ();
  try {
    let isTruncated = true;
    let versionMarker = undefined;

    while (isTruncated) {
      const listCommand = new ListObjectVersionsCommand({ Bucket: AWS_BUCKETNAME, Prefix: objectKey, KeyMarker: versionMarker,});  // list all versions
      const data = await s3Client.send(listCommand);
      
      for (const version of data.Versions) {  // delete each version and delete marker 
        const deleteCommand = new DeleteObjectCommand({ Bucket: AWS_BUCKETNAME, Key: objectKey, VersionId: version.VersionId });
        console.log(`Deleting version: ${version.VersionId}`);
        await s3Client.send(deleteCommand);
      }

      // Also delete any delete markers
      for (const marker of data.DeleteMarkers) {
        const deleteMarkerCommand = new DeleteObjectCommand({ Bucket: AWS_BUCKETNAME, Key: objectKey,  VersionId: marker.VersionId,});
        console.log(`Deleting delete marker: ${marker.VersionId}`);
        await s3Client.send(deleteMarkerCommand);
      }

      // Check if there are more versions to process
      isTruncated = data.IsTruncated;
      if (isTruncated) {versionMarker = data.NextKeyMarker;}
    }

    console.log(`Successfully deleted all versions and delete markers for: ${objectKey}`);
  } catch (error) {
    console.error('Error deleting object versions:', error);
  }
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




chrome.action.onClicked.addListener(async (tab) => {
  // console.log ("action clicked");
  try {
  } catch (error) {
    console.error('Error downloading or installing bookmarks:', error);
  }
});




// we want to use promises, since the tree of bookmarks requires some delicate sequencing (parents must have been constructed before constructing children
// and we need to know when everything has been completed as well)
// manifest v3 does not yet support promises in bookmarks
// THUS: warp it
function createBookmark(bookmark) {
  return new Promise((resolve, reject) => {
    chrome.bookmarks.create(bookmark, (result) => { if (chrome.runtime.lastError) {reject(new Error(chrome.runtime.lastError));} else {resolve(result);} } );
  });
}


async function installBookmarks ( bookmarkData ) {
  let arr = await installSomeBookmarks (bookmarkData);
  console.error ("checkertype " + typeof arr + "  " + Array.isArray(arr) + " length " + arr.length + "  " + JSON.stringify (arr));
//  return  arr;  // needed for end synchronization using await upstairs

  return Promise.resolve (true);
}

// create some bookmarks and return a promise
// pid, if defined, is the id of the parent which muts be used here as the installed bookmarks got a fresh parent id while being installed dynamically
async function installSomeBookmarks (bookmarkData, pid) {  // console.log ("installing bookmarks data", bookmarkData);
  let promises = [];
  for (const bookmark of bookmarkData) {
    if (bookmark.folderType == "other") { /* console.log ("skipping other"); */ continue; }
    if (bookmark.parentId === undefined || bookmark.parentId === "0") {bookmark.parentId = "1";} 
    if (pid !== undefined) {bookmark.parentId = pid;}
    if (bookmark.children) {
      // console.log (`installing node with ${bookmark.children.length} children \ntitle=${bookmark.title}, folderType=${bookmark.folderType}, id=${bookmark.id}, parentId=${bookmark.parentId} url=${bookmark.url}`, bookmark);
      try {
        let created = await createBookmark( {parentId: bookmark.parentId, title: bookmark.title, url: bookmark.url} );
        let p = await installSomeBookmarks (bookmark.children, created.id);
        // console.error ("CHECKER-ZWO " + typeof p + "  " + Array.isArray (p) + " " + JSON.stringify (p)) + " " + created.id;
        promises.push ( p );
        // console.warn ("CREATED ", created);
      } catch (x) { console.error (x); console.error (`ERROR installing node with ${bookmark.children.length} children \ntitle=${bookmark.title}, folderType=${bookmark.folderType}, id=${bookmark.id}, parentId=${bookmark.parentId} url=${bookmark.url}`, bookmark);     }
    }
    else {   // console.log (`installing leaf node \ntitle=${bookmark.title}, folderType=${bookmark.folderType}, id=${bookmark.id}, parentId=${bookmark.parentId} url=${bookmark.url} `, bookmark);
      try {
        promises.push ( createBookmark ( {parentId: bookmark.parentId, title: bookmark.title, url: bookmark.url} ) );
      } catch (x) { console.error (x); console.error (`ERROR installing leaf node \ntitle=${bookmark.title}, folderType=${bookmark.folderType}, id=${bookmark.id}, parentId=${bookmark.parentId} url=${bookmark.url} `, bookmark); }
    }
  } // end for

  // console.warn ("WILL-CHECKER " + typeof promises + "  " + Array.isArray (promises) + " " + JSON.stringify (promises));
  return Promise.all (promises);
} // end internal function
// '1' is the ID of the root folder







async function uploadStringToS3( txt, filename ) {
  await getAWSCredentials();
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


async function downloadStringFromS3 ( fileName ) {
  await getAWSCredentials();
  let version = await getLatestVersionNumber ( fileName );   // console.log ("downloadStringFromS3: latest version number is: ", version);
  let data;
  try {
    data = await s3Client.send(new GetObjectCommand( { Bucket: AWS_BUCKETNAME, Key: fileName, VersionId: version, requestCacheOptions: { cache: "no-store" } } ) ); // Explicitly disable caching ));  // console.log ("data is", data);
    const { Body } = data;  // console.log ("downloadStringFromS3: body is", Body);
    const fileContents = await streamToString(Body);
    return fileContents;
  } catch (x) { console.error ("error while downloading ", fileName); console.error ( x );  console.error ( data);}
}


async function getLatestVersionNumber (fileName ) {
  await getAWSCredentials();
  const listCommand  = new ListObjectVersionsCommand ( { Bucket: AWS_BUCKETNAME, Prefix: fileName } );
  const listResponse = await s3Client.send ( listCommand );
  console.log ("listing all versions: " , listResponse);
  const latestVersion = listResponse.Versions?.sort((a, b) => b.LastModified - a.LastModified)[0];
  return latestVersion?.VersionId;
}


async function listBookmarksFromS3() {
  await getAWSCredentials();
   console.error ("S3 client ", s3Client);
  try {
    let files = [];
    let continuationToken;
    do {
      const data = await s3Client.send(new ListObjectsV2Command ( { Bucket: AWS_BUCKETNAME, ContinuationToken: continuationToken } ) );
      if (data.Contents) {files = files.concat(data.Contents.map(item => item.Key));}
      continuationToken = data.NextContinuationToken;
    } while (continuationToken);

    console.log("Files in bucket:", files);
    return Promise.resolve (files);
  } catch (err) {console.error("Error listing S3 files:", err); }
}






