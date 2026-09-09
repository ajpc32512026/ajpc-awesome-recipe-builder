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
            var r = await fetch('data/recipes/' + id + '.json?t=' + Date.now());
            if (!r.ok) throw new Error('HTTP ' + r.status);
            var data = await r.json();

            currentFilename = id;
            currentFileHandle = null; // fetched over HTTP, not picked via the file system — Save falls back to a normal download rather than silently overwriting anything
            populateForm(data);

            var modeLabel = document.getElementById('mode-label');
            if (modeLabel) {
                modeLabel.textContent = 'Editing: ' + id + '.json';
                modeLabel.style.color = 'var(--copper)';
            }
            if (typeof toast === 'function') toast('Loaded ' + id + '.json — fix flagged issues, then Save');
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
        var allBtn = document.getElementById('validate-all-btn');
        if (allBtn) allBtn.addEventListener('click', validateAllRecipes);

        var closeBtn = document.getElementById('close-validate-btn');
        if (closeBtn) closeBtn.addEventListener('click', closeValidateAll);
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
        loadRecipeForEditing: loadRecipeForEditing
    };

})();
