let btns = ["up", "down", "clearBookmarks", "clearCookies"];
btns.forEach ( ele => { document.getElementById (ele).addEventListener("click", () => { console.log ("sending message ", ele);chrome.runtime.sendMessage ( {action: ele} ) } ) });

document.getElementById('openSidepanel').addEventListener('click', async () => {
  console.log (chrome);
  console.log (chrome.sidePanel);
  let tabs = await chrome.tabs.query ( { active: true, currentWindow: true } );
  console.log ("tabs ", tabs);
  const tabId = tabs[0].id;
  console.log ( "tabId ", tabId);
  await chrome.sidePanel.open ( { tabId} );
});