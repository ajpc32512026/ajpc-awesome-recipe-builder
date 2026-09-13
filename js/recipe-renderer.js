/* =========================================================
   RECIPE RENDERER — KitchenNotebook Kitchen Notebook
   Core rendering engine: cook mode, scaler, tip box, related recipes
   Shopping list functionality moved to recipe-shopping.js
========================================================= */

(function() {
    'use strict';

    // Pantry staples for ingredient matching
    var PANTRY_STAPLES = [
        'water', 'salt', 'pepper', 'black pepper', 'white pepper',
        'butter', 'unsalted butter', 'oil', 'olive oil', 'vegetable oil', 'canola oil',
        'flour', 'plain flour', 'all-purpose flour', 'bread flour', 'self-raising flour',
        'sugar', 'white sugar', 'caster sugar', 'brown sugar', 'icing sugar',
        'eggs', 'egg', 'milk',
        'baking powder', 'baking soda', 'bi-carb soda', 'bicarbonate of soda',
        'vanilla', 'vanilla extract', 'yeast',
        'stock', 'chicken stock', 'beef stock', 'vegetable stock',
        'garlic', 'onion', 'brown onion', 'red onion', 'spring onion',
        'to taste'
    ];

    // Simple cache for recipe index
    var recipeIndexCache = {
        data: null,
        timestamp: null,
        maxAge: 30 * 60 * 1000
    };

    var currentTipData = null;
    var currentRecipeId = null;
    var currentRecipeTitle = null;

    function getCachedIndex() {
        if (recipeIndexCache.data && recipeIndexCache.timestamp && (Date.now() - recipeIndexCache.timestamp < recipeIndexCache.maxAge)) {
            return Promise.resolve(recipeIndexCache.data);
        }
        return fetch('json/recipe-index.json')
            .then(function(res) { return res.json(); })
            .then(function(data) {
                recipeIndexCache.data = data;
                recipeIndexCache.timestamp = Date.now();
                return data;
            })
            .catch(function() {
                if (recipeIndexCache.data) return recipeIndexCache.data;
                return [];
            });
    }

    const RECIPE_PATH = 'data/recipes/';

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    async function init() {
        const container = document.getElementById('recipe-container');
        if (!container) return;

        getCachedIndex();

        const params = new URLSearchParams(window.location.search);
        const id = params.get('id');

        if (!id) {
            renderError('No recipe specified. Please select one from the menu.', container);
            return;
        }

        var recipeIndex = [];
        try {
            var idxRes = await fetch('json/recipe-index.json');
            if (idxRes.ok) recipeIndex = await idxRes.json();
        } catch(e) {
            console.warn('Could not load recipe index for related suggestions');
            recipeIndex = [];
        }

        try {
            const recipe = await fetchRecipe(id);
            currentRecipeId = recipe.id;
            currentRecipeTitle = recipe.title;
            renderRecipe(recipe, container, recipeIndex);
            document.dispatchEvent(new CustomEvent('recipeRendered', { detail: recipe }));
        } catch (err) {
            console.error('[recipe-renderer]', err);
            renderError(`Could not load recipe "${id}". ${err.message}`, container);
        }
    }

    async function fetchRecipe(id) {
        const res = await fetch(`${RECIPE_PATH}${id}.json`);
        if (!res.ok) throw new Error(`Recipe file not found (${res.status})`);
        return res.json();
    }

    function validateRecipe(recipe, id) {
        var warnings = [];

        if (!recipe.title) {
            warnings.push('Missing recipe title');
        }

        if (recipe.id && recipe.id !== id) {
            warnings.push('Recipe ID "' + recipe.id + '" does not match filename "' + id + '"');
        }

        if (!recipe.ingredients || recipe.ingredients.length === 0) {
            warnings.push('No ingredients listed');
        } else {
            var hasRealIngredient = recipe.ingredients.some(function(ing) {
                return !ing.heading && (ing.item || ing.name || ing.ingredient);
            });
            if (!hasRealIngredient) {
                warnings.push('Ingredients section has only headings — no actual ingredients found');
            }
        }

        if (!recipe.method || recipe.method.length === 0) {
            warnings.push('No method steps listed');
        } else {
            var hasRealStep = recipe.method.some(function(step) {
                return !step.heading && (step.instruction || step.text);
            });
            if (!hasRealStep) {
                warnings.push('Method section has only headings — no actual steps found');
            }
        }

        var validCategories = [
            'Breads', 'Baking', 'Biscuits', 'Bistro', 'Entree', 'Dinner', 'Mains',
            'Filipino', 'Desserts', 'Sauces', 'Pasta', 'Pizza',
            'Soups', 'Salads', 'Sides', 'Snacks', 'Breakfast', 'Other'
        ];
        if (recipe.category && validCategories.indexOf(recipe.category) === -1) {
            warnings.push('Unknown category "' + recipe.category + '" — may not appear in navigation');
        }

        if (recipe.tags && recipe.tags.length) {
            var seen = {};
            var dupes = [];
            recipe.tags.forEach(function(tag) {
                var lower = tag.toLowerCase();
                if (seen[lower]) dupes.push(tag);
                seen[lower] = true;
            });
            if (dupes.length) {
                warnings.push('Duplicate tags found: ' + dupes.join(', '));
            }
        }

        if (recipe.notes && recipe.notes.length) {
            recipe.notes.forEach(function(note, i) {
                if (note.title && !note.content && !note.text) {
                    warnings.push('Note #' + (i + 1) + ' "' + note.title + '" has no content');
                }
                if (!note.type || ['acknowledgement','serving','technique','storage','substitution','variation','tip'].indexOf(note.type) === -1) {
                    if (note.type) {
                        warnings.push('Note #' + (i + 1) + ' has unrecognised type "' + note.type + '"');
                    }
                }
            });
        }

        if (recipe.servings && isNaN(parseInt(recipe.servings))) {
            warnings.push('Servings value "' + recipe.servings + '" is not a number — scaler may not work correctly');
        }

        if (warnings.length > 0) {
            console.warn('[recipe-validator] ' + recipe.title + ' (' + id + '):');
            warnings.forEach(function(w) {
                console.warn('Warning: ' + w);
            });
        }

        return warnings;
    }

    function renderRecipe(r, container, recipeIndex) {
        const title = r.title || r.id || 'Recipe';
        document.title = title + ' | KitchenNotebook Kitchen';

        var metaDesc = document.querySelector('meta[name="description"]');
        if (metaDesc) {
            metaDesc.setAttribute('content', (r.description || r.title || 'Recipe') + " — The Kitchen Notebook.");
        }

        validateRecipe(r, r.id || '');

        const hasIngredients = r.ingredients && r.ingredients.length > 0;
        const hasMethod = r.method && r.method.length > 0;

        container.innerHTML = `
            <div class="recipe-page-wrapper animate-in">
                ${renderBreadcrumb(r)}
                ${renderWarnings(hasIngredients, hasMethod)}
                <p class="print-cue">Print option available at the bottom of this page.</p>
                ${renderHeader(r)}
                ${renderMetadata(r)}
                ${renderToolbar()}
                <hr class="recipe-divider">
                <div id="scalerInfoContainer" class="scaler-info no-print-hide" style="display:none;margin-bottom:var(--sp-lg);padding:0.5rem 0.75rem;background:rgba(201,125,62,0.08);border:1px solid var(--border-dim);border-radius:6px;font-size:0.82rem;color:var(--cream-dim);line-height:1.5;"></div>
                <div class="print-columns">
                    ${renderIngredients(r)}
                    ${renderYouWillNeed(r.youWillNeed)}
                    <div class="print-col-right">
                        ${renderMethod(r)}
                        ${renderNotes(r.notes)}
                    </div>
                </div>
                ${renderJournal(r.journal)}
                ${renderTipBox(r, recipeIndex)}
                ${renderNutrition(r.nutrition)}
                ${renderTags(r.tags)}
                ${renderRelated(r, recipeIndex)}
            </div>
        `;

        setupToolbar(r);

        if (r.lastModified || r.updatedAt) {
            const lastUpdated = r.lastModified || r.updatedAt;
            const date = new Date(lastUpdated);
            const formattedDate = date.toLocaleDateString('en-AU', { year: 'numeric', month: 'long', day: 'numeric' });
            const lastUpdatedDiv = document.createElement('div');
            lastUpdatedDiv.className = 'recipe-last-updated';
            lastUpdatedDiv.innerHTML = 'Last updated: ' + formattedDate;
            container.querySelector('.recipe-page-wrapper').appendChild(lastUpdatedDiv);
        }

        setTimeout(function() {
            if (typeof window.loadRandomTip === 'function') {
                window.loadRandomTip();
            }
        }, 100);
    }

    function renderBreadcrumb(r) {
        return '<div class="recipe-eyebrow">' +
            '<a href="index.html">Home</a>' +
            '<span>/</span>' +
            (r.category ? '<a href="search.html?q=' + encodeURIComponent(r.category) + '">' + escHtml(r.category) + '</a><span>/</span>' : '') +
            '<span>' + escHtml(r.title || r.id || 'Recipe') + '</span>' +
            '</div>';
    }

    function renderWarnings(hasIng, hasMethod) {
        var warnings = [];
        if (!hasIng) warnings.push('No ingredients listed for this recipe yet.');
        if (!hasMethod) warnings.push('No method/instructions provided yet.');
        if (!warnings.length) return '';
        return '<div class="recipe-warnings">' +
            '<strong>Incomplete recipe data:</strong>' +
            '<ul>' + warnings.map(function(w) { return '<li>' + w + '</li>'; }).join('') + '</ul>' +
            '</div>';
    }

    function renderHeader(r) {
        return (r.category ? '<span class="recipe-category-badge">' + escHtml(r.category) + '</span>' : '') +
            '<h1 class="recipe-title">' + escHtml(r.title || r.id || 'Recipe') + '</h1>' +
            (r.description ? '<p class="recipe-description">' + escHtml(r.description) + '</p>' : '');
    }

    function renderMetadata(r) {
        var items = [];
        if (r.prepTime) items.push({ label: 'Prep', value: r.prepTime });
        if (r.cookTime) items.push({ label: 'Cook', value: r.cookTime });
        if (r.totalTime) items.push({ label: 'Total', value: r.totalTime });
        if (r.servings) items.push({ label: 'Serves', value: r.servings });
        if (r.difficulty) items.push({ label: 'Difficulty', value: r.difficulty });
        if (r.cuisine) items.push({ label: 'Cuisine', value: r.cuisine });

        if (!items.length) return '';

        return '<div class="recipe-metadata-table">' +
            items.map(function(m) {
                return '<div class="meta-cell">' +
                    '<span class="meta-label">' + m.label + '</span>' +
                    '<span class="meta-value">' + escHtml(m.value) + '</span>' +
                    '</div>';
            }).join('') +
            '</div>';
    }

    function renderToolbar() {
        return '<div class="recipe-toolbar">' +
            '<button class="toolbar-btn primary" id="cookModeBtn">Cook Mode</button>' +
            '<button class="toolbar-btn" id="shoppingListBtn">Shopping List</button>' +
            '<button class="toolbar-btn" onclick="window.print()">Print Recipe</button>' +
            '</div>';
    }

    function renderIngredients(r) {
        if (!r.ingredients || !r.ingredients.length) {
            return '<section class="ingredients">' +
                '<h2>Ingredients</h2>' +
                '<p>No ingredients listed.</p>' +
                '</section>';
        }

        var scaler = '<div class="scaler-controls">' +
            '<span class="scaler-label">Scale:</span>' +
            '<button class="scaler-btn" id="scalerDown" aria-label="Decrease serving">-</button>' +
            '<span class="scaler-display" id="scalerDisplay">1x</span>' +
            '<button class="scaler-btn" id="scalerUp" aria-label="Increase serving">+</button>' +
            '</div>';

        var regularIngs = r.ingredients.filter(function(ing) { return !ing.toTaste; });
        var toTasteIngs = r.ingredients.filter(function(ing) { return ing.toTaste; });

        var items = regularIngs.map(function(ing) {
            if (ing.heading) {
                return '<li class="ingredient-heading">' + escHtml(ing.heading) + '</li>';
            }
            return '<li>' + formatIngredient(ing) + '</li>';
        }).join('');

        var toTasteHtml = '';
        if (toTasteIngs.length) {
            toTasteHtml = '<li class="ingredient-totaste-label">Season to taste</li>' +
                toTasteIngs.map(function(ing) {
                    var note = ing.notes ? ' <span class="ingredient-notes">(' + escHtml(ing.notes) + ')</span>' : '';
                    return '<li class="ingredient-totaste">' + escHtml(ing.item) + note + '</li>';
                }).join('');
        }

        return '<section class="ingredients">' +
            '<h2>Ingredients</h2>' +
            scaler +
            '<ul>' + items + toTasteHtml + '</ul>' +
            '</section>';
    }

    function formatIngredient(ing) {
        if (typeof ing === 'string') return escHtml(ing);

        var qty = String(ing.quantity !== undefined && ing.quantity !== null ? ing.quantity : '').trim();
        var unit = String(ing.unit || '').trim();
        var item = String(ing.item || ing.name || ing.ingredient || '').trim();
        var notes = String(ing.notes || ing.description || '').trim();

        if (!qty && !unit) {
            return notes
                ? escHtml(item) + ' <span class="ingredient-notes">(' + escHtml(notes) + ')</span>'
                : escHtml(item);
        }

        var num = parseFloat(qty);
        var qtySpan = !isNaN(num)
            ? '<span class="ingredient-quantity" data-original="' + num + '">' + escHtml(qty) + '</span>'
            : '<span class="ingredient-quantity">' + escHtml(qty) + '</span>';

        var parts = [unit, item].filter(Boolean).map(escHtml).join(' ');
        var notePart = notes ? ' <span class="ingredient-notes">(' + escHtml(notes) + ')</span>' : '';
        return qtySpan + ' ' + parts + notePart;
    }

    function renderYouWillNeed(youWillNeed) {
        if (!youWillNeed || !youWillNeed.length) return '';

        var items = youWillNeed.map(function(entry) {
            var noteText = entry.note || entry.notes || '';
            var notePart = noteText ? '<span class="equipment-notes"> — ' + escHtml(noteText) + '</span>' : '';
            return '<li class="you-will-need-item">' +
                '<span class="you-will-need-checkbox"></span>' +
                '<span class="you-will-need-text">' + escHtml(entry.item) + notePart + '</span>' +
                '</li>';
        }).join('');

        return '<section class="you-will-need">' +
            '<h2>You Will Also Need</h2>' +
            '<ul class="you-will-need-list">' + items + '</ul>' +
            '</section>';
    }

    function renderLinkedText(text) {
        // Fix: Replace newline characters with HTML break tags
        var safe = escHtml(text).replace(/\n/g, '<br>');
        return safe.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, function(match, id, display) {
            return '<a href="recipe.html?id=' + encodeURIComponent(id.trim()) + '" class="recipe-inline-link">' + display.trim() + '</a>';
        });
    }

    function renderSeeAlso(r) {
        var entries = r.seeAlso || r.usesRecipes; // usesRecipes kept as a fallback for anything saved under the old name
        if (!entries || !entries.length) return '';
        var items = entries.map(function (u) {
            var href = u.id ? 'recipe.html?id=' + encodeURIComponent(u.id) : escHtml(u.url || '#');
            var note = u.note ? ' <span class="uses-recipe-note">(' + escHtml(u.note) + ')</span>' : '';
            return '<li><a href="' + href + '" class="recipe-inline-link">' +
                escHtml(u.title) + '</a>' + note + '</li>';
        }).join('');
        return '<div class="uses-recipes-callout">' +
            '<span class="uses-recipes-label">See Also:</span>' +
            '<ul>' + items + '</ul>' +
            '</div>';
    }

    function renderMethod(r) {
        if (!r.method || !r.method.length) {
            return '<section class="method">' +
                '<h2>Method</h2>' +
                renderSeeAlso(r) +
                '<p>No instructions provided.</p>' +
                '</section>';
        }

        var items = r.method.map(function(step) {
            if (step.heading) {
                return '<li class="method-heading">' + escHtml(step.heading) + '</li>';
            }
            var text = typeof step === 'string' ? step : (step.instruction || step.text || JSON.stringify(step));
            return '<li>' + renderLinkedText(text) + '</li>';
        }).join('');

        return '<section class="method">' +
            '<h2>Method</h2>' +
            renderSeeAlso(r) +
            '<ol>' + items + '</ol>' +
            '</section>';
    }

    function renderNotes(notes) {
        if (!notes || !notes.length) return '';
        var items = notes.map(function(note) {
            if (typeof note === 'string') {
                return '<div class="note"><p>' + escHtml(note).replace(/\n/g, '<br>') + '</p></div>';
            }
            var title = note.title || note.type || 'Note';
            var content = note.content || note.text || '';
            if ((content.includes('All rights reserved') || content.includes('©')) && content.length < 100) return '';
            return '<div class="note">' +
                '<h4>' + escHtml(title) + '</h4>' +
                '<p>' + renderLinkedText(content) + '</p>' +
                '</div>';
        }).filter(Boolean).join('');

        if (!items) return '';
        return '<section class="recipe-notes"><h2>Notes</h2>' + items + '</section>';
    }

    function renderJournal(journal) {
        if (!journal || !journal.length) return '';
        var entries = journal.map(function(e) {
            var dateStr = e.date
                ? new Date(e.date).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })
                : '';
            
            // Fix: Replace newline characters with HTML break tags
            var contentHtml = escHtml(e.content || '').replace(/\n/g, '<br>');

            return '<div class="journal-entry">' +
                (dateStr ? '<span class="journal-date">' + dateStr + '</span>' : '') +
                '<p>' + contentHtml + '</p>' +
                '</div>';
        }).join('');
        return '<section class="recipe-journal"><h2>Recipe Journal</h2>' + entries + '</section>';
    }

    function renderNutrition(n) {
        if (!n) return '';

        var servings = n.servings, cal = n.cal, kj = n.kj, protein = n.protein, carbs = n.carbs, sugars = n.sugars, fat = n.fat, saturated_fat = n.saturated_fat, fiber = n.fiber, sodium = n.sodium, coverage = n.coverage;
        var calcium_mg = n.calcium_mg, iron_mg = n.iron_mg, potassium_mg = n.potassium_mg, magnesium_mg = n.magnesium_mg, zinc_mg = n.zinc_mg;
        var cholesterol_mg = n.cholesterol_mg, vitamin_a_ug = n.vitamin_a_ug, vitamin_c_mg = n.vitamin_c_mg, vitamin_d_ug = n.vitamin_d_ug;

        var micronutrients = [];
        if (calcium_mg) micronutrients.push('<div class="nutrition-row"><span>Calcium</span><span>' + calcium_mg + 'mg</span></div>');
        if (iron_mg) micronutrients.push('<div class="nutrition-row"><span>Iron</span><span>' + iron_mg + 'mg</span></div>');
        if (potassium_mg) micronutrients.push('<div class="nutrition-row"><span>Potassium</span><span>' + potassium_mg + 'mg</span></div>');
        if (magnesium_mg) micronutrients.push('<div class="nutrition-row"><span>Magnesium</span><span>' + magnesium_mg + 'mg</span></div>');
        if (zinc_mg) micronutrients.push('<div class="nutrition-row"><span>Zinc</span><span>' + zinc_mg + 'mg</span></div>');
        if (cholesterol_mg) micronutrients.push('<div class="nutrition-row"><span>Cholesterol</span><span>' + cholesterol_mg + 'mg</span></div>');
        if (vitamin_a_ug) micronutrients.push('<div class="nutrition-row"><span>Vitamin A</span><span>' + vitamin_a_ug + 'mcg</span></div>');
        if (vitamin_c_mg) micronutrients.push('<div class="nutrition-row"><span>Vitamin C</span><span>' + vitamin_c_mg + 'mg</span></div>');
        if (vitamin_d_ug) micronutrients.push('<div class="nutrition-row"><span>Vitamin D</span><span>' + vitamin_d_ug + 'mcg</span></div>');

        var micronutrientsHtml = '';
        if (micronutrients.length) {
            micronutrientsHtml = '<div class="nutrition-divider thin"></div>' + micronutrients.join('');
        }

        return '<section class="recipe-nutrition">' +
            '<h2>Nutrition Facts</h2>' +
            '<div class="nutrition-label">' +
            '<div class="nutrition-header">' +
            '<span class="nutrition-title">Nutrition Facts</span>' +
            '<span class="nutrition-serving">Per serving | ' + escHtml(String(servings || '?')) + ' servings</span>' +
            '</div>' +
            '<div class="nutrition-calories">' +
            '<span>Calories</span>' +
            '<span>' + (cal || 0) + '</span>' +
            '</div>' +
            (kj ? '<div class="nutrition-kj"><span>Energy (kJ)</span><span>' + kj + '</span></div>' : '') +
            '<div class="nutrition-divider thick"></div>' +
            '<div class="nutrition-row"><span><strong>Protein</strong></span><span>' + (protein || 0) + 'g</span></div>' +
            '<div class="nutrition-row"><span><strong>Total Carbohydrate</strong></span><span>' + (carbs || 0) + 'g</span></div>' +
            '<div class="nutrition-row indent"><span>Sugars</span><span>' + (sugars || 0) + 'g</span></div>' +
            '<div class="nutrition-row indent"><span>Dietary Fibre</span><span>' + (fiber || 0) + 'g</span></div>' +
            '<div class="nutrition-row"><span><strong>Total Fat</strong></span><span>' + (fat || 0) + 'g</span></div>' +
            '<div class="nutrition-row indent"><span>Saturated Fat</span><span>' + (saturated_fat || 0) + 'g</span></div>' +
            '<div class="nutrition-row"><span><strong>Sodium</strong></span><span>' + (sodium || 0) + 'mg</span></div>' +
            micronutrientsHtml +
            '<div class="nutrition-divider thick"></div>' +
            (coverage ? '<div class="nutrition-coverage">Estimated from ' + coverage + '% of ingredients</div>' : '') +
            '</div>' +
            '</section>';
    }

    function renderTags(tags) {
        if (!tags || !tags.length) return '';
        var chips = tags.map(function(t) {
            return '<a href="search.html?q=' + encodeURIComponent(t) + '" class="recipe-tag">#' + escHtml(t) + '</a>';
        }).join('');
        return '<div class="recipe-tags">' + chips + '</div>';
    }

    function renderTipBox(recipe, recipeIndex) {
        if (!recipe.ingredients) return '';

        return '<div class="recipe-tip-box" id="recipeTipBox">' +
            '<div class="tip-box-header">Did You Know?</div>' +
            '<div class="tip-box-content" id="tipBoxContent">' +
            '<div class="tip-loading">Loading kitchen wisdom...</div>' +
            '</div>' +
            '<div class="tip-box-footer">' +
            '<button class="tip-box-refresh" onclick="window.loadRandomTip()">Another Tip</button>' +
            '<button class="tip-box-save" onclick="window.saveCurrentTip()">Save to Notebook</button>' +
            '</div>' +
            '</div>';
    }

    // ── Tip deck: one shuffled bag per recipe page load, mixing real
    // ingredient reference tips with food jokes. Both the automatic first
    // load (line ~237 above) and every "Another Tip" click call the same
    // loadRandomTip() function, so building the deck here covers both —
    // the deck is built once per page, then this just advances through it.
    // Reshuffles and starts over only once every item has been shown.
    var tipDeck = null;
    var tipDeckIndex = 0;

    function shuffle(arr) {
        var a = arr.slice();
        for (var i = a.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
        }
        return a;
    }

    async function buildTipDeck() {
        var tipInventory = window.tipInventory;
        if (!tipInventory) {
            var res = await fetch('json/ingredients-master.json');
            if (!res.ok) throw new Error('Failed to load ingredients directory');
            tipInventory = await res.json();
            window.tipInventory = tipInventory;
        }

        var tipLookup = {};
        for (var canonKey in tipInventory) {
            var entry = tipInventory[canonKey];
            if (!entry.reference) continue;
            tipLookup[canonKey.toLowerCase()] = { name: canonKey, data: entry };
            (entry.aliases || []).forEach(function(alias) {
                var aKey = alias.toLowerCase();
                if (!tipLookup[aKey]) tipLookup[aKey] = { name: canonKey, data: entry };
            });
        }

        var ingredientsList = [];
        document.querySelectorAll('.ingredients li').forEach(function(li) {
            if (li.classList.contains('ingredient-heading')) return;
            var spans = li.querySelectorAll('span');
            var ingredientName = '';
            for (var s = 0; s < spans.length; s++) {
                var spanText = spans[s].innerText || '';
                if (spans[s].classList.contains('ingredient-quantity')) continue;
                if (spans[s].classList.contains('ingredient-notes')) continue;
                if (spanText.trim().length > 0) {
                    ingredientName = spanText.trim().toLowerCase();
                    break;
                }
            }
            if (!ingredientName) {
                var text = li.innerText || '';
                text = text.replace(/^\d+[\d\/\s]*\s*/, '');
                text = text.replace(/^g\s|^ml\s|^kg\s|^cup\s|^tbsp\s|^tsp\s|^oz\s/i, '');
                ingredientName = text.trim().toLowerCase();
            }
            ingredientName = ingredientName.replace(/\(.*?\)/g, '').trim();
            if (ingredientName.length < 3) return;
            if (ingredientsList.indexOf(ingredientName) === -1) {
                ingredientsList.push(ingredientName);
            }
        });

        var deck = [];
        for (var i = 0; i < ingredientsList.length; i++) {
            var hit = tipLookup[ingredientsList[i]];
            if (hit) deck.push({ type: 'ingredient', name: hit.name, data: hit.data });
        }

        try {
            var jokeRes = await fetch('json/food-jokes.json');
            if (jokeRes.ok) {
                var jokes = await jokeRes.json();
                jokes.forEach(function(j) { deck.push({ type: 'joke', setup: j.setup, punchline: j.punchline }); });
            }
        } catch (e) {
            console.warn('Could not load food-jokes.json:', e);
        }

        return shuffle(deck);
    }

    window.loadRandomTip = async function() {
        function escHtmlForTip(str) {
            if (!str) return '';
            return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        }

        function cleanNotesText(notes) {
            if (!notes) return '';
            var cleaned = notes;
            cleaned = cleaned.replace(/\s*-\s*\*\*/g, '');
            cleaned = cleaned.replace(/\*\*/g, '');
            cleaned = cleaned.replace(/(Texture & Flavour:|Usage Tips:|Substitutions:|Usage:|Tips:|Storage:|Pairings:)/gi, '<br><strong>$1</strong>');
            cleaned = cleaned.replace(/Usage\s+Tips:/gi, 'Usage Tips:');
            cleaned = cleaned.replace(/Storage:\s*/gi, '');
            cleaned = cleaned.replace(/\.([A-Z])/g, '. $1');
            cleaned = cleaned.replace(/::/g, ':');
            cleaned = cleaned.replace(/\s+/g, ' ').trim();
            cleaned = cleaned.replace(/<br>\s*<br>/g, '<br>');
            return cleaned;
        }

        var container = document.getElementById('tipBoxContent');
        if (!container) return;

        try {
            if (!tipDeck || !tipDeck.length) {
                tipDeck = await buildTipDeck();
                tipDeckIndex = 0;
            }
            if (!tipDeck.length) {
                container.innerHTML = '<p class="tip-no-results">No tips available for ingredients in this recipe.</p>';
                return;
            }
            if (tipDeckIndex >= tipDeck.length) {
                // Whole deck shown once — reshuffle and start over, per your
                // "no repeats until the full list cycles" preference.
                tipDeck = shuffle(tipDeck);
                tipDeckIndex = 0;
            }

            var picked = tipDeck[tipDeckIndex++];

            if (picked.type === 'joke') {
                currentTipData = picked;
                var jokeHtml = '<div class="tip-joke">'
                    + '<div class="tip-joke-setup">' + escHtmlForTip(picked.setup) + '</div>'
                    + '<div class="tip-joke-punchline">' + escHtmlForTip(picked.punchline) + '</div>'
                    + '</div>';
                container.innerHTML = jokeHtml;
                return;
            }

            var random = { name: picked.name, data: picked.data };
            currentTipData = random;
            var ref = random.data.reference || {};

            var html = '<div class="tip-ingredient"><strong>' + escHtmlForTip(random.name) + '</strong>';
            if (random.data.aliases && random.data.aliases.length) {
                html += ' <span class="tip-aka">(' + random.data.aliases.join(', ') + ')</span>';
            }
            html += '</div>';

            if (ref.purpose) {
                html += '<div class="tip-purpose"><strong>Purpose:</strong> ' + escHtmlForTip(ref.purpose) + '</div>';
            }

            if (ref.usageTips) {
                var cleanUsage = ref.usageTips.replace(/\*\*/g, '').replace(/Usage:/gi, '').trim();
                html += '<div class="tip-usage"><strong>Usage:</strong> ' + escHtmlForTip(cleanUsage) + '</div>';
            }

            if (ref.storage) {
                var cleanStorage = ref.storage.replace(/\*\*/g, '').replace(/Storage:/gi, '').trim();
                html += '<div class="tip-storage"><strong>Storage:</strong> ' + escHtmlForTip(cleanStorage) + '</div>';
            }

            if (ref.substitutes) {
                html += '<div class="tip-substitutes"><strong>Substitute:</strong> ' + escHtmlForTip(ref.substitutes) + '</div>';
            }

            if (ref.notes && ref.notes.trim()) {
                var cleanNote = cleanNotesText(ref.notes);
                if (cleanNote.toLowerCase().indexOf(random.name.toLowerCase()) === 0) {
                    cleanNote = cleanNote.substring(random.name.length).trim();
                    cleanNote = cleanNote.replace(/^is\s+|^are\s+/, '');
                }
                cleanNote = cleanNote.charAt(0).toUpperCase() + cleanNote.slice(1);
                html += '<div class="tip-notes"><strong>Notes:</strong> ' + cleanNote + '</div>';
            }

            container.innerHTML = html;

        } catch(e) {
            console.warn('Tip box error:', e);
            container.innerHTML = '<p class="tip-no-results">Tips coming soon! Could not load ingredient data.</p>';
        }
    };

    window.saveCurrentTip = function() {
        if (!currentTipData) {
            alert('No tip to save. Click "Another Tip" first.');
            return;
        }
        var savedTips = JSON.parse(localStorage.getItem('ajpc_saved_tips') || '[]');
        var newTip;

        if (currentTipData.type === 'joke') {
            newTip = {
                id: Date.now(),
                recipeId: currentRecipeId,
                recipeTitle: currentRecipeTitle,
                joke: currentTipData.setup + ' — ' + currentTipData.punchline,
                savedAt: new Date().toISOString().split('T')[0]
            };
        } else {
            newTip = {
                id: Date.now(),
                recipeId: currentRecipeId,
                recipeTitle: currentRecipeTitle,
                ingredient: currentTipData.name,
                tip: currentTipData.data.notes ? currentTipData.data.notes.substring(0, 500) : '',
                substitute: currentTipData.data.substitutes ? currentTipData.data.substitutes : '',
                purpose: currentTipData.data.purpose ? currentTipData.data.purpose : '',
                savedAt: new Date().toISOString().split('T')[0]
            };
        }

        savedTips.unshift(newTip);
        localStorage.setItem('ajpc_saved_tips', JSON.stringify(savedTips));
        alert('✓ Tip saved to your personal notebook!');
    };

    function getRelatedByIngredients(recipe, allRecipes, maxResults) {
        maxResults = maxResults || 3;
        if (!recipe.ingredients || !allRecipes || allRecipes.length === 0) return [];

        var currentIngredients = [];
        for (var i = 0; i < recipe.ingredients.length; i++) {
            var ing = recipe.ingredients[i];
            if (ing.heading) continue;
            var item = (ing.item || ing.name || '').toLowerCase().trim();
            if (!item) continue;
            var isStaple = false;
            for (var s = 0; s < PANTRY_STAPLES.length; s++) {
                if (PANTRY_STAPLES[s] === item || item.includes(PANTRY_STAPLES[s])) {
                    isStaple = true;
                    break;
                }
            }
            if (!isStaple && currentIngredients.indexOf(item) === -1) {
                currentIngredients.push(item);
            }
        }

        if (currentIngredients.length === 0) return [];

        var scored = [];
        for (var r = 0; r < allRecipes.length; r++) {
            var otherRecipe = allRecipes[r];
            if (otherRecipe.id === recipe.id) continue;
            var otherIngredients = [];
            if (otherRecipe.ingredients) {
                for (var j = 0; j < otherRecipe.ingredients.length; j++) {
                    var oing = otherRecipe.ingredients[j];
                    if (oing.heading) continue;
                    var oitem = (oing.item || oing.name || '').toLowerCase().trim();
                    if (!oitem) continue;
                    var isStapleOther = false;
                    for (var s = 0; s < PANTRY_STAPLES.length; s++) {
                        if (PANTRY_STAPLES[s] === oitem || oitem.includes(PANTRY_STAPLES[s])) {
                            isStapleOther = true;
                            break;
                        }
                    }
                    if (!isStapleOther && otherIngredients.indexOf(oitem) === -1) {
                        otherIngredients.push(oitem);
                    }
                }
            }
            var matchCount = 0;
            for (var c = 0; c < currentIngredients.length; c++) {
                for (var o = 0; o < otherIngredients.length; o++) {
                    if (otherIngredients[o].indexOf(currentIngredients[c]) !== -1 ||
                        currentIngredients[c].indexOf(otherIngredients[o]) !== -1) {
                        matchCount++;
                        break;
                    }
                }
            }
            if (matchCount > 0) {
                scored.push({ recipe: otherRecipe, matchCount: matchCount });
            }
        }

        scored.sort(function(a, b) { return b.matchCount - a.matchCount; });
        return scored.slice(0, maxResults).map(function(s) { return s.recipe; });
    }

    function renderRelated(recipe, recipeIndex) {
        var manualRelated = recipe.related || [];
        var relatedRecipes = manualRelated.slice();

        if (relatedRecipes.length < 3 && recipeIndex && recipeIndex.length > 0) {
            var suggested = getRelatedByIngredients(recipe, recipeIndex, 3 - relatedRecipes.length);
            for (var s = 0; s < suggested.length; s++) {
                var alreadyExists = relatedRecipes.some(function(e) { return e.id === suggested[s].id; });
                if (!alreadyExists) {
                    relatedRecipes.push({ id: suggested[s].id, title: suggested[s].title });
                }
            }
        }

        if (relatedRecipes.length === 0) return '';

        var cards = relatedRecipes.map(function(rel) {
            return '<a href="recipe.html?id=' + encodeURIComponent(rel.id) + '" class="related-card">' + escHtml(rel.title || rel.id) + '</a>';
        }).join('');

        return '<section class="related-recipes">' +
            '<h3>You Might Also Like</h3>' +
            '<div class="related-cards">' + cards + '</div>' +
            '</section>';
    }

    function renderError(msg, container) {
        container.innerHTML = '<div class="recipe-page-wrapper">' +
            '<div class="recipe-warnings">' +
            '<strong>Recipe Not Found</strong>' +
            '<p>' + escHtml(msg) + '</p>' +
            '<p><a href="index.html">Back to Home</a></p>' +
            '</div>' +
            '</div>';
    }

    function parseTimeToMinutes(timeStr) {
        if (!timeStr) return 0;
        var str = timeStr.toLowerCase();
        var total = 0;
        var hours = str.match(/(\d+)\s*(h|hr|hour)/);
        if (hours) total += parseInt(hours[1]) * 60;
        var minutes = str.match(/(\d+)\s*(m|min|minute)/);
        if (minutes) total += parseInt(minutes[1]);
        return total;
    }

    function setupToolbar(recipe) {
        var multiplier = 1;

        var scalerDisp = document.getElementById('scalerDisplay');
        if (scalerDisp) scalerDisp.textContent = '1x';

        var cookBtn = document.getElementById('cookModeBtn');
        if (cookBtn) {
            cookBtn.addEventListener('click', function() { enterCookMode(recipe); });
        }

        var scalerUp = document.getElementById('scalerUp');
        var scalerDown = document.getElementById('scalerDown');
        scalerDisp = document.getElementById('scalerDisplay');
        var scalerInfo = document.getElementById('scalerInfoContainer');

        var baseServings = 1;
        if (recipe.servings) {
            var parsed = parseInt(recipe.servings);
            if (!isNaN(parsed)) baseServings = parsed;
        }

        var baseCookMinutes = recipe.cookTime ? parseTimeToMinutes(recipe.cookTime) : 0;
        var baseTotalMinutes = recipe.totalTime ? parseTimeToMinutes(recipe.totalTime) : 0;
        var basePrepMinutes = recipe.prepTime ? parseTimeToMinutes(recipe.prepTime) : 0;
        if (!baseTotalMinutes && (basePrepMinutes || baseCookMinutes)) {
            baseTotalMinutes = basePrepMinutes + baseCookMinutes;
        }

        function updateScale() {
            scalerDisp.textContent = multiplier + 'x';

            document.querySelectorAll('.ingredient-quantity[data-original]').forEach(function(el) {
                var orig = parseFloat(el.getAttribute('data-original'));
                if (!isNaN(orig)) el.textContent = formatNum(orig * multiplier);
            });

            if (scalerInfo) {
                if (multiplier === 1) {
                    scalerInfo.style.display = 'none';
                    scalerInfo.classList.add('no-print-hide');
                } else {
                    var scaledServings = Math.round(baseServings * multiplier);
                    var isBatchBaked = recipe.category === 'Biscuits' ||
                        (recipe.tags && recipe.tags.some(function(t) {
                            var tag = t.toLowerCase();
                            return tag === 'biscuit' || tag === 'snack';
                        }));

                    var infoHtml = '<strong>Scaled estimates:</strong><br>';
                    infoHtml += '• Serves: <strong>' + scaledServings + '</strong><br>';

                    if (isBatchBaked && recipe.yieldPerBatch && baseCookMinutes > 0) {
                        var perBatch = parseInt(recipe.yieldPerBatch) || baseServings;
                        var totalBatches = Math.ceil(scaledServings / perBatch);
                        var batchesPerRound = 2;
                        var rounds = Math.ceil(totalBatches / batchesPerRound);
                        var batchCookMin = baseCookMinutes;
                        var totalBatchCookMin = rounds * batchCookMin;
                        var totalBatchTimeMin = totalBatchCookMin + basePrepMinutes;
                        var totalDiff = totalBatchTimeMin - baseTotalMinutes;

                        infoHtml += '• Cook time: <strong>' + batchCookMin + ' min per batch</strong><br>';
                        infoHtml += '• Batches needed: <strong>' + totalBatches + '</strong> (' + perBatch + ' per batch, ' + rounds + ' round' + (rounds !== 1 ? 's' : '') + ' in the oven)<br>';
                        infoHtml += '• Total cook time: <strong>~' + totalBatchCookMin + ' min</strong><br>';
                        infoHtml += '• Total time: <strong>~' + totalBatchTimeMin + ' min</strong>';
                        if (Math.abs(totalDiff) >= 5) {
                            infoHtml += ' <span class="time-diff">(' + (totalDiff > 0 ? '+' : '') + totalDiff + ' min)</span>';
                        }
                        infoHtml += '<br>';
                        infoHtml += '<span class="scaling-note">Batch cooking — per-batch time stays the same. Total time scales with number of batches.</span><br>';

                    } else if (baseCookMinutes > 0) {
                        var isBaked = !isBatchBaked && recipe.tags && recipe.tags.some(function(t) {
                            return t === 'Baked' || t === 'Bread' || t === 'Cake' || t === 'Pastry';
                        });
                        var timeScaleFactor = isBaked ? Math.pow(multiplier, 0.4) : Math.pow(multiplier, 0.25);
                        var scaledCookMin = Math.round(baseCookMinutes * timeScaleFactor);
                        var scaledTotalMin = Math.round((baseTotalMinutes - baseCookMinutes) + scaledCookMin);
                        var cookDiff = scaledCookMin - baseCookMinutes;
                        var totalDiff = scaledTotalMin - baseTotalMinutes;

                        infoHtml += '• Cook time: <strong>~' + scaledCookMin + ' min</strong>';
                        if (Math.abs(cookDiff) >= 5) {
                            infoHtml += ' <span class="time-diff">(' + (cookDiff > 0 ? '+' : '') + cookDiff + ' min)</span>';
                        }
                        infoHtml += '<br>';

                        if (baseTotalMinutes > 0) {
                            infoHtml += '• Total time: <strong>~' + scaledTotalMin + ' min</strong>';
                            if (Math.abs(totalDiff) >= 5) {
                                infoHtml += ' <span class="time-diff">(' + (totalDiff > 0 ? '+' : '') + totalDiff + ' min)</span>';
                            }
                            infoHtml += '<br>';
                        }
                    }

                    infoHtml += '<span class="scaling-note">Check for doneness — scaled times are a guide only.</span>';
                    scalerInfo.innerHTML = infoHtml;
                    scalerInfo.style.display = 'block';
                    scalerInfo.classList.remove('no-print-hide');
                }
            }
        }

        if (scalerUp && scalerDown && scalerDisp) {
            scalerUp.addEventListener('click', function() {
                multiplier = Math.min(multiplier + 1, 20);
                updateScale();
            });
            scalerDown.addEventListener('click', function() {
                multiplier = Math.max(multiplier - 1, 1);
                updateScale();
            });
        }

        // Shopping List button - now calls the external shopping module
        var shopBtn = document.getElementById('shoppingListBtn');
        if (shopBtn && recipe.ingredients) {
            shopBtn.addEventListener('click', function() {
                if (window.ShoppingList && typeof window.ShoppingList.show === 'function') {
                    window.ShoppingList.show(recipe, multiplier);
                } else {
                    console.error('[recipe-renderer] ShoppingList module not loaded');
                    alert('Shopping list module not loaded. Please refresh the page.');
                }
            });
        }
    }

    function formatNum(n) {
        var fracs = { 0.25: '1/4', 0.5: '1/2', 0.75: '3/4', 0.33: '1/3', 0.67: '2/3', 0.125: '1/8' };
        var whole = Math.floor(n);
        var remainder = Math.round((n - whole) * 1000) / 1000;
        var fracPart = fracs[remainder];
        if (whole === 0) return fracPart || String(Math.round(n * 100) / 100);
        if (fracPart) return whole + ' ' + fracPart;
        return String(Math.round(n * 100) / 100);
    }

    function escHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function enterCookMode(recipe) {
        var steps = (recipe.method || []).filter(function(s) { return !s.heading; });
        if (!steps.length) return;

        var currentStep = 0;
        var wakeLock = null;

        if ('wakeLock' in navigator) {
            navigator.wakeLock.request('screen')
                .then(function(lock) { wakeLock = lock; })
                .catch(function() {});
        }

        var bar = document.createElement('div');
        bar.className = 'cook-mode-bar';
        bar.id = 'cookModeBar';
        bar.innerHTML =
            '<span class="cook-mode-step-counter" id="cmCounter"></span>' +
            '<span class="cook-mode-step-text" id="cmText"></span>' +
            '<div class="cook-mode-nav">' +
                '<button class="cook-mode-btn" id="cmPrev">&#8592; Prev</button>' +
                '<button class="cook-mode-btn" id="cmNext">Next &#8594;</button>' +
                '<button class="cook-mode-btn exit" id="cmExit">Exit</button>' +
            '</div>';

        document.body.appendChild(bar);
        document.body.classList.add('cook-mode-active');
        window.scrollTo({ top: 0, behavior: 'smooth' });

        var counter = document.getElementById('cmCounter');
        var text = document.getElementById('cmText');
        var prevBtn = document.getElementById('cmPrev');
        var nextBtn = document.getElementById('cmNext');
        var exitBtn = document.getElementById('cmExit');
        var stepEls = document.querySelectorAll('.method ol li');

        function goTo(n) {
            currentStep = n;
            var step = steps[n];
            var instruction = typeof step === 'string' ? step : (step.instruction || step.text || '');
            counter.textContent = 'Step ' + (n + 1) + ' of ' + steps.length;
            text.innerHTML = renderLinkedText(instruction);
            prevBtn.disabled = (n === 0);
            nextBtn.textContent = (n === steps.length - 1) ? 'Done' : 'Next →';
            stepEls.forEach(function(el, i) {
                el.classList.toggle('cook-mode-current', i === n);
            });
            if (stepEls[n]) {
                stepEls[n].scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }

        prevBtn.addEventListener('click', function() { if (currentStep > 0) goTo(currentStep - 1); });
        nextBtn.addEventListener('click', function() {
            if (currentStep < steps.length - 1) goTo(currentStep + 1);
            else exitCookMode();
        });
        exitBtn.addEventListener('click', exitCookMode);

        function exitCookMode() {
            document.body.classList.remove('cook-mode-active');
            var b = document.getElementById('cookModeBar');
            if (b) b.remove();
            stepEls.forEach(function(el) { el.classList.remove('cook-mode-current'); });
            if (wakeLock) { wakeLock.release(); wakeLock = null; }
        }

        goTo(0);
    }

    window.recipeRenderer = { fetchRecipe: fetchRecipe };

})();