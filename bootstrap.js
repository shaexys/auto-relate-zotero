/* global Zotero, ChromeUtils, Services */

var chromeHandle;

function log(msg) {
  Zotero.debug(`[AutoRelate] ${msg}`);
}

async function startup({ id, version, resourceURI, rootURI }) {
  log(`Starting v${version}`);

  // Wait for Zotero to be fully initialized
  await Zotero.initializationPromise;

  // Load the core logic
  Services.scriptloader.loadSubScript(rootURI + "chrome/content/auto-relate.js");

  // Initialize (registers Notifier observer)
  Zotero.AutoRelate.init({ id, version, rootURI });
}

function shutdown({ id, version, resourceURI, rootURI }) {
  log("Shutting down");

  if (Zotero.AutoRelate) {
    Zotero.AutoRelate.destroy();
  }

  // Clear the namespace
  Zotero.AutoRelate = undefined;
}

function install() {
  log("Installed");
}

function uninstall() {
  log("Uninstalled");
}
