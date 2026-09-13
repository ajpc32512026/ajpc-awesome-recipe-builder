/* =========================================================
   BUILDER MAIN — Global State & Orchestration
   Load order: builder-ui.js, builder-data.js, builder-parser.js,
               builder-nutrition.js, builder-timeline.js, builder-main.js
========================================================= */

// ── Global State ──────────────────────────────────────────
let currentFileHandle = null;
let currentFilename   = '';
let tags              = [];
let recipeIndex       = [];
let referenceIndex    = [];
let cuisineList       = [];

// NUTRITION_DB lives here — builder-nutrition.js reads this variable.
// It's now DERIVED from data/ingredients-master.json (the single unified
// ingredient file) rather than loaded from its own separate file. Every
// canonical name AND every alias gets its own entry pointing at the same
// nutrition object, so exact-match lookups in builder-nutrition.js resolve
// regardless of which wording variant a recipe happens to use.
let NUTRITION_DB = {};

// ── Init ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    await loadNutritionDB();
    await loadRecipeIndexForRelated();
    await loadReferenceIndexForSeeAlso();
    await loadCuisineList();
    initScrollToTop();
    update();
});

// ── Async Loaders ─────────────────────────────────────────
async function loadNutritionDB() {
    try {
        const res = await fetch('json/ingredients-master.json?t=' + Date.now());
        if (!res.ok) return;
        const master = await res.json();
        const flat = {};
        Object.keys(master).forEach(name => {
            const entry = master[name];
            if (!entry.nutrition) return; // no nutrition data for this ingredient - skip, don't fall back
            const nd = Object.assign({}, entry.nutrition);
            if (entry.per) nd.per = entry.per;
            flat[name] = nd;
            (entry.aliases || []).forEach(alias => {
                if (!flat[alias]) flat[alias] = nd; // canonical name wins if an alias string collides
            });
        });
        NUTRITION_DB = flat;
        console.log('Nutrition DB derived from ingredients-master.json:', Object.keys(NUTRITION_DB).length, 'names/aliases with nutrition data');
    } catch(e) { console.warn('Could not load json/ingredients-master.json — nutrition estimates disabled'); }
}

async function loadRecipeIndexForRelated() {
    try {
        const res = await fetch('json/recipe-index.json?t=' + Date.now());
        if (res.ok) {
            recipeIndex = await res.json();
            if (typeof populateRelatedRecipeDropdown === 'function') populateRelatedRecipeDropdown();
            if (typeof populateSeeAlsoDropdown === 'function') populateSeeAlsoDropdown();
        }
    } catch(e) { console.warn('Could not load recipe index'); }
}

async function loadReferenceIndexForSeeAlso() {
    try {
        const res = await fetch('json/reference-index.json?t=' + Date.now());
        if (res.ok) {
            referenceIndex = await res.json();
            if (typeof populateSeeAlsoDropdown === 'function') populateSeeAlsoDropdown();
        }
    } catch(e) { console.warn('Could not load reference index'); }
}

async function loadCuisineList() {
    try {
        const res = await fetch('json/official-tag-vocabulary.json?t=' + Date.now());
        if (res.ok) {
            const vocab = await res.json();
            cuisineList = (vocab.tagVocabulary && vocab.tagVocabulary.cuisine) || [];
            if (typeof populateCuisineDropdown === 'function') populateCuisineDropdown();
        }
    } catch(e) { console.warn('Could not load official-tag-vocabulary.json for cuisine list'); }
}

// ── Main Update Loop ──────────────────────────────────────
// Called every time any input changes
function update() {
    const { obj, id, title } = buildJSON();

    // 1. Filename label
    const effectiveId = currentFilename || id || 'recipe';
    const fnLabel = document.getElementById('filename-label');
    if (fnLabel) fnLabel.textContent = effectiveId + '.json';

    // 2. JSON preview
    const jsonOut = document.getElementById('json-output');
    if (jsonOut) jsonOut.innerHTML = highlight(JSON.stringify(obj, null, 2));

    // 3. Nav snippet (elements are optional — only present if nav preview box exists)
    const category = val('category');
    const { snippet, note } = buildNavSnippet(effectiveId, title, category);
    const navNote = document.getElementById('nav-note');
    const navOut  = document.getElementById('nav-output');
    if (navNote) navNote.innerHTML = note ? `<strong>${note}</strong>` : 'Fill in Title &amp; Category to generate the nav snippet.';
    if (navOut)  navOut.innerHTML  = snippet ? highlightHTML(snippet) : '<em class="nav-waiting">— waiting for title &amp; category —</em>';

    // 4. Nutrition box — driven by builder-nutrition.js
    calculateNutrition();

    // 5. Timeline — driven by builder-timeline.js
    generateTimeline();

    // 6. Misc UI
    updateDuplicateButton();

    // 7. Live schema validation — driven by builder-validator.js
    if (window.BuilderValidator) BuilderValidator.validateCurrent();
}

// ── Global Helpers ────────────────────────────────────────
function val(id) { return document.getElementById(id)?.value.trim() ?? ''; }

function toTitleCase(s) {
    if (!s) return '';
    return s.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

// ── Scroll-to-Top ─────────────────────────────────────────
function initScrollToTop() {
    const btn = document.getElementById('scrollTopBtn');
    if (!btn) return;
    window.addEventListener('scroll', () => {
        const fromBottom = document.documentElement.scrollHeight - window.scrollY - window.innerHeight;
        btn.classList.toggle('show', fromBottom <= 150);
    });
    btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
}
