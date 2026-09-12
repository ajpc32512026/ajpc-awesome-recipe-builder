/* =========================================================
   INGREDIENTS EDITOR
   ---------------------------------------------------------
   Same spirit as Manage Tags, adapted for ingredient lines:
     - Scans every REAL recipe file (never recipe-index.json —
       that's a cache and shouldn't be trusted as a source of
       truth, same lesson learned building Manage Tags).
     - Groups by EXACT item text (case-sensitive on purpose —
       "flour" and "Plain Flour" need to show up as two
       different entries so the inconsistency is visible).
     - Unlike Manage Tags, edits here save immediately, one
       row at a time — no staging, no Apply All. Rename/Delete
       Everywhere still confirm first since they're bulk and
       irreversible, but commit straight away once confirmed.
     - Standard notes live in their own file, keyed by the
       LOWERCASED item text (so "Flour" and "flour" share
       suggestions, unlike the case-sensitive audit grouping
       above) — ingredient-notes-library.json. Created on
       first save if it doesn't exist yet.

   A note on escaping: dynamic strings embedded into onclick="..."
   attributes go through jsArg(), which JSON.stringifies the value
   (correctly escaping quotes, apostrophes, backslashes) and then
   HTML-escapes only the resulting double quotes. A naive approach
   using &#39; for apostrophes is actually broken — the browser
   HTML-decodes the attribute BEFORE treating it as JS, so &#39;
   becomes a real apostrophe that prematurely closes the JS string
   and throws a silent syntax error. Any ingredient or tag text
   containing an apostrophe ("Chef's Special") would fail this way.

   Depends on: builder-validator.js (getRootHandle,
   getRecipeFileHandle, readRecipeData), builder-data.js
   (syncRecipeIndexEntry), builder-ui.js (toast).
========================================================= */

(function () {
    'use strict';

    // ── State ────────────────────────────────────────────
    // ingredientMap: { "Exact Item Text": [{id, title, category, rowIndex,
    //                  toTaste, quantity, unit, notes}, ...] }
    var ingredientMap = {};
    var currentSelectedItem = null;
    var currentBrowseList = [];
    var notesLibrary = null;       // lazy-loaded on first open of a notes picker
    var notesLibraryHandle = null; // cached file handle once resolved

    function bv() { return window.BuilderValidator; }

    function escHtml(str) {
        return String(str == null ? '' : str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // Correctly escapes a value for use as an argument inside an
    // onclick="..." attribute. Produces the full quoted JS literal
    // (e.g. jsArg("a'b") -> `&quot;a'b&quot;`) — callers should NOT
    // wrap the result in their own quotes.
    function jsArg(val) {
        return JSON.stringify(String(val == null ? '' : val)).replace(/"/g, '&quot;');
    }

    // ── Scan every real recipe file ─────────────────────────
    async function scanAllIngredients() {
        var panel  = document.getElementById('ingredients-panel');
        var output = document.getElementById('ingredients-all-output');
        if (panel) panel.style.display = 'block';
        if (output) output.innerHTML = '<p class="preview-placeholder">Scanning recipe collection…</p>';
        if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        resetDetailView();

        var index;
        try {
            var res = await fetch('json/recipe-index.json?t=' + Date.now());
            index = await res.json();
        } catch (e) {
            if (output) output.innerHTML = '<p class="diff-note">Could not load json/recipe-index.json</p>';
            return;
        }

        ingredientMap = {};
        currentSelectedItem = null;
        currentBrowseList = [];
        var failed = [];

        for (var i = 0; i < index.length; i++) {
            var id = index[i].id;
            try {
                var data = await bv().readRecipeData(id);
                var ings = data.ingredients || [];
                for (var r = 0; r < ings.length; r++) {
                    var ing = ings[r];
                    if (!ing || ing.heading !== undefined || !ing.item) continue;
                    var key = ing.item;
                    if (!ingredientMap[key]) ingredientMap[key] = [];
                    ingredientMap[key].push({
                        id: id,
                        title: data.title || id,
                        category: data.category || '',
                        rowIndex: r,
                        toTaste: !!ing.toTaste,
                        quantity: ing.quantity !== undefined ? ing.quantity : '',
                        unit: ing.unit !== undefined ? ing.unit : '',
                        notes: ing.notes || ''
                    });
                }
            } catch (e) {
                failed.push(id);
            }
        }

        renderAllIngredients();
        if (failed.length && output) {
            output.insertAdjacentHTML('afterbegin', '<p class="diff-note">Could not read: ' + failed.join(', ') + '</p>');
        }
    }

    function renderAllIngredients() {
        var output = document.getElementById('ingredients-all-output');
        if (!output) return;

        var names = Object.keys(ingredientMap).sort(function (a, b) { return a.localeCompare(b); });
        if (!names.length) {
            output.innerHTML = '<p class="preview-placeholder">No ingredients found across the collection.</p>';
            return;
        }

        var html = '<div class="tags-grid">';
        names.forEach(function (name) {
            var count = ingredientMap[name].length;
            html += '<div class="tag-manage-chip">' +
                '<span class="tag-manage-name" onclick="BuilderIngredients.selectItem(' + jsArg(name) + ')">' +
                    escHtml(name) + ' <span class="tag-manage-count">(' + count + ')</span>' +
                '</span>' +
                '<button class="tag-manage-delete" title="Delete this ingredient line from all ' + count + ' recipes" ' +
                    'onclick="BuilderIngredients.deleteItemEverywhere(' + jsArg(name) + ')">&times;</button>' +
                '</div>';
        });
        html += '</div>';
        output.innerHTML = html;
    }

    function resetDetailView() {
        var header = document.getElementById('ingredients-detail-header');
        var output = document.getElementById('ingredients-detail-output');
        if (header) header.textContent = 'Select an ingredient above to see its recipes';
        if (output) output.innerHTML = '';
    }

    // ── Select an ingredient — freezes the browse list, same
    //    reasoning as Manage Tags: editing shouldn't yank rows
    //    out of view mid-session. ─────────────────────────
    function selectItem(name) {
        currentSelectedItem = name;
        currentBrowseList = (ingredientMap[name] || []).slice();
        renderDetailView();
    }

    function renderDetailView() {
        var header = document.getElementById('ingredients-detail-header');
        var output = document.getElementById('ingredients-detail-output');
        if (!header || !output) return;

        var name = currentSelectedItem;
        var rows = currentBrowseList;
        header.textContent = '"' + name + '" — ' + rows.length + ' line' + (rows.length !== 1 ? 's' : '') + ' across the collection';

        if (!rows.length) {
            output.innerHTML = '<p class="preview-placeholder">Select an ingredient above to see its recipes.</p>';
            return;
        }

        var html = '<div class="tags-swap-all-bar">' +
            '<span>Rename "' + escHtml(name) + '" everywhere it appears:</span>' +
            '<input type="text" class="tag-swap-input" id="rename-all-input" placeholder="New ingredient text…" value="' + escHtml(name) + '">' +
            '<button class="btn primary" onclick="BuilderIngredients.renameItemEverywhere(' + jsArg(name) + ', document.getElementById(\'rename-all-input\').value)">Rename All ' + rows.length + '</button>' +
            '</div>' +
            '<div class="tags-swap-all-bar">' +
            '<span>Set the same note on all ' + rows.length + ' line' + (rows.length !== 1 ? 's' : '') + ' shown below:</span>' +
            '<input type="text" class="tag-swap-input" id="notes-all-input" placeholder="Notes text…">' +
            '<button class="btn primary" onclick="BuilderIngredients.setNotesForAll(' + jsArg(name) + ', document.getElementById(\'notes-all-input\').value)">Set Notes on All ' + rows.length + '</button>' +
            '</div>';

        rows.slice().sort(function (a, b) { return a.title.localeCompare(b.title); }).forEach(function (r) {
            var rowKey = r.id + '__' + r.rowIndex; // unique per recipe+row for element ids — ids are simple slugs, safe as-is
            var safeRowKey = rowKey.replace(/[^a-zA-Z0-9]/g, '_');

            html += '<div class="validate-file" id="ing-row-' + safeRowKey + '">' +
                '<div class="validate-file-name">' +
                '<span>' + escHtml(r.title) + ' <span class="validate-count">' + escHtml(r.id) + '.json' + (r.toTaste ? ' · to taste' : '') + '</span></span>' +
                '<span class="tags-row-actions">' +
                '<button class="validate-load-btn" onclick="BuilderValidator.loadRecipeForEditing(' + jsArg(r.id) + ')">Load in Editor</button>' +
                '<button class="tag-manage-delete-inline" title="Remove this ingredient line from just this recipe" ' +
                    'onclick="BuilderIngredients.deleteRow(' + jsArg(r.id) + ', ' + r.rowIndex + ', \'' + safeRowKey + '\')">Delete Line</button>' +
                '</span></div>' +
                '<div class="ing-edit-grid">' +
                (r.toTaste ? '' :
                    '<input type="text" class="ing-field ing-field-qty" id="ing-qty-' + safeRowKey + '" placeholder="Qty" value="' + escHtml(String(r.quantity)) + '">' +
                    '<input type="text" class="ing-field ing-field-unit" id="ing-unit-' + safeRowKey + '" placeholder="Unit" value="' + escHtml(String(r.unit)) + '">'
                ) +
                '<input type="text" class="ing-field ing-field-item" id="ing-item-' + safeRowKey + '" placeholder="Item" value="' + escHtml(r.item || name) + '">' +
                '<div class="ing-notes-wrap">' +
                '<input type="text" class="ing-field ing-field-notes" id="ing-notes-' + safeRowKey + '" placeholder="Notes (optional)" value="' + escHtml(r.notes) + '">' +
                '<button class="ing-notes-btn" onclick="BuilderIngredients.toggleNotesPicker(\'' + safeRowKey + '\', ' + jsArg(name) + ')">Notes &#9662;</button>' +
                '<div class="ing-notes-picker" id="ing-notes-picker-' + safeRowKey + '" style="display:none;"></div>' +
                '</div>' +
                '<button class="btn primary ing-save-btn" onclick="BuilderIngredients.saveRow(' + jsArg(r.id) + ', ' + r.rowIndex + ', \'' + safeRowKey + '\', ' + jsArg(name) + ')">Save</button>' +
                '</div></div>';
        });
        output.innerHTML = html;
    }

    // ── Per-row save — immediate, no staging ────────────────
    function flashSaveButton(safeRowKey) {
        var rowEl = document.getElementById('ing-row-' + safeRowKey);
        var btn = rowEl ? rowEl.querySelector('.ing-save-btn') : null;
        if (!btn) return;
        var original = btn.textContent;
        btn.textContent = '✓ Saved!';
        btn.style.background = '#3a7a4e';
        setTimeout(function () { btn.textContent = original; btn.style.background = ''; }, 1400);
    }

    async function saveRow(id, rowIndex, safeRowKey, originalItemName) {
        var rootHandle = bv() && bv().getRootHandle();
        if (!rootHandle) {
            alert('Connect your project folder first — saving ingredient edits writes directly to your recipe files and needs real file access.');
            return;
        }
        var itemEl  = document.getElementById('ing-item-' + safeRowKey);
        var qtyEl   = document.getElementById('ing-qty-' + safeRowKey);
        var unitEl  = document.getElementById('ing-unit-' + safeRowKey);
        var notesEl = document.getElementById('ing-notes-' + safeRowKey);
        var newItem = itemEl ? itemEl.value.trim() : originalItemName;
        if (!newItem) { alert('Item can\'t be empty — use Delete Line instead if you want it gone.'); return; }

        try {
            var handle = await bv().getRecipeFileHandle(id);
            if (!handle) throw new Error('file not found');
            var file = await handle.getFile();
            var data = JSON.parse(await file.text());
            var ing = data.ingredients && data.ingredients[rowIndex];
            if (!ing) throw new Error('ingredient row ' + rowIndex + ' no longer exists in this file — the recipe may have been edited elsewhere since this list was scanned. Re-scan and try again.');

            ing.item = newItem;
            if (qtyEl)  { if (qtyEl.value.trim() !== '') ing.quantity = qtyEl.value.trim(); }
            if (unitEl) { ing.unit = unitEl.value; }
            if (notesEl) {
                var newNotes = notesEl.value.trim();
                if (newNotes) ing.notes = newNotes; else delete ing.notes;
            }

            var w = await handle.createWritable();
            await w.write(JSON.stringify(data, null, 2));
            await w.close();

            if (typeof syncRecipeIndexEntry === 'function') await syncRecipeIndexEntry(id, data);

            // Move this row from its old group to the new one if the item text changed
            if (ingredientMap[originalItemName]) {
                ingredientMap[originalItemName] = ingredientMap[originalItemName].filter(function (r) { return !(r.id === id && r.rowIndex === rowIndex); });
                if (!ingredientMap[originalItemName].length) delete ingredientMap[originalItemName];
            }
            var moved = { id: id, title: data.title || id, category: data.category || '', rowIndex: rowIndex, toTaste: !!ing.toTaste, quantity: ing.quantity || '', unit: ing.unit || '', notes: ing.notes || '' };
            if (!ingredientMap[newItem]) ingredientMap[newItem] = [];
            ingredientMap[newItem].push(moved);

            renderAllIngredients(); // top grid only — counts, not the row inputs below

            if (newItem === originalItemName) {
                // Item text unchanged — keep this row's entry in the frozen browse
                // list up to date, but DON'T touch the DOM. Rebuilding it would
                // wipe out anything typed but not yet saved in every OTHER row
                // on screen — that was the actual bug behind "had to do them one
                // at a time" and Save looking like it wasn't working.
                var browseEntry = currentBrowseList.filter(function (r) { return r.id === id && r.rowIndex === rowIndex; })[0];
                if (browseEntry) {
                    browseEntry.quantity = moved.quantity;
                    browseEntry.unit = moved.unit;
                    browseEntry.notes = moved.notes;
                }
                flashSaveButton(safeRowKey);
            } else {
                // This row no longer belongs in the current list — remove just
                // this one row element, leave every other row's inputs alone.
                currentBrowseList = currentBrowseList.filter(function (r) { return !(r.id === id && r.rowIndex === rowIndex); });
                var rowEl = document.getElementById('ing-row-' + safeRowKey);
                if (rowEl) rowEl.remove();
                var header = document.getElementById('ingredients-detail-header');
                if (header) header.textContent = '"' + currentSelectedItem + '" — ' + currentBrowseList.length + ' line' + (currentBrowseList.length !== 1 ? 's' : '') + ' across the collection';
            }
            if (typeof toast === 'function') toast('Saved ' + id + '.json');
        } catch (e) {
            alert('Could not save: ' + e.message);
        }
    }

    // ── Delete one ingredient line from one recipe ──────────
    async function deleteRow(id, rowIndex, safeRowKey) {
        var rootHandle = bv() && bv().getRootHandle();
        if (!rootHandle) {
            alert('Connect your project folder first — deleting an ingredient line writes directly to your recipe files and needs real file access.');
            return;
        }
        if (!confirm('Remove this ingredient line from ' + id + '.json? This can\'t be undone.')) return;

        try {
            var handle = await bv().getRecipeFileHandle(id);
            if (!handle) throw new Error('file not found');
            var file = await handle.getFile();
            var data = JSON.parse(await file.text());
            if (!data.ingredients || !data.ingredients[rowIndex]) throw new Error('ingredient row no longer exists — re-scan and try again.');

            data.ingredients.splice(rowIndex, 1);

            var w = await handle.createWritable();
            await w.write(JSON.stringify(data, null, 2));
            await w.close();
            if (typeof syncRecipeIndexEntry === 'function') await syncRecipeIndexEntry(id, data);

            // Remove this row from whichever group it's in, and shift down the
            // rowIndex of every OTHER row from the same recipe that came after it —
            // the array just shrank by one at that position.
            Object.keys(ingredientMap).forEach(function (key) {
                ingredientMap[key] = ingredientMap[key].filter(function (r) { return !(r.id === id && r.rowIndex === rowIndex); });
                ingredientMap[key].forEach(function (r) { if (r.id === id && r.rowIndex > rowIndex) r.rowIndex--; });
                if (!ingredientMap[key].length) delete ingredientMap[key];
            });
            currentBrowseList = currentBrowseList.filter(function (r) { return !(r.id === id && r.rowIndex === rowIndex); });
            var sameRecipeStillShown = currentBrowseList.some(function (r) { return r.id === id; });
            if (sameRecipeStillShown) {
                // Another row from the same recipe is still in this list, and its
                // rowIndex may have just shifted — safest to fully refresh so its
                // onclick handlers reference the correct (new) index.
                currentBrowseList.forEach(function (r) { if (r.id === id && r.rowIndex > rowIndex) r.rowIndex--; });
                renderAllIngredients();
                renderDetailView();
            } else {
                // No sibling row from this recipe on screen — safe to just remove
                // this one row element, leaving every other row's inputs alone.
                renderAllIngredients();
                var rowEl = document.getElementById('ing-row-' + safeRowKey);
                if (rowEl) rowEl.remove();
                var header = document.getElementById('ingredients-detail-header');
                if (header) header.textContent = '"' + currentSelectedItem + '" — ' + currentBrowseList.length + ' line' + (currentBrowseList.length !== 1 ? 's' : '') + ' across the collection';
            }
            if (typeof toast === 'function') toast('Removed ingredient line from ' + id + '.json');
        } catch (e) {
            alert('Could not delete: ' + e.message);
        }
    }

    // ── Rename everywhere ────────────────────────────────────
    async function renameItemEverywhere(oldName, newName) {
        newName = (newName || '').trim();
        if (!newName || newName === oldName) return;
        var rootHandle = bv() && bv().getRootHandle();
        if (!rootHandle) {
            alert('Connect your project folder first — renaming writes directly to your recipe files and needs real file access.');
            return;
        }
        var rows = (ingredientMap[oldName] || []).slice();
        if (!rows.length) return;
        if (!confirm('Rename "' + oldName + '" to "' + newName + '" in all ' + rows.length + ' place(s)? This writes to every recipe listed and can\'t be undone.')) return;

        var succeeded = 0, failedIds = [];
        for (var i = 0; i < rows.length; i++) {
            var r = rows[i];
            try {
                var handle = await bv().getRecipeFileHandle(r.id);
                if (!handle) throw new Error('file not found');
                var file = await handle.getFile();
                var data = JSON.parse(await file.text());
                var ing = data.ingredients && data.ingredients[r.rowIndex];
                if (!ing) throw new Error('row moved');
                ing.item = newName;
                var w = await handle.createWritable();
                await w.write(JSON.stringify(data, null, 2));
                await w.close();
                if (typeof syncRecipeIndexEntry === 'function') await syncRecipeIndexEntry(r.id, data);
                succeeded++;
            } catch (e) {
                failedIds.push(r.id);
            }
        }

        delete ingredientMap[oldName];
        if (succeeded) {
            if (!ingredientMap[newName]) ingredientMap[newName] = [];
            rows.forEach(function (r) {
                if (failedIds.indexOf(r.id) === -1) {
                    r.item = newName;
                    ingredientMap[newName].push(r);
                }
            });
        }
        renderAllIngredients();
        resetDetailView();

        if (failedIds.length) {
            alert('Renamed ' + succeeded + ' of ' + rows.length + '. Failed: ' + failedIds.join(', '));
        } else if (typeof toast === 'function') {
            toast('Renamed "' + oldName + '" to "' + newName + '" in ' + succeeded + ' place(s)');
        }
    }

    // ── Set the same note across every currently-shown row ──
    async function setNotesForAll(name, notesText) {
        notesText = (notesText || '').trim();
        var rootHandle = bv() && bv().getRootHandle();
        if (!rootHandle) {
            alert('Connect your project folder first — this writes directly to your recipe files and needs real file access.');
            return;
        }
        var rows = currentBrowseList.slice();
        if (!rows.length) return;
        if (!confirm((notesText ? 'Set notes to "' + notesText + '"' : 'Clear notes') + ' on all ' + rows.length + ' line(s) currently shown for "' + name + '"? This writes to every recipe listed and overwrites whatever notes are there now, including anything typed but not yet saved.')) return;

        var succeeded = 0, failedIds = [];
        for (var i = 0; i < rows.length; i++) {
            var r = rows[i];
            try {
                var handle = await bv().getRecipeFileHandle(r.id);
                if (!handle) throw new Error('file not found');
                var file = await handle.getFile();
                var data = JSON.parse(await file.text());
                var ing = data.ingredients && data.ingredients[r.rowIndex];
                if (!ing) throw new Error('row moved');
                if (notesText) ing.notes = notesText; else delete ing.notes;
                var w = await handle.createWritable();
                await w.write(JSON.stringify(data, null, 2));
                await w.close();
                if (typeof syncRecipeIndexEntry === 'function') await syncRecipeIndexEntry(r.id, data);
                r.notes = notesText;
                succeeded++;
            } catch (e) {
                failedIds.push(r.id);
            }
        }

        // Reflect the new notes value in ingredientMap too, for consistency
        // if this ingredient gets re-selected later without a full re-scan.
        (ingredientMap[name] || []).forEach(function (r) {
            var match = rows.filter(function (x) { return x.id === r.id && x.rowIndex === r.rowIndex; })[0];
            if (match && failedIds.indexOf(r.id) === -1) r.notes = notesText;
        });

        renderDetailView(); // deliberate full refresh — this action intentionally overwrites every row shown

        if (failedIds.length) {
            alert('Set notes on ' + succeeded + ' of ' + rows.length + '. Failed: ' + failedIds.join(', '));
        } else if (typeof toast === 'function') {
            toast('Set notes on ' + succeeded + ' recipe' + (succeeded !== 1 ? 's' : ''));
        }
    }

    // ── Delete everywhere ────────────────────────────────────
    async function deleteItemEverywhere(name) {
        var rootHandle = bv() && bv().getRootHandle();
        if (!rootHandle) {
            alert('Connect your project folder first — deleting writes directly to your recipe files and needs real file access.');
            return;
        }
        var rows = (ingredientMap[name] || []).slice();
        if (!rows.length) return;
        if (!confirm('Delete "' + name + '" from all ' + rows.length + ' place(s) it appears? This removes the whole ingredient line from every recipe listed and can\'t be undone.')) return;

        // Group by recipe id so multiple occurrences in the SAME file are
        // removed highest-index-first — deleting from the front would shift
        // the remaining indices out from under the rest of the loop.
        var byRecipe = {};
        rows.forEach(function (r) { (byRecipe[r.id] = byRecipe[r.id] || []).push(r.rowIndex); });

        var succeeded = 0, failedIds = [];
        for (var id in byRecipe) {
            try {
                var handle = await bv().getRecipeFileHandle(id);
                if (!handle) throw new Error('file not found');
                var file = await handle.getFile();
                var data = JSON.parse(await file.text());
                var indices = byRecipe[id].slice().sort(function (a, b) { return b - a; });
                indices.forEach(function (idx) {
                    if (data.ingredients && data.ingredients[idx]) data.ingredients.splice(idx, 1);
                });
                var w = await handle.createWritable();
                await w.write(JSON.stringify(data, null, 2));
                await w.close();
                if (typeof syncRecipeIndexEntry === 'function') await syncRecipeIndexEntry(id, data);
                succeeded += indices.length;
            } catch (e) {
                failedIds.push(id);
            }
        }

        delete ingredientMap[name];
        renderAllIngredients();
        resetDetailView();

        if (failedIds.length) {
            alert('Deleted ' + succeeded + ' of ' + rows.length + '. Failed on: ' + failedIds.join(', '));
        } else if (typeof toast === 'function') {
            toast('Deleted "' + name + '" from ' + succeeded + ' place(s)');
        }
    }

    // ── Standard notes library ───────────────────────────────
    // ingredient-notes-library.json — { "lowercased item text": [{text, isStandard}] }
    // Keyed lowercase so "Flour" and "flour" share suggestions, unlike the
    // case-sensitive grouping used for the audit view above.
    async function getNotesLibraryHandle(create) {
        var rootHandle = bv() && bv().getRootHandle();
        if (!rootHandle) return null;
        var jsonDir = await rootHandle.getDirectoryHandle('json');
        return await jsonDir.getFileHandle('ingredient-notes-library.json', { create: !!create });
    }

    async function loadNotesLibrary() {
        if (notesLibrary) return notesLibrary;
        try {
            notesLibraryHandle = await getNotesLibraryHandle(false);
            var file = await notesLibraryHandle.getFile();
            var text = await file.text();
            notesLibrary = text.trim() ? JSON.parse(text) : {};
        } catch (e) {
            notesLibrary = {}; // doesn't exist yet — fine, created on first save
        }
        return notesLibrary;
    }

    async function saveNotesLibrary() {
        var handle = notesLibraryHandle || await getNotesLibraryHandle(true);
        notesLibraryHandle = handle;
        var w = await handle.createWritable();
        await w.write(JSON.stringify(notesLibrary, null, 2));
        await w.close();
    }

    async function toggleNotesPicker(safeRowKey, itemName) {
        var picker = document.getElementById('ing-notes-picker-' + safeRowKey);
        if (!picker) return;
        if (picker.style.display === 'block') { picker.style.display = 'none'; return; }

        // Close any other open pickers on the page first
        document.querySelectorAll('.ing-notes-picker').forEach(function (p) { p.style.display = 'none'; });

        await loadNotesLibrary();
        var key = (currentSelectedItem || itemName).toLowerCase().trim();
        renderNotesPicker(picker, safeRowKey, key);
        picker.style.display = 'block';
    }

    function renderNotesPicker(picker, safeRowKey, key) {
        var entries = notesLibrary[key] || [];
        var html = '';
        if (!entries.length) {
            html += '<p class="ing-notes-empty">No saved notes yet for this ingredient.</p>';
        } else {
            entries.forEach(function (n, i) {
                html += '<div class="ing-notes-entry">' +
                    '<span class="ing-notes-text" onclick="BuilderIngredients.applyNote(\'' + safeRowKey + '\', ' + i + ', ' + jsArg(key) + ')">' +
                    (n.isStandard ? '&#9733; ' : '') + escHtml(n.text) +
                    '</span>' +
                    '<button class="ing-notes-remove" onclick="BuilderIngredients.removeNote(' + jsArg(key) + ', ' + i + ', \'' + safeRowKey + '\')">&times;</button>' +
                    '</div>';
            });
        }
        html += '<div class="ing-notes-add">' +
            '<input type="text" class="ing-field" id="ing-notes-newtext-' + safeRowKey + '" placeholder="Save current text as a note…">' +
            '<label><input type="checkbox" id="ing-notes-standard-' + safeRowKey + '"> Standard</label>' +
            '<button class="btn" onclick="BuilderIngredients.saveNote(' + jsArg(key) + ', \'' + safeRowKey + '\')">Save Note</button>' +
            '</div>';
        picker.innerHTML = html;

        var newTextEl = document.getElementById('ing-notes-newtext-' + safeRowKey);
        var notesInput = document.getElementById('ing-notes-' + safeRowKey);
        if (newTextEl && notesInput && notesInput.value) newTextEl.value = notesInput.value;
    }

    function applyNote(safeRowKey, index, key) {
        var entries = notesLibrary[key] || [];
        var entry = entries[index];
        var input = document.getElementById('ing-notes-' + safeRowKey);
        if (entry && input) input.value = entry.text;
        var picker = document.getElementById('ing-notes-picker-' + safeRowKey);
        if (picker) picker.style.display = 'none';
    }

    async function saveNote(key, safeRowKey) {
        var textEl = document.getElementById('ing-notes-newtext-' + safeRowKey);
        var standardEl = document.getElementById('ing-notes-standard-' + safeRowKey);
        var text = textEl ? textEl.value.trim() : '';
        if (!text) { alert('Type the note text first.'); return; }
        var isStandard = !!(standardEl && standardEl.checked);

        if (!notesLibrary[key]) notesLibrary[key] = [];
        if (isStandard) notesLibrary[key].forEach(function (n) { n.isStandard = false; }); // only one standard per ingredient
        var existing = notesLibrary[key].find(function (n) { return n.text === text; });
        if (existing) existing.isStandard = isStandard;
        else notesLibrary[key].push({ text: text, isStandard: isStandard });

        try {
            await saveNotesLibrary();
            var picker = document.getElementById('ing-notes-picker-' + safeRowKey);
            if (picker) renderNotesPicker(picker, safeRowKey, key);
            if (typeof toast === 'function') toast('Saved note for "' + key + '"');
        } catch (e) {
            alert('Could not save notes library: ' + e.message);
        }
    }

    async function removeNote(key, index, safeRowKey) {
        if (!notesLibrary[key]) return;
        notesLibrary[key].splice(index, 1);
        if (!notesLibrary[key].length) delete notesLibrary[key];
        try {
            await saveNotesLibrary();
            var picker = document.getElementById('ing-notes-picker-' + safeRowKey);
            if (picker) renderNotesPicker(picker, safeRowKey, key);
        } catch (e) {
            alert('Could not update notes library: ' + e.message);
        }
    }

    function closeIngredientsPanel() {
        var panel = document.getElementById('ingredients-panel');
        if (panel) panel.style.display = 'none';
    }

    function init() {
        var btn = document.getElementById('manage-ingredients-btn');
        if (btn) btn.addEventListener('click', scanAllIngredients);
        var closeBtn = document.getElementById('close-ingredients-btn');
        if (closeBtn) closeBtn.addEventListener('click', closeIngredientsPanel);
        // Close any open notes picker when clicking elsewhere on the page
        document.addEventListener('click', function (e) {
            if (e.target.closest && (e.target.closest('.ing-notes-wrap'))) return;
            document.querySelectorAll('.ing-notes-picker').forEach(function (p) { p.style.display = 'none'; });
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.BuilderIngredients = {
        scanAllIngredients: scanAllIngredients,
        selectItem: selectItem,
        saveRow: saveRow,
        deleteRow: deleteRow,
        renameItemEverywhere: renameItemEverywhere,
        setNotesForAll: setNotesForAll,
        deleteItemEverywhere: deleteItemEverywhere,
        toggleNotesPicker: toggleNotesPicker,
        applyNote: applyNote,
        saveNote: saveNote,
        removeNote: removeNote,
        closeIngredientsPanel: closeIngredientsPanel
    };

})();
