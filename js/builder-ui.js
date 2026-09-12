/* =========================================================
   BUILDER UI — Row Management, Modals, Drag-and-Drop
   Depends on globals: tags, recipeIndex (builder-main.js)
========================================================= */

// ── Ingredients ───────────────────────────────────────────
function addIngredient(qty='', unit='', item='', notes='') {
    const list = document.getElementById('ingredients-list');
    if (!list) return;
    const row = document.createElement('div');
    row.className = 'ingredient-row';
    row.draggable = true;
    row.innerHTML = `
        <div class="drag-handle">⋮⋮</div>
        <input type="text" placeholder="Qty"   value="${escHtml(qty)}"   oninput="update()">
        <input type="text" placeholder="Unit"  value="${escHtml(unit)}"  oninput="update()">
        <input type="text" placeholder="Item"  value="${escHtml(item)}"  oninput="update()">
        <input type="text" placeholder="Notes (optional)" value="${escHtml(notes)}" oninput="update()">
        <button class="btn danger" onclick="removeRow(this)">✕</button>
    `;
    setupDragEvents(row, 'ingredients-list');
    list.appendChild(row);
    if (!qty && !item) row.querySelector('input').focus();
    update();
}

function addToTaste(item='', notes='') {
    const list = document.getElementById('ingredients-list');
    if (!list) return;
    const row = document.createElement('div');
    row.className = 'ingredient-totaste-row';
    row.draggable = true;
    row.innerHTML = `
        <div class="drag-handle">⋮⋮</div>
        <span class="ingredient-totaste-badge">To Taste</span>
        <input type="text" placeholder="e.g. Salt &amp; Pepper" value="${escHtml(item)}" oninput="update()">
        <input type="text" placeholder="Note (optional)" value="${escHtml(notes)}" oninput="update()" class="notes-input">
        <button class="btn danger" onclick="removeRow(this)">✕</button>
    `;
    setupDragEvents(row, 'ingredients-list');
    list.appendChild(row);
    if (!item) row.querySelector('input').focus();
    update();
}

function addIngredientHeading(heading='') {
    const list = document.getElementById('ingredients-list');
    if (!list) return;
    const row = document.createElement('div');
    row.className = 'ingredient-heading-row';
    row.draggable = true;
    row.innerHTML = `
        <div class="drag-handle">⋮⋮</div>
        <input type="text" class="ingredient-heading-input" value="${escHtml(heading)}" oninput="update()" placeholder="e.g. For the Base, For the Filling…">
        <button class="btn danger" onclick="removeRow(this)">✕</button>
    `;
    setupDragEvents(row, 'ingredients-list');
    list.appendChild(row);
    if (!heading) row.querySelector('input').focus();
    update();
}

// ── Equipment / You Will Also Need ────────────────────────
function addEquipmentItem(item='', notes='') {
    const list = document.getElementById('equipment-list');
    if (!list) return;
    const row = document.createElement('div');
    row.className = 'equipment-item-row';
    row.draggable = true;
    row.innerHTML = `
        <div class="drag-handle">⋮⋮</div>
        <input type="text" value="${escHtml(item)}"  placeholder="Item" oninput="update()">
        <input type="text" value="${escHtml(notes)}" placeholder="Note (optional)" oninput="update()" class="notes-input">
        <button class="btn danger" onclick="removeRow(this); update()">✕</button>
    `;
    setupDragEvents(row, 'equipment-list');
    list.appendChild(row);
    update();
}

// Handler when pressing Enter on the equipment input
function handleEquipmentEnter(e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        const input = e.target;
        const value = input.value.trim();
        if (!value) return;

        const parts = value.split('|');
        const item = parts[0].trim();
        const notes = parts[1] ? parts[1].trim() : '';

        if (item) {
            addEquipmentItem(item, notes);
            input.value = '';
            const dropdown = input.parentNode.querySelector('.autocomplete-dropdown');
            if (dropdown) dropdown.style.display = 'none';
        }
    }
}

// Autocomplete Event Handlers
function handleEquipmentAutocompleteInput(input) {
    const query = input.value.toLowerCase().trim();
    const dropdown = input.parentNode.querySelector('.autocomplete-dropdown');
    if (!dropdown) return;

    if (!query) {
        dropdown.style.display = 'none';
        return;
    }

    const commonEquipment = [
        'baking paper', 'baking tray', 'rolling pin', 'parchment paper',
        'mixing bowl', 'whisk', 'silicone spatula', 'wire rack', 'pie dish',
        'cake tin', 'loaf pan', 'cling wrap', 'aluminum foil', 'pastry brush'
    ];

    const nutritionKeys = typeof NUTRITION_DB !== 'undefined' ? Object.keys(NUTRITION_DB) : [];
    const allSuggestions = [...new Set([...commonEquipment, ...nutritionKeys])];

    const matches = allSuggestions
        .filter(item => item.toLowerCase().includes(query))
        .slice(0, 5);

    if (matches.length === 0) {
        dropdown.style.display = 'none';
        return;
    }

    dropdown.innerHTML = matches.map(m => {
        const titleCaseName = typeof toTitleCase === 'function' ? toTitleCase(m) : m;
        return `<div class="autocomplete-item" style="padding: 8px 12px; cursor: pointer; border-bottom: 1px solid rgba(255,255,255,0.05);" onmousedown="selectEquipmentAutocomplete('${escHtml(titleCaseName)}')">${escHtml(titleCaseName)}</div>`;
    }).join('');
    dropdown.style.display = 'block';
}

function selectEquipmentAutocomplete(value) {
    const input = document.getElementById('equipment-input');
    if (!input) return;
    input.value = value + ' | ';
    input.focus();
    const dropdown = input.parentNode.querySelector('.autocomplete-dropdown');
    if (dropdown) dropdown.style.display = 'none';
}

function handleEquipmentAutocompleteFocus(input) {
    if (input.value.trim()) {
        handleEquipmentAutocompleteInput(input);
    }
}

function handleEquipmentAutocompleteBlur(input) {
    setTimeout(() => {
        const dropdown = input.parentNode.querySelector('.autocomplete-dropdown');
        if (dropdown) dropdown.style.display = 'none';
    }, 250);
}

function handleEquipmentAutocompleteKeydown(e, input) {
    // Handled primary via handleEquipmentEnter
}

// ── Method ────────────────────────────────────────────────
function addStep(text='', insertAfter=null) {
    const list = document.getElementById('steps-list');
    if (!list) return;
    const row = document.createElement('div');
    row.className = 'step-row';
    row.draggable = true;
    row.innerHTML = `
        <div class="step-num-handle">
            <span class="step-num"></span>
            <div class="drag-handle">⋮⋮</div>
        </div>
        <textarea placeholder="Describe this step…" oninput="autoResize(this); update()" onkeydown="stepEnterKey(event,this)">${escHtml(text)}</textarea>
        <button class="btn danger" onclick="removeRow(this); renumberSteps()">✕</button>
    `;
    setupDragEvents(row, 'steps-list', renumberSteps);
    if (insertAfter) insertAfter.parentNode.insertBefore(row, insertAfter.nextSibling);
    else list.appendChild(row);
    renumberSteps();
    const ta = row.querySelector('textarea');
    autoResize(ta);
    if (!text) ta.focus();
}

function stepEnterKey(e, ta) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        addStep('', ta.closest('.step-row'));
    }
}

function addStepHeading(heading='') {
    const list = document.getElementById('steps-list');
    if (!list) return;
    const row = document.createElement('div');
    row.className = 'step-heading-row';
    row.draggable = true;
    row.innerHTML = `
        <div class="drag-handle">⋮⋮</div>
        <input type="text" placeholder="e.g. Make the Sauce, To Serve…" value="${escHtml(heading)}" oninput="update()">
        <button class="btn danger" onclick="removeRow(this); renumberSteps()">✕</button>
    `;
    setupDragEvents(row, 'steps-list', renumberSteps);
    list.appendChild(row);
    if (!heading) row.querySelector('input').focus();
    update();
}

function renumberSteps() {
    let n = 0;
    document.querySelectorAll('#steps-list .step-row').forEach(row => {
        const el = row.querySelector('.step-num');
        if (el) el.textContent = ++n;
    });
    update();
}

// ── Notes ─────────────────────────────────────────────────
function addNote(type='tip', title='', content='') {
    const list = document.getElementById('notes-list');
    if (!list) return;
    const row = document.createElement('div');
    row.className = 'note-row';
    row.draggable = true;
    row.innerHTML = `
        <div class="drag-handle">⋮⋮</div>
        <select onchange="update()">
            <option value="acknowledgement" ${type==='acknowledgement'?'selected':''}>Acknowledgement</option>
            <option value="serving"         ${type==='serving'?'selected':''}>Serving</option>
            <option value="technique"       ${type==='technique'?'selected':''}>Technique</option>
            <option value="storage"         ${type==='storage'?'selected':''}>Storage</option>
            <option value="substitution"    ${type==='substitution'?'selected':''}>Substitution</option>
            <option value="variation"       ${type==='variation'?'selected':''}>Variation</option>
            <option value="tip"             ${type==='tip'?'selected':''}>Tip</option>
        </select>
        <div class="note-inner">
            <input type="text" placeholder="Title" value="${escHtml(title)}" oninput="update()">
            <textarea placeholder="Content…" oninput="autoResize(this); update()">${escHtml(content)}</textarea>
        </div>
        <button class="btn danger" onclick="removeRow(this)">✕</button>
    `;
    setupDragEvents(row, 'notes-list');
    list.appendChild(row);
    autoResize(row.querySelector('textarea'));
    update();
}

// ── Journal ───────────────────────────────────────────────
function addJournalEntry(date='', content='') {
    const list = document.getElementById('journal-list');
    if (!list) return;
    const row = document.createElement('div');
    row.className = 'journal-row';
    row.draggable = true;
    row.innerHTML = `
        <div class="drag-handle">⋮⋮</div>
        <input type="date" value="${date || new Date().toISOString().split('T')[0]}" oninput="update()">
        <textarea placeholder="What did you try? How did it turn out?" oninput="autoResize(this); update()">${escHtml(content)}</textarea>
        <button class="btn danger" onclick="removeRow(this)">✕</button>
    `;
    setupDragEvents(row, 'journal-list');
    list.appendChild(row);
    autoResize(row.querySelector('textarea'));
    update();
}

// ── Tags ──────────────────────────────────────────────────
function handleTagKey(e) {
    if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        const v = e.target.value.replace(/,/g, '').trim();
        if (v && !tags.includes(v)) { tags.push(v); renderTags(); update(); }
        e.target.value = '';
    } else if (e.key === 'Backspace' && e.target.value === '' && tags.length) {
        tags.pop(); renderTags(); update();
    }
}

function renderTags() {
    const wrap  = document.getElementById('tags-wrap');
    const input = document.getElementById('tag-input');
    if (!wrap || !input) return;
    wrap.querySelectorAll('.tag-chip').forEach(c => c.remove());
    tags.forEach((t, i) => {
        const chip = document.createElement('div');
        chip.className = 'tag-chip';
        chip.innerHTML = `${escHtml(t)}<button onclick="removeTag(${i})">×</button>`;
        wrap.insertBefore(chip, input);
    });
}

function removeTag(i) { tags.splice(i, 1); renderTags(); update(); }

// ── Duplication & Form Management ─────────────────────────
function duplicateRecipe() {
    const dupe = JSON.parse(JSON.stringify(buildJSON().obj));
    dupe.title = (dupe.title || 'Recipe') + ' (Copy)';
    dupe.id    = dupe.title.toLowerCase().replace(/[^a-z0-9]/g, '');
    clearForm(true);
    populateForm(dupe);
    document.getElementById('mode-label').textContent = 'Duplicated — Edit & Save';
    document.getElementById('mode-label').style.color = 'var(--copper)';
    toast('Recipe duplicated!');
    document.getElementById('title').focus();
    document.getElementById('title').select();
}

function updateDuplicateButton() {
    const { obj } = buildJSON();
    const btn = document.getElementById('duplicate-btn');
    if (btn) btn.style.display = (obj.title || (obj.ingredients && obj.ingredients.length)) ? '' : 'none';
}

// ── Utility Helpers ───────────────────────────────────────
function removeRow(btn) {
    const row = btn.parentElement;
    if (row && row !== document.body) {
        row.remove();
        update();
    }
}

function clearForm(skipConfirm=false) {
    if (!skipConfirm && !confirm('Clear everything and start fresh?')) return;
    document.querySelectorAll('input[type="text"], input[type="number"], textarea').forEach(i => i.value = '');
    document.querySelectorAll('select').forEach(s => s.selectedIndex = 0);
    document.querySelectorAll('.dynamic-list').forEach(l => l.innerHTML = '');
    tags = []; renderTags();
    currentFilename   = '';
    currentFileHandle = null;
    document.getElementById('mode-label').textContent = 'New Recipe';
    document.getElementById('mode-label').style.color = '';
    const nb = document.getElementById('nutrition-box'); if(nb) nb.style.display = 'none';
    const tb = document.getElementById('timeline-box'); if(tb) tb.style.display = 'none';
    update();
}

function insertParagraphBreak() {
    const ta = document.getElementById('description');
    if (!ta) return;
    const pos = ta.selectionStart;
    ta.value = ta.value.slice(0, pos) + '\n\n' + ta.value.slice(pos);
    ta.selectionStart = ta.selectionEnd = pos + 2;
    ta.focus();
    update();
}

function autoResize(el) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
}

function toast(msg) {
    const t = document.getElementById('toast');
    if (!t) { console.warn('Toast:', msg); return; }
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2200);
}

function escHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ── Drag and Drop ─────────────────────────────────────────
let draggedEl = null;

function setupDragEvents(el, listId, callback) {
    el.addEventListener('dragstart', e => {
        draggedEl = el;
        el.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
    });
    el.addEventListener('dragend', () => {
        el.classList.remove('dragging');
        draggedEl = null;
        if (callback) callback();
        else update();
    });
}

// Attach dragover+drop to each list container once
function initDragDrop() {
    ['ingredients-list','equipment-list','steps-list','notes-list','journal-list','related-list'].forEach(listId => {
        const list = document.getElementById(listId);
        if (!list) return;
        list.addEventListener('dragover', e => {
            e.preventDefault();
            if (!draggedEl) return;
            const after = getDragAfterElement(list, e.clientY);
            if (after == null) list.appendChild(draggedEl);
            else list.insertBefore(draggedEl, after);
        });
    });
}

function getDragAfterElement(container, y) {
    const items = [...container.querySelectorAll('[draggable]:not(.dragging)')];
    return items.reduce((closest, child) => {
        const box    = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        return (offset < 0 && offset > closest.offset) ? { offset, element: child } : closest;
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

// ── RELATED RECIPES HELPERS ──────────────────────────────

// Populates the select dropdown with alphabetical recipes from index
window.populateRelatedRecipeDropdown = function() {
    const select = document.getElementById('related-recipe-select');
    if (!select) return;
    
    if (!recipeIndex || recipeIndex.length === 0) {
        select.innerHTML = '<option value="">No recipes found in index</option>';
        return;
    }
    
    const sortedRecipes = [...recipeIndex].sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    
    select.innerHTML = '<option value="">— Select a recipe —</option>' + 
        sortedRecipes.map(r => `<option value="${r.id}">${escHtml(r.title || r.name || r.id)}</option>`).join('');
};

// Scans the whole recipe index and proposes up to 5 related recipes,
// scored by how many tags they share with the current recipe (2 points
// each) plus a bonus point for matching category. Excludes the recipe
// currently being edited and anything already added to the list. Ties
// break alphabetically by title so results are stable, not random.
window.suggestRelatedRecipes = function() {
    if (!recipeIndex || !recipeIndex.length) {
        toast('Recipe index not loaded yet');
        return;
    }

    const currentTags = (tags || []).map(t => t.toLowerCase());
    const currentCategory = val('category');
    const currentId = (currentFilename || val('title').toLowerCase().replace(/[^a-z0-9]/g, '')).toLowerCase();

    if (!currentTags.length && !currentCategory) {
        toast('Add some tags or a category first so matches make sense');
        return;
    }

    const alreadyAdded = new Set(
        Array.from(document.querySelectorAll('#related-list .related-row')).map(row => row.dataset.id)
    );

    const scored = recipeIndex
        .filter(r => r.id !== currentId && !alreadyAdded.has(r.id))
        .map(r => {
            const candidateTags = r.tags || [];
            const shared = candidateTags.filter(t => currentTags.includes(t.toLowerCase()));
            let score = shared.length * 2;
            if (currentCategory && r.category === currentCategory) score += 1;
            return { entry: r, score, shared };
        })
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score || (a.entry.title || '').localeCompare(b.entry.title || ''))
        .slice(0, 5);

    if (!scored.length) {
        toast('No matching recipes found — try adding more tags');
        return;
    }

    scored.forEach(s => {
        loadRelatedRecipe(s.entry.id, s.entry.title || s.entry.name || s.entry.id, s.shared);
    });
    update();
    toast(`Added ${scored.length} suggested recipe${scored.length !== 1 ? 's' : ''}`);
};

window.addRelatedRecipe = function() {
    const select = document.getElementById('related-recipe-select');
    if (!select || !select.value) return;
    const id = select.value;
    const entry = recipeIndex.find(r => r.id === id);
    if (!entry) return;
    
    const exists = Array.from(document.querySelectorAll('#related-list .related-row'))
        .some(row => row.dataset.id === id);
    if (exists) { 
        toast('Recipe already added'); 
        return; 
    }
    
    loadRelatedRecipe(id, entry.title || entry.name || id, entry.tags || []);
    select.selectedIndex = 0;
    update();
};

window.loadRelatedRecipe = function(id, title, matchingTags) {
    const list = document.getElementById('related-list');
    if (!list) return;
    
    const row = document.createElement('div');
    row.className = 'related-row';
    row.draggable = true;
    row.dataset.id = id;
    row.dataset.title = title;
    row.dataset.tags = JSON.stringify(matchingTags);

    const tagHtml = (matchingTags || []).map(t => 
        `<span class="tag-pill" onclick="removeTagFromRelated(this, '${t}')">${t}</span>`
    ).join('');
    
    row.innerHTML = `
        <div class="drag-handle">⋮⋮</div>
        <div class="related-row-info">
            <div class="related-row-title">${title}</div>
            <div class="related-row-id">${id}</div>
        </div>
        <div class="tag-container">
            ${tagHtml}
        </div>
        <button class="btn danger" onclick="removeRow(this); update();">✕</button>
    `;
    
    setupDragEvents(row, 'related-list');
    list.appendChild(row);
};

window.removeTagFromRelated = function(span, tag) {
    const row = span.closest('.related-row');
    if (!row) return;
    try {
        const currentTags = JSON.parse(row.dataset.tags || '[]');
        const updatedTags = currentTags.filter(t => t !== tag);
        row.dataset.tags = JSON.stringify(updatedTags);
        span.remove();
        update();
    } catch (e) {
        console.warn('Could not parse related tags:', e);
    }
};

// ── SEE ALSO HELPERS ───────────────────────────────────────
// A "see also" is a hard dependency or important cross-reference — either
// a sub-recipe (paste, sauce, dough) this one requires, OR a reference/
// technique page (Gelatine Blooming Guide, Puff Pastry Methods, etc.).
// Rendered as its own callout above the numbered Method steps on the live
// page — not embedded inline in a step's sentence the way the older
// [[id|Display Text]] bracket syntax works. Each entry stores EITHER an
// "id" (links to recipe.html?id=...) OR a "url" (links directly to that
// reference page) — never both.

window.populateSeeAlsoDropdown = function() {
    const select = document.getElementById('see-also-select');
    if (!select) return;

    const hasRecipes = recipeIndex && recipeIndex.length;
    const hasReference = referenceIndex && referenceIndex.length;
    if (!hasRecipes && !hasReference) {
        select.innerHTML = '<option value="">Loading…</option>';
        return;
    }

    let html = '<option value="">— Select a recipe or reference page —</option>';

    if (hasRecipes) {
        const sortedRecipes = [...recipeIndex].sort((a, b) => (a.title || '').localeCompare(b.title || ''));
        html += '<optgroup label="Recipes">' +
            sortedRecipes.map(r => `<option value="recipe:${r.id}">${escHtml(r.title || r.name || r.id)}</option>`).join('') +
            '</optgroup>';
    }
    if (hasReference) {
        const sortedRef = [...referenceIndex].sort((a, b) => (a.title || '').localeCompare(b.title || ''));
        html += '<optgroup label="Reference Pages">' +
            sortedRef.map(r => `<option value="ref:${r.url}">${escHtml(r.title || r.url)}</option>`).join('') +
            '</optgroup>';
    }

    select.innerHTML = html;
};

window.addSeeAlso = function() {
    const select = document.getElementById('see-also-select');
    if (!select || !select.value) return;
    const [kind, key] = select.value.split(/:(.+)/); // split on FIRST colon only — urls can't contain one anyway, but be safe

    let id = null, url = null, title = null;
    if (kind === 'recipe') {
        const entry = recipeIndex.find(r => r.id === key);
        if (!entry) return;
        id = key;
        title = entry.title || entry.name || key;
    } else if (kind === 'ref') {
        const entry = referenceIndex.find(r => r.url === key);
        if (!entry) return;
        url = key;
        title = entry.title || key;
    } else {
        return;
    }

    const exists = Array.from(document.querySelectorAll('#see-also-list .see-also-row'))
        .some(row => (id && row.dataset.id === id) || (url && row.dataset.url === url));
    if (exists) {
        toast('Already added');
        return;
    }

    loadSeeAlso({ id, url, title, note: '' });
    select.selectedIndex = 0;
    update();
};

window.loadSeeAlso = function(entry) {
    const list = document.getElementById('see-also-list');
    if (!list) return;

    const row = document.createElement('div');
    row.className = 'see-also-row';
    row.dataset.id = entry.id || '';
    row.dataset.url = entry.url || '';
    row.dataset.title = entry.title || entry.id || entry.url || '';

    const kindLabel = entry.id ? 'Recipe' : 'Reference Page';
    const idLine = entry.id || entry.url || '';

    row.innerHTML = `
        <div class="related-row-info">
            <div class="related-row-title">${escHtml(row.dataset.title)}</div>
            <div class="related-row-id">${escHtml(kindLabel)} · ${escHtml(idLine)}</div>
        </div>
        <input type="text" class="uses-recipe-note" placeholder="Note (e.g. 1 batch, prepared ahead)" value="${escHtml(entry.note || '')}" oninput="update()">
        <button class="btn danger" onclick="removeRow(this); update();">✕</button>
    `;

    list.appendChild(row);
};

document.addEventListener('DOMContentLoaded', initDragDrop);