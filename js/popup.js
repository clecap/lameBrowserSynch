/* let btns = [ "clearBookmarks" ];
btns.forEach ( ele => { document.getElementById (ele).addEventListener("click", () => { 
  console.log ("sending message ", ele); chrome.runtime.sendMessage ( {action: ele, place: 1} );
  } ) });
*/


function triggerDownload (id) {
  chrome.runtime.sendMessage ( {action: "down", id:id, place: 2} );
}


let listing = document.getElementById ("listing");

listing.addEventListener ("click", (e) => {
  console.log (e.target);
});

// send command from UI to service worker
document.body.addEventListener ("click", (e) => {
  console.log ("clicked", e.target);
  if ( !e.target.dataset ) {console.warn ("no dataset found on target"); return;}
  let action = e.target.dataset.action;
  let src    = e.target.dataset.src;
  console.log ("UI sees ", action, src);
  chrome.runtime.sendMessage ( {action, src, place: 3} );
});




/*
document.getElementById ("list").addEventListener("click", () => { 
   chrome.runtime.sendMessage ( {action: "list"}, (r) => {console.log ("inneranswer", r);
   let txt = "";
   r.answer.forEach (ele => {
      txt += `<tr><td class='fileName'>${ele}</td><td><button data-src="${ele}" data-action="down">Down</button></td><td><button data-src="${ele}" data.action="up">Up</button></td><td><button data-src="${ele}" data-action="del">Del</button></td></tr>`;
    });
    listing.innerHTML = txt;

  } );

}); 
*/



 chrome.runtime.sendMessage ( {action: "list", place: 4}, (r) => {console.log ("inneranswer", r);
   let txt = "";
   r.answer.forEach (ele => {
      txt += `<tr><td class='fileName' title='${ele}'>${ele}</td><td><button data-src="${ele}" data-action="down">Down</button></td><td><button data-src="${ele}" data.action="up">Up</button></td><td><button data-src="${ele}" data-action="del">Del</button></td></tr>`;
    });
    listing.innerHTML = txt;

  } );



// onclick="triggerDownload('${ele}')



/*
document.getElementById('openSidepanel').addEventListener('click', async () => {
  console.log (chrome);
  console.log (chrome.sidePanel);
  let tabs = await chrome.tabs.query ( { active: true, currentWindow: true } );
  console.log ("tabs ", tabs);
  const tabId = tabs[0].id;
  console.log ( "tabId ", tabId);
  await chrome.sidePanel.open ( { tabId} );
});
*/




