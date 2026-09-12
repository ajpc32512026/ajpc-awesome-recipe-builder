/* =========================================================
   BUILDER DATA — JSON Build, File IO, Nav Snippet
   Depends on globals: tags, currentFilename, currentFileHandle,
                       NUTRITION_DB (all from builder-main.js)
========================================================= */

// ── Build JSON Object ─────────────────────────────────────
function buildJSON() {
    const title = val('title');
    if (!title) return { obj: {}, id: '', title: '' };

    // Preserve the original loaded file's id whenever one exists, instead of
    // recalculating from whatever's currently in the Title field. Without
    // this, editing an existing recipe's title (even just fixing a typo)
    // silently drifts the id field inside the saved JSON away from the
    // file's actual name on disk - the file itself stays correctly named
    // (saveJSON writes back to the original file handle regardless), but
    // the id INSIDE that file no longer matches its own filename.
    let id;
    if (currentFilename) {
        id = currentFilename;
    } else {
        // Brand-new recipe, nothing loaded yet - id has to come from
        // somewhere, so it's generated live from the title as you type.
        id = title.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, '').trim();
    }

    const obj = { id, title };

    // Optional top-level fields — only include if they have values
    const optFields = ['category','difficulty','description',
                       'prepTime','cookTime','totalTime','servings','yieldPerBatch'];
    optFields.forEach(f => { const v = val(f); if (v) obj[f] = v; });

    if (tags.length) obj.tags = [...tags];

    // ── Ingredients ──
    obj.ingredients = [];
    document.querySelectorAll('#ingredients-list > div').forEach(row => {
        if (row.classList.contains('ingredient-heading-row')) {
            const v = row.querySelector('input')?.value.trim();
            if (v) obj.ingredients.push({ heading: v });

        } else if (row.classList.contains('ingredient-totaste-row')) {
            const inputs = row.querySelectorAll('input');
            const item   = (inputs[0]?.value || '').trim();
            if (!item) return;
            const entry  = { item: toTitleCase(item), toTaste: true };
            const note   = (inputs[1]?.value || '').trim();
            if (note) entry.notes = note;
            obj.ingredients.push(entry);

        } else if (row.classList.contains('ingredient-row')) {
            const inputs = row.querySelectorAll('input');
            const item   = toTitleCase((inputs[2]?.value || '').trim());
            if (!item) return;
            const entry  = {
                quantity: (inputs[0]?.value || '').trim(),
                unit:     (inputs[1]?.value || '').trim(),
                item
            };
            const notes = (inputs[3]?.value || '').trim();
            if (notes) entry.notes = notes;
            obj.ingredients.push(entry);
        }
    });

    // ── You Will Also Need ──
    obj.youWillNeed = [];
    document.querySelectorAll('#equipment-list .equipment-item-row').forEach(row => {
        const inputs = row.querySelectorAll('input');
        const item   = (inputs[0]?.value || '').trim();
        if (!item) return;
        const entry  = { item };
        const note   = (inputs[1]?.value || '').trim();
        if (note) entry.note = note;
        obj.youWillNeed.push(entry);
    });
    if (!obj.youWillNeed.length) delete obj.youWillNeed;

    // ── Method ──
    obj.method = [];
    let stepNum = 0;
    document.querySelectorAll('#steps-list > div').forEach(row => {
        if (row.classList.contains('step-heading-row')) {
            const v = row.querySelector('input')?.value.trim();
            if (v) obj.method.push({ heading: v });
        } else if (row.classList.contains('step-row')) {
            const txt = row.querySelector('textarea')?.value.trim();
            if (txt) obj.method.push({ step: ++stepNum, instruction: txt });
        }
    });
    if (!obj.method.length) delete obj.method;

    // ── Notes ──
    const noteRows = document.querySelectorAll('#notes-list .note-row');
    if (noteRows.length) {
        obj.notes = [];
        noteRows.forEach(row => {
            const type    = row.querySelector('select')?.value || 'tip';
            const noteTitle = row.querySelector('input')?.value.trim() || '';
            const content = row.querySelector('textarea')?.value.trim() || '';
            if (noteTitle || content) obj.notes.push({ type, title: noteTitle, content });
        });
        if (!obj.notes.length) delete obj.notes;
    }

    // ── Journal ──
    const journalRows = document.querySelectorAll('#journal-list .journal-row');
    if (journalRows.length) {
        obj.journal = [];
        journalRows.forEach(row => {
            const date    = row.querySelector('input[type="date"]')?.value || '';
            const content = row.querySelector('textarea')?.value.trim() || '';
            if (content) obj.journal.push({ date, content });
        });
        if (!obj.journal.length) delete obj.journal;
    }

    // ── Related Recipes ──
    // Was previously never read back out of #related-list, so anything
    // added via the Related Recipes UI was silently lost on save even
    // though populateForm() (below) does read data.related back in when
    // loading a file. Each row's id/title/matchingTags are stashed on
    // its dataset by loadRelatedRecipe() in builder-ui.js.
    const relatedRows = document.querySelectorAll('#related-list .related-row');
    if (relatedRows.length) {
        obj.related = [];
        relatedRows.forEach(row => {
            const id = row.dataset.id || '';
            if (!id) return;
            let matchingTags = [];
            try { matchingTags = JSON.parse(row.dataset.tags || '[]'); } catch(e) { /* leave empty */ }
            obj.related.push({
                id,
                title: row.dataset.title || id,
                matchingTags
            });
        });
        if (!obj.related.length) delete obj.related;
    }

    // ── Nutrition ──
    // computeNutrition is defined in builder-nutrition.js.
    // It returns null if NUTRITION_DB is not yet loaded or no ingredients match.
    // Guard with typeof so buildJSON() still works during the async load window.
    if (typeof computeNutrition === 'function' && obj.ingredients && obj.ingredients.length) {
        const servingsNum = parseInt(obj.servings) || 1;
        const n = computeNutrition(obj.ingredients, servingsNum);
        if (n) obj.nutrition = n;
    }

    // ── Timestamp ──
    obj.lastModified = new Date().toISOString().split('T')[0];

    return { obj, id, title };
}

// ── File IO ───────────────────────────────────────────────
async function openJSONFile() {
    if (window.showOpenFilePicker) {
        try {
            const [handle] = await window.showOpenFilePicker({
                types: [{ description: 'Recipe JSON', accept: { 'application/json': ['.json'] } }],
                multiple: false
            });
            currentFileHandle = handle;
            const file = await handle.getFile();
            currentFilename = file.name.replace(/\.json$/i, '');
            populateForm(JSON.parse(await file.text()));
            document.getElementById('mode-label').textContent = 'Editing: ' + file.name;
            document.getElementById('mode-label').style.color = 'var(--copper)';
            toast('Loaded: ' + file.name);
        } catch(e) { /* User cancelled */ }
    } else {
        document.getElementById('load-file').click();
    }
}

function loadJSONFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
        try {
            const data = JSON.parse(e.target.result);
            currentFilename = file.name.replace(/\.json$/i, '');
            populateForm(data);
            document.getElementById('mode-label').textContent = 'Editing: ' + file.name;
            document.getElementById('mode-label').style.color = 'var(--copper)';
            toast('Loaded: ' + file.name);
        } catch(err) { alert('Could not parse JSON: ' + err.message); }
    };
    reader.readAsText(file);
    event.target.value = '';
}

function populateForm(data) {
    // Clear dynamic lists
    document.querySelectorAll('.dynamic-list').forEach(l => l.innerHTML = '');
    tags = [];

    // Reset selects
    document.querySelectorAll('select').forEach(s => s.selectedIndex = 0);

    // Plain text fields
    ['title','description','prepTime','cookTime','totalTime','servings','yieldPerBatch'].forEach(f => {
        const el = document.getElementById(f);
        if (el) el.value = data[f] || '';
    });

    // Selects
    ['category','difficulty'].forEach(f => {
        const el = document.getElementById(f);
        if (!el) return;
        for (let i = 0; i < el.options.length; i++) {
            if (el.options[i].text === data[f] || el.options[i].value === data[f]) {
                el.selectedIndex = i; break;
            }
        }
    });

    // Emoji

    // Tags
    if (Array.isArray(data.tags)) { tags = [...data.tags]; renderTags(); }

    // Ingredients
    (data.ingredients || []).forEach(ing => {
        if (ing.heading) addIngredientHeading(ing.heading);
        else if (ing.toTaste) addToTaste(toTitleCase(ing.item || ''), ing.notes || '');
        else addIngredient(ing.quantity || '', ing.unit || '', toTitleCase(ing.item || ing.name || ''), ing.notes || '');
    });

    // Equipment / You Will Also Need
    (data.youWillNeed || data.equipment || []).forEach(e => {
        addEquipmentItem(e.item || e, e.note || '');
    });

    // Method
    (data.method || []).forEach(m => {
        if (m.heading) addStepHeading(m.heading);
        else addStep(m.instruction || m.text || '');
    });

    // Notes
    (data.notes || []).forEach(n => addNote(n.type || 'tip', n.title || '', n.content || ''));

    // Journal
    (data.journal || []).forEach(j => addJournalEntry(j.date || '', j.content || ''));

 (data.related || []).forEach(r => {
        if (typeof window.loadRelatedRecipe === 'function') {
            // Note: handles both 'matchingTags' and old 'tags' key
            window.loadRelatedRecipe(r.id, r.title || r.name || r.id, r.matchingTags || r.tags || []);
        }
    });
    window.scrollTo(0, 0);
    update();

    // Snapshot for diff view — must run after update() so buildJSON() reflects populated state
    if (window.BuilderChecks) window.BuilderChecks.snapshotLoaded(data);
}

// ── Nav Snippet ───────────────────────────────────────────
function buildNavSnippet(id, title, category) {
    if (!id || !title || !category) return { snippet: '', note: '' };
    const groupMap = {
        'Breads': 'Bread', 'Pizza': 'Bread',
        'Dessert': 'Dessert', 'Desserts': 'Dessert', 'Biscuits': 'Biscuits',
        'Sauces': 'Sauces',
        'Pasta': 'Pasta', 'Dinner': 'Dinner', 'Mains': 'Dinner',
        'Soups': 'Soups', 'Salads': 'Salads', 'Sides': 'Sides',
        'Snacks': 'Snacks', 'Bistro': 'Dinner', 'Entree': 'Entree',
        'Filipino': 'Filipino', 'Breakfast': 'Breakfast',
		'Lunch': 'Lunch'
    };
    const group = groupMap[category] || 'Other';
    const link  = `<a href="recipe.html?id=${id}" role="menuitem" aria-label="${title.replace(/"/g,'&quot;')} recipe">${title}</a>`;
    return {
        snippet: `<!-- Add inside the ${group} dropdown -->\n${link}`,
        note:    `Nav group: <strong>${group}</strong>`
    };
}

// ── Highlight ─────────────────────────────────────────────
function highlight(json) {
    return json
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, m => {
            if (/^"/.test(m)) return `<span class="${/:$/.test(m) ? 'j-key' : 'j-str'}">${m}</span>`;
            if (/true|false/.test(m)) return `<span class="j-bool">${m}</span>`;
            if (/null/.test(m))       return `<span class="j-null">${m}</span>`;
            return `<span class="j-num">${m}</span>`;
        });
}

function highlightHTML(h) {
    return h
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/(&lt;!--.*?--&gt;)/g, '<span class="h-comment">$1</span>')
        .replace(/(&lt;\/?[a-z][a-z0-9]*)/gi, '<span class="h-tag">$1</span>')
        .replace(/&gt;/g, '<span class="h-tag">&gt;</span>');
}

// ── Save / Download / Copy ────────────────────────────────
// For a brand-new recipe (nothing loaded from disk yet), the id is
// recalculated live from whatever's currently in the Title field every
// time buildJSON() runs - there's no original filename to protect it.
// This gives one last visible checkpoint before that id becomes a
// permanent filename, so accidental/mid-typing text can't slip through
// silently. Already-loaded recipes never see this - currentFilename
// locks their id (see buildJSON above), so this always returns true then.
function confirmNewRecipeId(id) {
    if (currentFilename) return true;
    return confirm(`This will create a NEW recipe file:\n\n${id || '(empty)'}.json\n\nIs this the correct id? (It's generated from the Title field above.)`);
}

// Rows with no text in their main field (a heading typed then cleared, an
// ingredient added then abandoned, etc.) get silently skipped when the JSON
// is built — by design, so half-started rows don't clutter saved files. But
// "silently" is the risk: if a heading got accidentally blanked, that's a
// real loss with zero warning. This catches it before Save, not after.
function findBlankRows() {
    const blanks = [];
    document.querySelectorAll('#ingredients-list > div').forEach((row, i) => {
        if (row.classList.contains('ingredient-heading-row')) {
            if (!row.querySelector('input')?.value.trim()) blanks.push('Ingredient heading (row ' + (i+1) + ')');
        } else if (row.classList.contains('ingredient-row') || row.classList.contains('ingredient-totaste-row')) {
            const items = row.querySelectorAll('input');
            const itemField = row.classList.contains('ingredient-totaste-row') ? items[0] : items[2];
            if (itemField && !itemField.value.trim()) blanks.push('Ingredient (row ' + (i+1) + ')');
        }
    });
    document.querySelectorAll('#method-list > div').forEach((row, i) => {
        if (row.classList.contains('step-heading-row')) {
            if (!row.querySelector('input')?.value.trim()) blanks.push('Method heading (row ' + (i+1) + ')');
        }
    });
    return blanks;
}

async function saveJSON() {
    if (!checkRequiredFields()) return;
    const blanks = findBlankRows();
    if (blanks.length) {
        const proceed = confirm(
            'These rows have no text and will be permanently removed if you continue:\n\n' +
            blanks.join('\n') +
            '\n\nSave anyway?'
        );
        if (!proceed) return;
    }
    const { obj, id } = buildJSON();
    if (!obj.title) return;
    const json = JSON.stringify(obj, null, 2);
    if (currentFileHandle) {
        try {
            const w = await currentFileHandle.createWritable();
            await w.write(json); await w.close();
            const indexSynced = await syncRecipeIndexEntry(id, obj);
            toast('Saved to ' + currentFileHandle.name + (indexSynced ? ' · index updated' : ''));
            const btn = document.getElementById('save-btn');
            if (btn) {
                const original = btn.textContent;
                btn.textContent = '✓ Saved!';
                btn.style.background = '#3a7a4e';
                setTimeout(() => { btn.textContent = original; btn.style.background = ''; }, 1800);
            }
        } catch(e) { alert('Could not save: ' + e.message); }
    } else {
        if (!confirmNewRecipeId(id)) return;
        downloadJSON(true); // already confirmed above, don't ask twice
    }
}

// recipe-index.json is a separate cached summary (id/title/category/tags)
// that the homepage, tag browsing, search, and "What Can I Cook" all read
// from — it's never been kept in sync with edits made here, so a tag
// change could be correctly saved to the recipe file and still be
// invisible everywhere else on the site. This patches just this recipe's
// entry in the index right after the file itself saves successfully, so
// the two can't drift apart again. Only runs when a project folder is
// connected (needs a real handle to json/recipe-index.json); silently
// does nothing otherwise; a save-file-only edit still works exactly as
// it always has, this is purely additive.
async function syncRecipeIndexEntry(id, obj) {
    const rootHandle = window.BuilderValidator && window.BuilderValidator.getRootHandle();
    if (!rootHandle) return false;
    try {
        const jsonDir = await rootHandle.getDirectoryHandle('json');
        const indexHandle = await jsonDir.getFileHandle('recipe-index.json');
        const file = await indexHandle.getFile();
        const index = JSON.parse(await file.text());

        // Merge onto whatever's already there instead of replacing the whole
        // entry — recipe-index.json has grown fields over time (description,
        // difficulty, an embedded ingredients list that search.js reads
        // directly) that this function predates. Replacing wholesale was
        // silently deleting any of those it didn't know about on every save.
        const i = index.findIndex(r => r.id === id);
        const existing = i >= 0 ? index[i] : {};
        const entry = Object.assign({}, existing, {
            id,
            title: obj.title,
            category: obj.category || '',
            tags: obj.tags || [],
            description: obj.description !== undefined ? obj.description : existing.description,
            difficulty: obj.difficulty !== undefined ? obj.difficulty : existing.difficulty,
            ingredients: Array.isArray(obj.ingredients)
                ? obj.ingredients.filter(ing => ing && ing.item).map(ing => ({ item: ing.item }))
                : existing.ingredients
        });
        if (i >= 0) index[i] = entry; else index.push(entry);

        const w = await indexHandle.createWritable();
        await w.write(JSON.stringify(index, null, 2));
        await w.close();
        return true;
    } catch (e) {
        // Folder connected but json/recipe-index.json didn't resolve, or
        // some other hiccup — the recipe file itself already saved fine
        // above, so this only warns rather than treating it as a failure.
        console.warn('Could not sync recipe-index.json:', e.message);
        return false;
    }
}

function downloadJSON(alreadyConfirmed) {
    if (!checkRequiredFields()) return;
    if (!alreadyConfirmed) {
        const blanks = findBlankRows();
        if (blanks.length) {
            const proceed = confirm(
                'These rows have no text and will be permanently removed if you continue:\n\n' +
                blanks.join('\n') +
                '\n\nSave anyway?'
            );
            if (!proceed) return;
        }
    }
    const { obj, id } = buildJSON();
    if (!obj.title) return;
    if (!alreadyConfirmed && !confirmNewRecipeId(id)) return;
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (currentFilename || id || 'recipe') + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
}

function copyJSON() {
    navigator.clipboard.writeText(document.getElementById('json-output')?.innerText || '')
        .then(() => toast('JSON copied!'))
        .catch(() => toast('Copy failed'));
}

function copyNav() {
    const el = document.getElementById('nav-output');
    if (!el || !el.innerText.trim() || el.innerText.includes('waiting')) {
        toast('Add title & category first');
        return;
    }
    const linkLine = el.innerText.split('\n').find(l => l.trim().startsWith('<a ')) || el.innerText;
    navigator.clipboard.writeText(linkLine).then(() => toast('Nav link copied!'));
}

// ── Required Field Check ──────────────────────────────────
function checkRequiredFields() {
    const missing = [];
    if (!val('title'))      missing.push('Recipe Title');
    if (!val('category'))   missing.push('Category');
    if (!val('difficulty')) missing.push('Difficulty');
    if (!val('description'))missing.push('Description');

    if (!missing.length) return true;

    toast('Required fields missing: ' + missing.join(', '));
    missing.forEach(label => {
        const map = { 'Recipe Title': 'title', 'Category': 'category', 'Difficulty': 'difficulty', 'Description': 'description' };
        const el = document.getElementById(map[label]);
        if (!el) return;
        el.style.borderColor = 'var(--red)';
        el.style.backgroundColor = 'rgba(192,57,43,0.1)';
        setTimeout(() => { el.style.borderColor = ''; el.style.backgroundColor = ''; }, 2000);
    });
    return false;
}
