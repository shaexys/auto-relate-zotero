/* global Zotero */

Zotero.AutoRelate = {
  // ========== Config ==========
  // OpenAlex polite pool email — set via Zotero preferences, or leave blank for anonymous access
  get EMAIL() {
    return Zotero.Prefs.get("extensions.autorelate.email", true) || "";
  },
  API_DELAY_MS: 500,
  ADD_DELAY_MS: 5000,  // Wait for metadata to populate after item-add
  BATCH_WINDOW_MS: 3000,  // Batch items added within this window

  _notifierID: null,
  _pendingItems: [],
  _batchTimer: null,
  _doiCache: null,
  _doiCacheTime: 0,
  _DOI_CACHE_TTL: 60000,  // Rebuild DOI map if older than 60s
  _menuItemID: "auto-relate-context-menu",
  _menuSeparatorID: "auto-relate-context-separator",

  // ========== Lifecycle ==========
  init({ id, version, rootURI }) {
    this._log(`Initialized v${version}`);

    // Set default pref if not already set
    if (!Zotero.Prefs.get("extensions.autorelate.email", true)) {
      Zotero.Prefs.set("extensions.autorelate.email", "", true);
    }

    this._notifierID = Zotero.Notifier.registerObserver(
      this._observer,
      ["item"],
      "AutoRelate"
    );
    this._log("Notifier observer registered");

    this._addContextMenu();
  },

  destroy() {
    if (this._notifierID) {
      Zotero.Notifier.unregisterObserver(this._notifierID);
      this._notifierID = null;
    }
    if (this._batchTimer) {
      clearTimeout(this._batchTimer);
      this._batchTimer = null;
    }
    this._pendingItems = [];
    this._doiCache = null;
    this._removeContextMenu();
    this._log("Destroyed");
  },

  // ========== Context Menu ==========
  _addContextMenu() {
    const win = Zotero.getMainWindow();
    if (!win) return;
    const doc = win.document;
    const menu = doc.getElementById("zotero-itemmenu");
    if (!menu) {
      this._log("Item context menu not found, retrying in 2s");
      setTimeout(() => this._addContextMenu(), 2000);
      return;
    }

    const separator = doc.createXULElement("menuseparator");
    separator.id = this._menuSeparatorID;
    menu.appendChild(separator);

    const menuItem = doc.createXULElement("menuitem");
    menuItem.id = this._menuItemID;
    menuItem.setAttribute("label", "Find Related Items (OpenAlex)");
    menuItem.addEventListener("command", () => {
      Zotero.AutoRelate.processSelectedItems();
    });
    menu.appendChild(menuItem);

    this._log("Context menu item added");
  },

  _removeContextMenu() {
    const win = Zotero.getMainWindow();
    if (!win) return;
    const doc = win.document;
    for (const id of [this._menuItemID, this._menuSeparatorID]) {
      const el = doc.getElementById(id);
      if (el) el.remove();
    }
    this._log("Context menu item removed");
  },

  // ========== Manual Trigger (selected items) ==========
  async processSelectedItems() {
    const zp = Zotero.getActiveZoteroPane();
    const selectedItems = zp.getSelectedItems();
    if (selectedItems.length === 0) {
      this._log("No items selected");
      return;
    }

    // Filter to regular items with DOIs
    const items = selectedItems.filter((item) => {
      if (!item.isRegularItem()) return false;
      return !!this._normalizeDOI(item.getField("DOI"));
    });

    if (items.length === 0) {
      this._log("No selected items have DOIs");
      return;
    }

    this._log(`Manual run: ${items.length} item(s) selected`);

    // Show progress window
    const progressWin = new Zotero.ProgressWindow({ closeOnClick: false });
    progressWin.changeHeadline("Auto-Relate: Finding related items...");
    progressWin.show();

    const doiToItem = await this._getDOIMap();
    let totalAdded = 0;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const title = item.getField("title").substring(0, 50);
      try {
        const added = await this._processItem(item, doiToItem);
        totalAdded += added;
      } catch (e) {
        this._log(`Error processing "${title}": ${e.message}`);
      }
    }

    progressWin.changeHeadline(`Auto-Relate: Done`);
    const summary = new progressWin.ItemProgress(
      "", `${items.length} items processed, ${totalAdded} relations added`
    );
    summary.setProgress(100);
    progressWin.startCloseTimer(4000);

    this._log(`Manual run complete: ${items.length} items, ${totalAdded} relations added`);
  },

  // ========== Notifier Observer ==========
  _observer: {
    notify(event, type, ids, extraData) {
      if (event === "add" && type === "item") {
        Zotero.AutoRelate._onItemsAdded(ids);
      }
    },
  },

  _onItemsAdded(ids) {
    this._pendingItems.push(...ids);

    // Debounce: wait for batch window, then process all pending
    if (this._batchTimer) {
      clearTimeout(this._batchTimer);
    }
    this._batchTimer = setTimeout(() => {
      const batch = [...this._pendingItems];
      this._pendingItems = [];
      this._batchTimer = null;
      this._processBatch(batch);
    }, this.BATCH_WINDOW_MS);
  },

  // ========== Batch Processing ==========
  async _processBatch(ids) {
    // Wait for metadata to populate (Zotero Connector / import)
    await this._sleep(this.ADD_DELAY_MS);

    // Filter to regular items with DOIs
    const items = [];
    for (const id of ids) {
      try {
        const item = await Zotero.Items.getAsync(id);
        if (!item || !item.isRegularItem()) continue;
        const doi = this._normalizeDOI(item.getField("DOI"));
        if (!doi) {
          this._log(`Skipping item ${id} (no DOI)`);
          continue;
        }
        items.push(item);
      } catch (e) {
        this._log(`Error loading item ${id}: ${e.message}`);
      }
    }

    if (items.length === 0) {
      this._log("No processable items in batch");
      return;
    }

    this._log(`Processing batch of ${items.length} item(s)`);

    // Build/refresh DOI map
    const doiToItem = await this._getDOIMap();

    let totalAdded = 0;
    for (const item of items) {
      try {
        const added = await this._processItem(item, doiToItem);
        totalAdded += added;
      } catch (e) {
        this._log(`Error processing "${item.getField("title")}": ${e.message}`);
      }
    }

    this._log(`Batch complete: ${items.length} items processed, ${totalAdded} relations added`);
  },

  // ========== Core Logic (adapted from existing script) ==========
  async _processItem(item, doiToItem) {
    const title = item.getField("title").substring(0, 60);
    const doi = this._normalizeDOI(item.getField("DOI"));

    this._log(`Processing: "${title}" (${doi})`);

    // Query OpenAlex
    const work = await this._fetchOpenAlex(doi);
    if (!work) {
      this._log(`OpenAlex lookup failed for ${doi}`);
      return 0;
    }
    await this._sleep(this.API_DELAY_MS);

    // Collect related DOIs (references + cited_by)
    const relatedDOIs = new Set();

    // referenced_works → batch resolve DOIs
    if (work.referenced_works && work.referenced_works.length > 0) {
      const refIds = work.referenced_works.slice(0, 100);
      const filterParam = refIds
        .map((id) => id.replace("https://openalex.org/", ""))
        .join("|");
      const refsUrl = `https://api.openalex.org/works?filter=openalex_id:${filterParam}&select=doi&per_page=100${this._mailtoParam()}`;

      try {
        const resp = await fetch(refsUrl);
        if (resp.ok) {
          const data = await resp.json();
          for (const ref of data.results || []) {
            if (ref.doi) relatedDOIs.add(this._normalizeDOI(ref.doi));
          }
        }
      } catch (e) {
        this._log(`Error fetching references: ${e.message}`);
      }
      await this._sleep(this.API_DELAY_MS);
    }

    // cited_by
    if (work.cited_by_api_url) {
      try {
        const citedByUrl = `${work.cited_by_api_url}&select=doi&per_page=100${this._mailtoParam()}`;
        const resp = await fetch(citedByUrl);
        if (resp.ok) {
          const data = await resp.json();
          for (const citing of data.results || []) {
            if (citing.doi) relatedDOIs.add(this._normalizeDOI(citing.doi));
          }
        }
      } catch (e) {
        this._log(`Error fetching cited_by: ${e.message}`);
      }
      await this._sleep(this.API_DELAY_MS);
    }

    this._log(`Found ${relatedDOIs.size} related DOIs for "${title}"`);

    // Match against library and add relations
    let addedCount = 0;
    for (const relatedDOI of relatedDOIs) {
      const relatedItem = doiToItem.get(relatedDOI);
      if (relatedItem && relatedItem.id !== item.id) {
        const existingRelated = item.relatedItems;
        if (!existingRelated.includes(relatedItem.key)) {
          item.addRelatedItem(relatedItem);
          relatedItem.addRelatedItem(item);
          await relatedItem.saveTx();
          addedCount++;
        }
      }
    }

    if (addedCount > 0) {
      await item.saveTx();
      this._log(`Added ${addedCount} relation(s) for "${title}"`);
    } else {
      this._log(`No new relations for "${title}"`);
    }

    return addedCount;
  },

  // ========== DOI Map ==========
  async _getDOIMap() {
    const now = Date.now();
    if (this._doiCache && now - this._doiCacheTime < this._DOI_CACHE_TTL) {
      return this._doiCache;
    }

    this._log("Building DOI → Item map");
    const library = Zotero.Libraries.userLibrary;
    const allItems = await Zotero.Items.getAll(library.id);
    const map = new Map();

    for (const item of allItems) {
      if (item.isRegularItem()) {
        const doi = this._normalizeDOI(item.getField("DOI"));
        if (doi) map.set(doi, item);
      }
    }

    this._doiCache = map;
    this._doiCacheTime = now;
    this._log(`DOI map built: ${map.size} items`);
    return map;
  },

  // ========== Helpers ==========
  async _fetchOpenAlex(doi) {
    const url = `https://api.openalex.org/works/doi:${encodeURIComponent(doi)}?select=id,doi,title,referenced_works,cited_by_api_url,cited_by_count${this._mailtoParam()}`;
    try {
      const response = await fetch(url);
      if (!response.ok) {
        this._log(`OpenAlex HTTP ${response.status} for ${doi}`);
        return null;
      }
      return await response.json();
    } catch (e) {
      this._log(`OpenAlex fetch error for ${doi}: ${e.message}`);
      return null;
    }
  },

  _mailtoParam() {
    const email = this.EMAIL;
    return email ? `&mailto=${encodeURIComponent(email)}` : "";
  },

  _normalizeDOI(doi) {
    if (!doi) return null;
    return doi.replace(/^https?:\/\/doi\.org\//i, "").toLowerCase().trim();
  },

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  },

  _log(msg) {
    Zotero.debug(`[AutoRelate] ${msg}`);
  },
};
