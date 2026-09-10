/* =========================================================
   BUILDER VALIDATOR — Schema-aware recipe consistency checker
   ---------------------------------------------------------
   The benchmark recipe (chefstyletiramisugateau.json) defines
   the canonical shape for a recipe file, but a flat key-by-key
   diff against it alone gives false positives: several fields
   are legitimate, fully-supported variants that the benchmark
   simply doesn't happen to use — heading rows (ingredients &
   method), toTaste items, youWillNeed/equipment, journal,
   related, and partial micronutrient sets are all real features
   wired into recipe-renderer.js and the rest of builder-*.js.

   This module encodes the REAL schema (the union of every shape
   the app actually renders/consumes) and tells apart:
     - errors   → would break rendering or break the data model
     - warnings → incomplete / stale / cosmetic, safe to leave,
                  good to tidy up when you touch that file

   Two entry points:
     - validateAllRecipes() : scans the whole collection via
       recipe-index.json + data/recipes/<id>.json, renders a
       report in #validate-panel / #validate-output
     - validateCurrent()    : validates the recipe currently
       loaded/being edited in the form, renders into
       #validate-current-output. Wired into the main update()
       loop so it stays live as you type.

   Depends on: builder-main.js (buildJSON, currentFilename)
   Read-only — never writes to any recipe file. All fixes are
   made by hand in the form and saved by the user, same as
   the existing duplicate-ID / diff tools in builder-checks.js.
========================================================= */

(function () {
    'use strict';

    // ── Optional project folder connection ─────────────────
    // "Load in Editor" (from Validate All / Missing Related) fetches over
    // HTTP by default, so Save has no file handle to write back to and
    // falls back to a download — same as it always has. Connecting the
    // project folder once (Chromium browsers only) lets us pull a real,
    // writable FileSystemFileHandle for data/recipes/<id>.json instead,
    // so Save writes straight back to the exact file it came from — the
    // same behaviour "Load JSON" already gets via showOpenFilePicker.
    var projectRootHandle = null;

    // FileSystemDirectoryHandle objects are structured-cloneable, so they
    // can be stored in IndexedDB and survive a page reload — same approach
    // already used in app.js for the Data Workbench. Browsers still require
    // a permission re-check on every fresh page load (a page can never
    // silently regain filesystem write access with zero user action), but
    // that's a single click with no folder-browsing dialog, not a full
    // reconnect.
    function openHandleDB() {
        return new Promise(function (resolve, reject) {
            var req = indexedDB.open('kitchen-notebook-tool', 1);
            req.onupgradeneeded = function () { req.result.createObjectStore('handles'); };
            req.onsuccess = function () { resolve(req.result); };
            req.onerror = function () { reject(req.error); };
        });
    }
    function saveRootHandleToDB(handle) {
        return openHandleDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction('handles', 'readwrite');
                tx.objectStore('handles').put(handle, 'rootHandle');
                tx.oncomplete = function () { resolve(); };
                tx.onerror = function () { reject(tx.error); };
            });
        });
    }
    function loadRootHandleFromDB() {
        return openHandleDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction('handles', 'readonly');
                var req = tx.objectStore('handles').get('rootHandle');
                req.onsuccess = function () { resolve(req.result || null); };
                req.onerror = function () { reject(req.error); };
            });
        });
    }

    async function checkForRememberedFolder() {
        var handle;
        try {
            handle = await loadRootHandleFromDB();
        } catch (e) { return; } // IndexedDB unavailable — just fall back to manual connect
        if (!handle) return;

        try {
            // Already granted from an earlier session in this browser
            // profile — reconnect completely silently, no click needed.
            var perm = await handle.queryPermission({ mode: 'readwrite' });
            if (perm === 'granted') {
                await finishConnectingFolder(handle);
                return;
            }
        } catch (e) { /* fall through to showing the Reconnect button */ }

        // Permission needs a fresh user gesture — show a one-click
        // Reconnect button instead of silently doing nothing.
        var btn = document.getElementById('reconnect-folder-btn');
        if (btn) {
            btn.textContent = 'Reconnect: ' + handle.name;
            btn.style.display = 'inline-block';
            btn.onclick = async function () {
                try {
                    var perm2 = await handle.requestPermission({ mode: 'readwrite' });
                    if (perm2 !== 'granted') {
                        alert('Permission denied — use Connect Folder instead.');
                        return;
                    }
                    btn.style.display = 'none';
                    await finishConnectingFolder(handle);
                } catch (e) {
                    alert('Could not reconnect: ' + e.message);
                }
            };
        }
    }

    // Shared by both a fresh Connect Folder pick and a remembered-handle
    // reconnect — verifies data/recipes/ resolves and updates the status UI.
    async function finishConnectingFolder(handle) {
        var status = document.getElementById('folder-connect-status');
        try {
            await handle.getDirectoryHandle('data').then(function (d) {
                return d.getDirectoryHandle('recipes');
            });
            projectRootHandle = handle;
            if (status) {
                status.textContent = 'Connected: ' + handle.name + ' — data/recipes found';
                status.style.color = 'var(--copper)';
            }
            if (typeof toast === 'function') toast('Folder connected — saves and tag edits now write straight to disk');
        } catch (e) {
            if (status) {
                status.textContent = 'Connected folder has no data/recipes/ — select your site\'s ROOT folder';
                status.style.color = 'var(--red, #e07060)';
            }
        }
    }

    async function connectProjectFolder() {
        if (!window.showDirectoryPicker) {
            alert('Direct-save requires a Chromium browser (Chrome, Edge, Brave, Opera) served over http(s):// or localhost.');
            return;
        }
        var handle;
        try {
            handle = await window.showDirectoryPicker({ mode: 'readwrite' });
        } catch (e) {
            return; // user cancelled the picker
        }
        await finishConnectingFolder(handle);
        if (projectRootHandle) {
            try { await saveRootHandleToDB(handle); } catch (e) { console.warn('Could not remember folder for next time:', e); }
            var reconnectBtn = document.getElementById('reconnect-folder-btn');
            if (reconnectBtn) reconnectBtn.style.display = 'none';
        } else {
            alert('Could not find a "data/recipes" folder inside what you selected.\n\nMake sure you pick your site\'s root folder — the one that directly contains index.html, data/, json/, js/, and css/ — not recipe-builder.html\'s folder or any subfolder.');
        }
    }

    // Resolves a writable handle for data/recipes/<id>.json from the
    // connected folder. Throws with a specific reason on failure so the
    // caller can tell the user exactly what went wrong, instead of
    // silently falling back to a download and looking like nothing happened.
    async function getRecipeFileHandle(id) {
        if (!projectRootHandle) return null;
        var dataDir = await projectRootHandle.getDirectoryHandle('data');
        var recipesDir = await dataDir.getDirectoryHandle('recipes');
        return await recipesDir.getFileHandle(id + '.json');
    }

    // ── Schema definition ─────────────────────────────────
    var REQUIRED_TOP = [
        'id','title','category','difficulty','description',
        'prepTime','cookTime','totalTime','servings',
        'tags','ingredients','method'
    ];
    var OPTIONAL_TOP = [
        'yieldPerBatch','notes','journal','related',
        'nutrition','lastModified','youWillNeed','equipment'
    ];
    var KNOWN_TOP = REQUIRED_TOP.concat(OPTIONAL_TOP);

    // Fields computeNutrition() always writes — a genuine recipe
    // schema violation if a nutrition object is present but missing these.
    var NUTRITION_CORE = [
        'servings','cal','kj','protein','carbs','sugars',
        'fat','saturated_fat','sodium','coverage'
    ];
    // Fields added once coverage-tracking existed — absence just means
    // the nutrition snapshot predates that and should be refreshed.
    var NUTRITION_META = ['foundCount','totalCount','unmatchedItems'];

    // ── Validate a single recipe object ───────────────────
    // filename (optional): "id.json" — enables the id/filename check.
    function validateRecipe(data, filename) {
        var errors = [];
        var warnings = [];

        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            return { errors: ['Not a valid recipe object'], warnings: [] };
        }

        // Required top-level fields present & non-empty
        REQUIRED_TOP.forEach(function (k) {
            var v = data[k];
            var empty = (v === undefined || v === null || v === '' ||
                        (Array.isArray(v) && v.length === 0));
            if (empty) errors.push('Missing required field: "' + k + '"');
        });

        // Unknown top-level fields (possible typo — not a known variant)
        Object.keys(data).forEach(function (k) {
            if (KNOWN_TOP.indexOf(k) === -1) {
                warnings.push('Unrecognised top-level field "' + k + '" — not read anywhere in the app, check for a typo');
            }
        });

        // id must match its filename
        if (filename) {
            var expectedId = filename.replace(/\.json$/i, '');
            if (data.id && data.id !== expectedId) {
                errors.push('id "' + data.id + '" does not match filename (expected "' + expectedId + '")');
            }
        }

        // tags
        if (data.tags !== undefined && (!Array.isArray(data.tags) || !data.tags.length)) {
            errors.push('tags must be a non-empty array');
        }

        // ── ingredients ────────────────────────────────
        if (!Array.isArray(data.ingredients) || !data.ingredients.length) {
            errors.push('ingredients missing or empty');
        } else {
            data.ingredients.forEach(function (ing, i) {
                if (!ing || typeof ing !== 'object') {
                    errors.push('ingredients[' + i + '] is not an object');
                    return;
                }
                if (ing.heading !== undefined) return; // heading row — nothing else required
                var label = ing.item ? '"' + ing.item + '"' : '(no item)';
                if (!ing.item) errors.push('ingredients[' + i + '] missing "item"');
                if (ing.toTaste) return; // to-taste rows don't need quantity/unit
                if (ing.quantity === undefined || ing.quantity === '') {
                    errors.push('ingredients[' + i + '] ' + label + ' missing "quantity"');
                } else if (typeof ing.quantity !== 'string') {
                    warnings.push('ingredients[' + i + '] ' + label + ' quantity should be a string ("' + ing.quantity + '"), found ' + typeof ing.quantity);
                }
                if (ing.unit === undefined) {
                    errors.push('ingredients[' + i + '] ' + label + ' missing "unit" (use "" for unit-less items like whole eggs)');
                }
            });
        }

        // ── method ─────────────────────────────────────
        if (!Array.isArray(data.method) || !data.method.length) {
            errors.push('method missing or empty');
        } else {
            var stepNum = 0;
            data.method.forEach(function (st, i) {
                if (!st || typeof st !== 'object') {
                    errors.push('method[' + i + '] is not an object');
                    return;
                }
                if (st.heading !== undefined) return; // heading row — no step/instruction needed
                if (!st.instruction) errors.push('method[' + i + '] missing "instruction"');
                stepNum++;
                if (st.step !== stepNum) {
                    errors.push('method[' + i + '] step number is ' + JSON.stringify(st.step) + ', expected ' + stepNum + ' (counting only non-heading steps, in order)');
                }
            });
        }

        // ── notes (optional array) ─────────────────────
        if (data.notes !== undefined) {
            if (!Array.isArray(data.notes)) {
                errors.push('notes present but not an array');
            } else {
                data.notes.forEach(function (n, i) {
                    if (!n || typeof n !== 'object') { errors.push('notes[' + i + '] is not an object'); return; }
                    if (!n.title) warnings.push('notes[' + i + '] missing "title"');
                    if (!n.type) warnings.push('notes[' + i + '] missing "type"');
                    if (!n.content) errors.push('notes[' + i + '] missing "content"');
                });
            }
        }

        // ── journal (optional array) ────────────────────
        if (data.journal !== undefined) {
            if (!Array.isArray(data.journal)) {
                errors.push('journal present but not an array');
            } else {
                data.journal.forEach(function (j, i) {
                    if (!j || typeof j !== 'object') { errors.push('journal[' + i + '] is not an object'); return; }
                    if (!j.date) warnings.push('journal[' + i + '] missing "date"');
                    if (!j.content) errors.push('journal[' + i + '] missing "content"');
                });
            }
        }

        // ── related (optional array) ────────────────────
        if (data.related !== undefined) {
            if (!Array.isArray(data.related)) {
                errors.push('related present but not an array');
            } else {
                data.related.forEach(function (r, i) {
                    if (!r || typeof r !== 'object') { errors.push('related[' + i + '] is not an object'); return; }
                    if (!r.id) errors.push('related[' + i + '] missing "id"');
                    if (!r.title) errors.push('related[' + i + '] missing "title"');
                    if (!r.matchingTags || !r.matchingTags.length) {
                        warnings.push('related[' + i + '] ("' + (r.title || r.id) + '") has no "matchingTags" — harmless on the live recipe page, but shows empty tag chips if reopened here');
                    }
                });
            }
        }

        // ── nutrition (optional object) ─────────────────
        if (data.nutrition === undefined) {
            warnings.push('No nutrition object — open in the builder, click Recalculate, then Save, to add one');
        } else if (typeof data.nutrition !== 'object' || Array.isArray(data.nutrition)) {
            errors.push('nutrition present but not an object');
        } else {
            var missingCore = NUTRITION_CORE.filter(function (k) { return data.nutrition[k] === undefined; });
            if (missingCore.length) {
                errors.push('nutrition missing core field(s): ' + missingCore.join(', '));
            }
            var missingMeta = NUTRITION_META.filter(function (k) { return data.nutrition[k] === undefined; });
            if (missingMeta.length) {
                warnings.push('nutrition looks like an older snapshot (missing ' + missingMeta.join(', ') + ') — Recalculate and re-save to refresh it');
            }
        }

        // lastModified
        if (!data.lastModified) warnings.push('missing "lastModified"');

        return { errors: errors, warnings: warnings };
    }

    // ── Validate the WHOLE collection ─────────────────────
    async function validateAllRecipes() {
        var panel  = document.getElementById('validate-panel');
        var output = document.getElementById('validate-output');
        if (panel) panel.style.display = 'block';
        if (output) output.innerHTML = '<p class="preview-placeholder">Scanning recipe collection…</p>';
        if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

        var index;
        try {
            var res = await fetch('json/recipe-index.json?t=' + Date.now());
            index = await res.json();
        } catch (e) {
            if (output) output.innerHTML = '<p class="diff-note">Could not load json/recipe-index.json</p>';
            return;
        }

        var results = [];
        var errorFiles = 0, warningFiles = 0, cleanFiles = 0;

        for (var i = 0; i < index.length; i++) {
            var id = index[i].id;
            try {
                var r = await fetch('data/recipes/' + id + '.json?t=' + Date.now());
                if (!r.ok) {
                    results.push({ id: id, errors: ['Could not fetch data/recipes/' + id + '.json (HTTP ' + r.status + ')'], warnings: [] });
                    errorFiles++;
                    continue;
                }
                var data = await r.json();
                var v = validateRecipe(data, id + '.json');
                if (v.errors.length || v.warnings.length) {
                    results.push({ id: id, errors: v.errors, warnings: v.warnings });
                    if (v.errors.length) errorFiles++; else warningFiles++;
                } else {
                    cleanFiles++;
                }
            } catch (e) {
                results.push({ id: id, errors: ['Invalid JSON (' + e.message + ')'], warnings: [] });
                errorFiles++;
            }
        }

        renderAllReport(results, index.length, errorFiles, warningFiles, cleanFiles);
    }

    function renderAllReport(results, total, errorFiles, warningFiles, cleanFiles) {
        var output = document.getElementById('validate-output');
        if (!output) return;

        results.sort(function (a, b) {
            if (a.errors.length !== b.errors.length) return b.errors.length - a.errors.length;
            return b.warnings.length - a.warnings.length;
        });

        var html = '<div class="validate-summary">' +
            '<strong>' + total + '</strong> recipes scanned — ' +
            '<span class="v-clean">' + cleanFiles + ' clean</span> · ' +
            '<span class="v-warn">' + warningFiles + ' warnings only</span> · ' +
            '<span class="v-err">' + errorFiles + ' with errors</span>' +
            '</div>';

        if (!results.length) {
            html += '<p class="diff-note diff-clean">Every recipe matches the schema. Nothing to fix.</p>';
        } else {
            results.forEach(function (r) {
                var sev = r.errors.length ? 'v-err' : 'v-warn';
                html += '<div class="validate-file ' + sev + '">' +
                    '<div class="validate-file-name">' +
                    '<span>' + escHtml(r.id) + '.json' +
                    '<span class="validate-count">' +
                        r.errors.length + ' error' + (r.errors.length !== 1 ? 's' : '') + ', ' +
                        r.warnings.length + ' warning' + (r.warnings.length !== 1 ? 's' : '') +
                    '</span></span>' +
                    '<button class="validate-load-btn" onclick="BuilderValidator.loadRecipeForEditing(\'' + escHtml(r.id).replace(/'/g, '&#39;') + '\')">Load in Editor</button>' +
                    '</div>' +
                    '<ul class="validate-issue-list">' +
                    r.errors.map(function (e) { return '<li class="validate-issue-error">' + escHtml(e) + '</li>'; }).join('') +
                    r.warnings.map(function (w) { return '<li class="validate-issue-warning">' + escHtml(w) + '</li>'; }).join('') +
                    '</ul></div>';
            });
        }

        output.innerHTML = html;
    }

    function closeValidateAll() {
        var panel = document.getElementById('validate-panel');
        if (panel) panel.style.display = 'none';
    }

    // ── Find every recipe with no related section ──────────
    async function findMissingRelated() {
        var panel  = document.getElementById('missing-related-panel');
        var output = document.getElementById('missing-related-output');
        if (panel) panel.style.display = 'block';
        if (output) output.innerHTML = '<p class="preview-placeholder">Scanning recipe collection…</p>';
        if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

        var index;
        try {
            var res = await fetch('json/recipe-index.json?t=' + Date.now());
            index = await res.json();
        } catch (e) {
            if (output) output.innerHTML = '<p class="diff-note">Could not load json/recipe-index.json</p>';
            return;
        }

        var missing = [];
        for (var i = 0; i < index.length; i++) {
            var id = index[i].id;
            try {
                var r = await fetch('data/recipes/' + id + '.json?t=' + Date.now());
                if (!r.ok) continue;
                var data = await r.json();
                if (!Array.isArray(data.related) || data.related.length === 0) {
                    missing.push({ id: id, title: data.title || id });
                }
            } catch (e) {
                // skip unreadable files here — Validate All already surfaces those
            }
        }

        renderMissingRelatedReport(missing, index.length);
    }

    function renderMissingRelatedReport(missing, total) {
        var output = document.getElementById('missing-related-output');
        if (!output) return;

        var html = '<div class="validate-summary">' +
            '<strong>' + total + '</strong> recipes scanned — ' +
            '<span class="v-err">' + missing.length + ' missing related</span> · ' +
            '<span class="v-clean">' + (total - missing.length) + ' have related set</span>' +
            '</div>';

        if (!missing.length) {
            html += '<p class="diff-note diff-clean">Every recipe has a related section. Nothing to fix.</p>';
        } else {
            missing.sort(function (a, b) { return a.title.localeCompare(b.title); });
            missing.forEach(function (r) {
                html += '<div class="validate-file v-err">' +
                    '<div class="validate-file-name">' +
                    '<span>' + escHtml(r.title) + ' <span class="validate-count">' + escHtml(r.id) + '.json</span></span>' +
                    '<button class="validate-load-btn" onclick="BuilderValidator.loadRecipeForEditing(\'' + escHtml(r.id).replace(/'/g, '&#39;') + '\')">Load in Editor</button>' +
                    '</div></div>';
            });
        }

        output.innerHTML = html;
    }

    function closeMissingRelated() {
        var panel = document.getElementById('missing-related-panel');
        if (panel) panel.style.display = 'none';
    }

    // ── Manage Tags: scan, select, remove one or everywhere ─
    // tagMap: { "Tag Name": [{id, title, category}, ...] }
    var tagMap = {};

    async function scanAllTags() {
        var panel  = document.getElementById('tags-panel');
        var output = document.getElementById('tags-all-output');
        if (panel) panel.style.display = 'block';
        if (output) output.innerHTML = '<p class="preview-placeholder">Scanning recipe collection…</p>';
        if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        document.getElementById('tags-detail-header').textContent = 'Select a tag above to see its recipes';
        document.getElementById('tags-detail-output').innerHTML = '';

        var index;
        try {
            var res = await fetch('json/recipe-index.json?t=' + Date.now());
            index = await res.json();
        } catch (e) {
            if (output) output.innerHTML = '<p class="diff-note">Could not load json/recipe-index.json</p>';
            return;
        }

        // Read every actual recipe file rather than trusting recipe-index.json's
        // cached tags — that cache can drift out of sync with the real files
        // (edits made before the index-sync fix existed, edits made outside
        // this tool, etc.), and Manage Tags removes things permanently, so it
        // has to work from the truth, not a copy of it.
        tagMap = {};
        var failed = [];
        for (var i = 0; i < index.length; i++) {
            var id = index[i].id;
            try {
                var data = await readRecipeData(id);
                (data.tags || []).forEach(function (t) {
                    if (!tagMap[t]) tagMap[t] = [];
                    tagMap[t].push({ id: id, title: data.title || id, category: data.category || '' });
                });
            } catch (e) {
                failed.push(id);
            }
        }

        renderAllTags();
        if (failed.length && output) {
            output.insertAdjacentHTML('afterbegin', '<p class="diff-note">Could not read: ' + failed.join(', ') + '</p>');
        }
    }

    // Reads a recipe's real current content — via the connected folder's
    // live file handle if available (freshest possible), otherwise a plain
    // HTTP fetch. Shared by the tag scanner so it never trusts a cache.
    async function readRecipeData(id) {
        if (projectRootHandle) {
            try {
                var handle = await getRecipeFileHandle(id);
                if (handle) {
                    var file = await handle.getFile();
                    return JSON.parse(await file.text());
                }
            } catch (e) {
                // fall through to fetch
            }
        }
        var r = await fetch('data/recipes/' + id + '.json?t=' + Date.now());
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return await r.json();
    }

    function renderAllTags() {
        var output = document.getElementById('tags-all-output');
        if (!output) return;

        var names = Object.keys(tagMap).sort(function (a, b) { return a.localeCompare(b); });

        // Feed every known tag into the shared datalist so the swap inputs
        // (bulk and per-recipe) offer real autocomplete against what's
        // actually in use, while still allowing a brand new tag to be typed.
        var datalist = document.getElementById('all-tags-datalist');
        if (datalist) {
            datalist.innerHTML = names.map(function (n) { return '<option value="' + escHtml(n) + '">'; }).join('');
        }

        if (!names.length) {
            output.innerHTML = '<p class="preview-placeholder">No tags found across the collection.</p>';
            return;
        }

        var html = '<div class="tags-grid">';
        names.forEach(function (name) {
            var count = tagMap[name].length;
            html += '<div class="tag-manage-chip">' +
                '<span class="tag-manage-name" onclick="BuilderValidator.selectTag(\'' + escHtml(name).replace(/'/g, '&#39;') + '\')">' +
                    escHtml(name) + ' <span class="tag-manage-count">(' + count + ')</span>' +
                '</span>' +
                '<button class="tag-manage-delete" title="Remove this tag from all ' + count + ' recipes" ' +
                    'onclick="BuilderValidator.deleteTagEverywhere(\'' + escHtml(name).replace(/'/g, '&#39;') + '\')">&times;</button>' +
                '</div>';
        });
        html += '</div>';
        output.innerHTML = html;
    }

    function selectTag(name) {
        var header = document.getElementById('tags-detail-header');
        var output = document.getElementById('tags-detail-output');
        if (!header || !output) return;

        var recipes = tagMap[name] || [];
        header.textContent = '"' + name + '" — used in ' + recipes.length + ' recipe' + (recipes.length !== 1 ? 's' : '');

        if (!recipes.length) {
            output.innerHTML = '<p class="preview-placeholder">This tag has no recipes left — it will disappear on the next scan.</p>';
            return;
        }

        var safeName = escHtml(name).replace(/'/g, '&#39;');
        var html = '<div class="tags-swap-all-bar">' +
            '<span>Swap "' + escHtml(name) + '" for a different tag in all ' + recipes.length + ' recipes:</span>' +
            '<input type="text" list="all-tags-datalist" class="tag-swap-input" id="swap-all-input" placeholder="New tag name…">' +
            '<button class="btn primary" onclick="BuilderValidator.swapTagEverywhere(\'' + safeName + '\', document.getElementById(\'swap-all-input\').value)">Swap in All ' + recipes.length + '</button>' +
            '</div>';

        recipes.slice().sort(function (a, b) { return a.title.localeCompare(b.title); }).forEach(function (r) {
            var rid = escHtml(r.id).replace(/'/g, '&#39;');
            var inputId = 'swap-input-' + r.id.replace(/[^a-zA-Z0-9]/g, '_');
            html += '<div class="validate-file">' +
                '<div class="validate-file-name">' +
                '<span>' + escHtml(r.title) + ' <span class="validate-count">' + escHtml(r.id) + '.json</span></span>' +
                '<span class="tags-row-actions">' +
                '<input type="text" list="all-tags-datalist" class="tag-swap-input" id="' + inputId + '" placeholder="Swap for…">' +
                '<button class="tag-manage-swap-inline" onclick="BuilderValidator.swapTagInRecipe(\'' + rid + '\',\'' + safeName + '\', document.getElementById(\'' + inputId + '\').value)">Swap</button>' +
                '<button class="tag-manage-delete-inline" title="Remove just from this recipe" ' +
                    'onclick="BuilderValidator.removeTagFromRecipe(\'' + rid + '\',\'' + safeName + '\')">Remove</button>' +
                '</span></div></div>';
        });
        output.innerHTML = html;
    }

    // Reads the real recipe file, strips the tag, writes it back, and keeps
    // recipe-index.json's cached copy in sync — same as a normal Save does.
    // Requires a connected project folder; there's no meaningful way to do
    // a multi-file bulk edit through the download-a-copy fallback.
    async function removeTagFromRecipe(id, tagName) {
        var rootHandle = getRootHandleForTags();
        if (!rootHandle) {
            alert('Connect your project folder first — removing tags writes directly to your recipe files and needs real file access.');
            return;
        }
        try {
            var handle = await getRecipeFileHandle(id);
            if (!handle) throw new Error('could not find data/recipes/' + id + '.json');
            var file = await handle.getFile();
            var data = JSON.parse(await file.text());

            data.tags = (data.tags || []).filter(function (t) { return t !== tagName; });

            var w = await handle.createWritable();
            await w.write(JSON.stringify(data, null, 2));
            await w.close();

            if (typeof syncRecipeIndexEntry === 'function') {
                await syncRecipeIndexEntry(id, data);
            }

            // Update local state + UI without a full rescan
            if (tagMap[tagName]) {
                tagMap[tagName] = tagMap[tagName].filter(function (r) { return r.id !== id; });
                if (!tagMap[tagName].length) delete tagMap[tagName];
            }
            renderAllTags();
            selectTag(tagName);
            if (typeof toast === 'function') toast('Removed "' + tagName + '" from ' + id + '.json');
        } catch (e) {
            alert('Could not remove tag: ' + e.message);
        }
    }

    // Reads one recipe file, replaces oldTag with newTag in its tags array
    // (de-duplicating if newTag is already present), writes it back, and
    // syncs recipe-index.json — all in one action instead of remove-then-
    // reopen-then-add-then-save.
    async function swapTagInRecipe(id, oldTag, newTag) {
        newTag = (newTag || '').trim();
        if (!newTag) { alert('Type or pick a tag to swap to first.'); return; }
        var rootHandle = getRootHandleForTags();
        if (!rootHandle) {
            alert('Connect your project folder first — swapping tags writes directly to your recipe files and needs real file access.');
            return;
        }
        try {
            var handle = await getRecipeFileHandle(id);
            if (!handle) throw new Error('could not find data/recipes/' + id + '.json');
            var file = await handle.getFile();
            var data = JSON.parse(await file.text());

            var tags = (data.tags || []).filter(function (t) { return t !== oldTag; });
            if (tags.indexOf(newTag) === -1) tags.push(newTag);
            data.tags = tags;

            var w = await handle.createWritable();
            await w.write(JSON.stringify(data, null, 2));
            await w.close();

            if (typeof syncRecipeIndexEntry === 'function') await syncRecipeIndexEntry(id, data);

            // Move this recipe from the old tag's bucket to the new one
            if (tagMap[oldTag]) {
                var rec = tagMap[oldTag].find(function (r) { return r.id === id; });
                tagMap[oldTag] = tagMap[oldTag].filter(function (r) { return r.id !== id; });
                if (!tagMap[oldTag].length) delete tagMap[oldTag];
                if (rec) {
                    if (!tagMap[newTag]) tagMap[newTag] = [];
                    if (!tagMap[newTag].some(function (r) { return r.id === id; })) tagMap[newTag].push(rec);
                }
            }
            renderAllTags();
            selectTag(oldTag);
            if (typeof toast === 'function') toast('Swapped "' + oldTag + '" → "' + newTag + '" on ' + id + '.json');
        } catch (e) {
            alert('Could not swap tag: ' + e.message);
        }
    }

    async function swapTagEverywhere(oldTag, newTag) {
        newTag = (newTag || '').trim();
        if (!newTag) { alert('Type or pick a tag to swap to first.'); return; }
        var rootHandle = getRootHandleForTags();
        if (!rootHandle) {
            alert('Connect your project folder first — swapping tags writes directly to your recipe files and needs real file access.');
            return;
        }
        var recipes = (tagMap[oldTag] || []).slice();
        if (!recipes.length) return;
        var proceed = confirm('Swap "' + oldTag + '" for "' + newTag + '" in all ' + recipes.length + ' recipes that use it?');
        if (!proceed) return;

        var failed = [];
        for (var i = 0; i < recipes.length; i++) {
            try {
                var handle = await getRecipeFileHandle(recipes[i].id);
                if (!handle) throw new Error('file not found');
                var file = await handle.getFile();
                var data = JSON.parse(await file.text());
                var tags = (data.tags || []).filter(function (t) { return t !== oldTag; });
                if (tags.indexOf(newTag) === -1) tags.push(newTag);
                data.tags = tags;
                var w = await handle.createWritable();
                await w.write(JSON.stringify(data, null, 2));
                await w.close();
                if (typeof syncRecipeIndexEntry === 'function') await syncRecipeIndexEntry(recipes[i].id, data);
            } catch (e) {
                failed.push(recipes[i].id);
            }
        }

        var moved = recipes.filter(function (r) { return failed.indexOf(r.id) === -1; });
        delete tagMap[oldTag];
        if (moved.length) {
            if (!tagMap[newTag]) tagMap[newTag] = [];
            moved.forEach(function (r) {
                if (!tagMap[newTag].some(function (x) { return x.id === r.id; })) tagMap[newTag].push(r);
            });
        }
        renderAllTags();
        document.getElementById('tags-detail-header').textContent = 'Select a tag above to see its recipes';
        document.getElementById('tags-detail-output').innerHTML = '';

        if (failed.length) {
            alert('Swapped ' + moved.length + ' recipes. Failed on: ' + failed.join(', '));
        } else if (typeof toast === 'function') {
            toast('Swapped "' + oldTag + '" → "' + newTag + '" in ' + recipes.length + ' recipes');
        }
    }

    async function deleteTagEverywhere(tagName) {
        var rootHandle = getRootHandleForTags();
        if (!rootHandle) {
            alert('Connect your project folder first — removing tags writes directly to your recipe files and needs real file access.');
            return;
        }
        var recipes = (tagMap[tagName] || []).slice();
        if (!recipes.length) return;
        var proceed = confirm('Remove "' + tagName + '" from all ' + recipes.length + ' recipes that use it? This writes to every one of those files.');
        if (!proceed) return;

        var failed = [];
        for (var i = 0; i < recipes.length; i++) {
            try {
                var handle = await getRecipeFileHandle(recipes[i].id);
                if (!handle) throw new Error('file not found');
                var file = await handle.getFile();
                var data = JSON.parse(await file.text());
                data.tags = (data.tags || []).filter(function (t) { return t !== tagName; });
                var w = await handle.createWritable();
                await w.write(JSON.stringify(data, null, 2));
                await w.close();
                if (typeof syncRecipeIndexEntry === 'function') await syncRecipeIndexEntry(recipes[i].id, data);
            } catch (e) {
                failed.push(recipes[i].id);
            }
        }

        delete tagMap[tagName];
        renderAllTags();
        document.getElementById('tags-detail-header').textContent = 'Select a tag above to see its recipes';
        document.getElementById('tags-detail-output').innerHTML = '';

        if (failed.length) {
            alert('Removed "' + tagName + '" from ' + (recipes.length - failed.length) + ' recipes. Failed on: ' + failed.join(', '));
        } else if (typeof toast === 'function') {
            toast('Removed "' + tagName + '" from ' + recipes.length + ' recipes');
        }
    }

    function getRootHandleForTags() {
        // projectRootHandle is this same module's private variable — just
        // reuse it directly rather than round-tripping through the public
        // getRootHandle() getter.
        return projectRootHandle;
    }

    function closeTagsPanel() {
        var panel = document.getElementById('tags-panel');
        if (panel) panel.style.display = 'none';
    }

    // ── Load a flagged recipe straight into the editor ─────
    // Re-fetches rather than reusing the scan's cached copy, so this
    // always loads whatever is currently on disk — including any fix
    // you already made and saved since the last "Validate All" run.
    async function loadRecipeForEditing(id) {
        if (typeof populateForm !== 'function') {
            alert('Could not find the form loader (populateForm) — is builder-data.js loaded?');
            return;
        }
        try {
            var data, handle = null;

            if (projectRootHandle) {
                try {
                    handle = await getRecipeFileHandle(id);
                } catch (e) {
                    alert('Folder is connected, but couldn\'t find data/recipes/' + id + '.json in it (' + e.message + '). Falling back to loading over HTTP — Save will download instead of writing back.');
                }
            }

            if (handle) {
                var file = await handle.getFile();
                data = JSON.parse(await file.text());
                currentFileHandle = handle; // real, writable — Save goes straight back to this file
            } else {
                var r = await fetch('data/recipes/' + id + '.json?t=' + Date.now());
                if (!r.ok) throw new Error('HTTP ' + r.status);
                data = await r.json();
                currentFileHandle = null; // no folder connected (or it failed above) — Save falls back to a download
            }

            currentFilename = id;
            populateForm(data);

            var modeLabel = document.getElementById('mode-label');
            if (modeLabel) {
                modeLabel.textContent = 'Editing: ' + id + '.json' + (handle ? '' : ' (will download on save)');
                modeLabel.style.color = 'var(--copper)';
            }
            if (typeof toast === 'function') {
                toast(handle
                    ? 'Loaded ' + id + '.json — Save will write straight back to this file'
                    : 'Loaded ' + id + '.json — connect your project folder to save directly, or Save will download a copy');
            }
        } catch (e) {
            alert('Could not load data/recipes/' + id + '.json: ' + e.message);
        }
    }

    // ── Validate the recipe currently in the form ─────────
    function validateCurrent() {
        var output = document.getElementById('validate-current-output');
        var badge  = document.getElementById('validate-current-badge');
        if (!output) return;

        var current = (typeof buildJSON === 'function') ? buildJSON().obj : null;
        if (!current || !current.title) {
            output.innerHTML = '<p class="preview-placeholder">Start filling in the form to see live schema checks.</p>';
            if (badge) badge.style.display = 'none';
            return;
        }

        var filename = (typeof currentFilename !== 'undefined' && currentFilename) ? currentFilename + '.json' : null;
        var v = validateRecipe(current, filename);

        if (badge) {
            if (v.errors.length) {
                badge.textContent = v.errors.length + ' error' + (v.errors.length !== 1 ? 's' : '');
                badge.className = 'validate-badge v-err';
                badge.style.display = 'inline-block';
            } else if (v.warnings.length) {
                badge.textContent = v.warnings.length + ' warning' + (v.warnings.length !== 1 ? 's' : '');
                badge.className = 'validate-badge v-warn';
                badge.style.display = 'inline-block';
            } else {
                badge.textContent = '✓ clean';
                badge.className = 'validate-badge v-clean';
                badge.style.display = 'inline-block';
            }
        }

        if (!v.errors.length && !v.warnings.length) {
            output.innerHTML = '<p class="diff-note diff-clean">Matches the recipe schema.</p>';
            return;
        }

        var html = '<ul class="validate-issue-list">';
        v.errors.forEach(function (e) { html += '<li class="validate-issue-error">' + escHtml(e) + '</li>'; });
        v.warnings.forEach(function (w) { html += '<li class="validate-issue-warning">' + escHtml(w) + '</li>'; });
        html += '</ul>';
        output.innerHTML = html;
    }

    function escHtml(str) {
        return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // ── Init ───────────────────────────────────────────────
    function initValidator() {
        checkForRememberedFolder();

        var allBtn = document.getElementById('validate-all-btn');
        if (allBtn) allBtn.addEventListener('click', validateAllRecipes);

        var closeBtn = document.getElementById('close-validate-btn');
        if (closeBtn) closeBtn.addEventListener('click', closeValidateAll);

        var relatedBtn = document.getElementById('missing-related-btn');
        if (relatedBtn) relatedBtn.addEventListener('click', findMissingRelated);

        var closeRelatedBtn = document.getElementById('close-missing-related-btn');
        if (closeRelatedBtn) closeRelatedBtn.addEventListener('click', closeMissingRelated);

        var connectBtn = document.getElementById('connect-folder-btn');
        if (connectBtn) connectBtn.addEventListener('click', connectProjectFolder);

        var tagsBtn = document.getElementById('manage-tags-btn');
        if (tagsBtn) tagsBtn.addEventListener('click', scanAllTags);

        var closeTagsBtn = document.getElementById('close-tags-btn');
        if (closeTagsBtn) closeTagsBtn.addEventListener('click', closeTagsPanel);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initValidator);
    } else {
        initValidator();
    }

    // Expose API — validateCurrent is called from builder-main.js's update()
    window.BuilderValidator = {
        validateRecipe:    validateRecipe,
        validateAllRecipes: validateAllRecipes,
        validateCurrent:   validateCurrent,
        closeValidateAll:  closeValidateAll,
        loadRecipeForEditing: loadRecipeForEditing,
        findMissingRelated: findMissingRelated,
        closeMissingRelated: closeMissingRelated,
        connectProjectFolder: connectProjectFolder,
        getRootHandle: function () { return projectRootHandle; },
        scanAllTags: scanAllTags,
        selectTag: selectTag,
        removeTagFromRecipe: removeTagFromRecipe,
        deleteTagEverywhere: deleteTagEverywhere,
        swapTagInRecipe: swapTagInRecipe,
        swapTagEverywhere: swapTagEverywhere,
        closeTagsPanel: closeTagsPanel
    };

})();
