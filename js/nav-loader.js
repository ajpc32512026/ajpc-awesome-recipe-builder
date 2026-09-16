/* =========================================================
   NAV LOADER — The Kitchen Notebook
   Fixed: graceful fallback if fetch fails (file:// protocol),
   proper search integration, no phantom errors.
   Added: active page highlighting for nav pills and links,
   breadcrumb trail on all pages.
========================================================= */

(function () {
    'use strict';

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', loadNavigation);
    } else {
        loadNavigation();
    }

    async function loadNavigation() {
        const placeholder = document.getElementById('nav-placeholder');
        if (!placeholder) return;

        try {
            const response = await fetch('components/nav.html');
            if (!response.ok) throw new Error('fetch failed');
            const html = await response.text();
            placeholder.innerHTML = html;
        } catch {
            // Fallback: inline minimal nav for file:// or server errors
            placeholder.innerHTML = buildFallbackNav();
        }

        initNavigation();
    }

    function buildFallbackNav() {
        return `<header class="nav-header">
            <div class="nav-container">
                <div class="nav-top-row">
                    <a href="index.html" class="nav-brand">The Kitchen Notebook</a>
                    <div class="nav-search">
                        <svg class="search-icon" width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                            <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="2"/>
                            <path d="M12.5 12.5L17 17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                        </svg>
                        <input type="text" id="navSearch" placeholder="Search recipes..." autocomplete="off">
                        <div class="search-results-dropdown" id="searchDropdown"></div>
                    </div>
                    <div class="nav-controls">
                        <button class="dark-mode-toggle" id="darkModeToggle" title="Toggle theme" aria-label="Toggle light/dark mode">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
                        </button>
                        <button class="mobile-menu-toggle" id="mobileMenuToggle">Menu</button>
                    </div>
                </div>
                <nav class="recipe-nav" id="mainNav">
                    <a href="index.html" class="nav-direct">Home</a>
                    <a href="search.html" class="nav-direct">Search</a>
                    <a href="gallery.html" class="nav-direct">Gallery</a>
                    <a href="tags.html" class="nav-direct">Tags</a>
                    <a href="collections.html" class="nav-direct">Collections</a>
                    <a href="pantry.html" class="nav-direct">Pantry</a>
                    <a href="daily-tracker.html" class="nav-direct">Tracker</a>
                </nav>
            </div>
        </header>`;
    }

    function initNavigation() {
        initDropdowns();
        initMobileMenu();
        initNavSearch();
        initScrollProgress();
        initBackToTop();
        initDarkMode();
        highlightCurrentPage();
        generateBreadcrumb();
    }

    /* --------------------------------------------------
       Dropdowns
    -------------------------------------------------- */
    function initDropdowns() {
        var groups = document.querySelectorAll('.nav-group');

        groups.forEach(function(group) {
            var pill = group.querySelector('.nav-pill');
            if (!pill) return;

            pill.addEventListener('click', function(e) {
                e.stopPropagation();
                var isOpen = group.classList.contains('open');

                // Close all
                groups.forEach(function(g) {
                    g.classList.remove('open');
                    var p = g.querySelector('.nav-pill');
                    if (p) p.setAttribute('aria-expanded', 'false');
                });

                if (!isOpen) {
                    group.classList.add('open');
                    pill.setAttribute('aria-expanded', 'true');
                }
            });

            // Keyboard support
            pill.addEventListener('keydown', function(e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    pill.click();
                }
                if (e.key === 'Escape') {
                    group.classList.remove('open');
                    pill.setAttribute('aria-expanded', 'false');
                    pill.focus();
                }
            });
        });

        // Close on outside click
        document.addEventListener('click', function() {
            groups.forEach(function(g) {
                g.classList.remove('open');
                var p = g.querySelector('.nav-pill');
                if (p) p.setAttribute('aria-expanded', 'false');
            });
        });
    }

    /* --------------------------------------------------
       Mobile Menu
    -------------------------------------------------- */
    function initMobileMenu() {
        var toggle = document.getElementById('mobileMenuToggle');
        var nav = document.getElementById('mainNav');
        var header = document.querySelector('.nav-header');
        if (!toggle || !nav) return;

        toggle.addEventListener('click', function() {
            var isOpen = nav.classList.toggle('mobile-open');
            toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
            toggle.textContent = isOpen ? 'Close' : 'Menu';
            if (header) header.classList.toggle('menu-open', isOpen);
        });
    }

    /* --------------------------------------------------
       Nav Search (live dropdown)
    -------------------------------------------------- */
    function initNavSearch() {
        var input = document.getElementById('navSearch');
        var dropdown = document.getElementById('searchDropdown');
        if (!input || !dropdown) return;

        var recipeIndex = null;
        var debounceTimer = null;

        async function loadIndex() {
            if (recipeIndex) return recipeIndex;
            try {
                var r = await fetch('json/recipe-index.json?t=' + Date.now());
                if (r.ok) recipeIndex = await r.json();
            } catch(e) { recipeIndex = []; }
            return recipeIndex || [];
        }

        input.addEventListener('input', function() {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(doSearch, 180);
        });

        input.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                var q = input.value.trim();
                if (q) window.location.href = 'search.html?q=' + encodeURIComponent(q);
            }
            if (e.key === 'Escape') {
                closeDropdown();
                input.blur();
            }
        });

        async function doSearch() {
            var q = input.value.trim().toLowerCase();
            if (q.length < 2) { closeDropdown(); return; }

            var index = await loadIndex();
            var matches = index
                .filter(function(r) {
                    var title = (r.title || '').toLowerCase();
                    var tags = (r.tags || []).join(' ').toLowerCase();
                    var cat = (r.category || '').toLowerCase();
                    return title.indexOf(q) !== -1 || tags.indexOf(q) !== -1 || cat.indexOf(q) !== -1;
                })
                .slice(0, 8);

            if (!matches.length) {
                dropdown.innerHTML = '<div class="search-no-results">No results for "<strong>' + escHtml(q) + '</strong>"</div>';
            } else {
                dropdown.innerHTML = matches.map(function(r) {
                    return '<a href="recipe.html?id=' + encodeURIComponent(r.id) + '" class="search-result-item" role="option">' +
                        '<strong>' + highlightMatch(r.title || r.id, q) + '</strong>' +
                        (r.category ? '<span class="nav-search-cat">' + escHtml(r.category) + '</span>' : '') +
                    '</a>';
                }).join('');
            }

            dropdown.classList.add('visible');
        }

        function closeDropdown() {
            dropdown.classList.remove('visible');
            dropdown.innerHTML = '';
        }

        document.addEventListener('click', function(e) {
            if (!input.contains(e.target) && !dropdown.contains(e.target)) closeDropdown();
        });
    }

    function highlightMatch(text, query) {
        var safe = escHtml(text);
        var idx = safe.toLowerCase().indexOf(query.toLowerCase());
        if (idx === -1) return safe;
        return safe.slice(0, idx)
            + '<mark class="search-highlight">'
            + safe.slice(idx, idx + query.length)
            + '</mark>'
            + safe.slice(idx + query.length);
    }

    function escHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    /* --------------------------------------------------
       Scroll Progress Bar
    -------------------------------------------------- */
    function initScrollProgress() {
        var bar = document.getElementById('scrollProgress');
        if (!bar) return;

        function update() {
            var docH = document.documentElement.scrollHeight - window.innerHeight;
            bar.style.width = docH > 0 ? (window.scrollY / docH * 100) + '%' : '0%';
        }

        window.addEventListener('scroll', update, { passive: true });
    }

    /* --------------------------------------------------
       Back To Top
    -------------------------------------------------- */
    function initBackToTop() {
        var btn = document.getElementById('backToTop');
        if (!btn) return;

        window.addEventListener('scroll', function() {
            btn.classList.toggle('visible', window.scrollY > 400);
        }, { passive: true });

        btn.addEventListener('click', function() {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }

    /* --------------------------------------------------
       Dark Mode Toggle
       The site is LIGHT by default now. Toggle adds 'light-mode'
       to body for... history's sake, the class name stayed the
       same even though it's now the default rather than the
       exception — only .light-mode's ABSENCE now means dark.
    -------------------------------------------------- */
    function initDarkMode() {
        var btn = document.getElementById('darkModeToggle');
        if (!btn) return;

        const sunIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`;
        const moonIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;

        function applyLight(on) {
            document.body.classList.toggle('light-mode', on);
            btn.innerHTML = on ? moonIcon : sunIcon;
            btn.title = on ? 'Switch to dark mode' : 'Switch to light mode';
        }

        // Light is now the default for anyone who hasn't chosen yet —
        // only an explicit "dark" in localStorage keeps dark mode.
        var stored = localStorage.getItem('ajpc-theme');
        applyLight(stored !== 'dark');

        btn.addEventListener('click', function() {
            var isLight = document.body.classList.contains('light-mode');
            applyLight(!isLight);
            localStorage.setItem('ajpc-theme', isLight ? 'dark' : 'light');
        });
    }

    /* --------------------------------------------------
       Highlight Current Page Link
       Highlights recipe links, reference pages, and direct links
       based on the current URL.
    -------------------------------------------------- */
    function highlightCurrentPage() {
        var path = window.location.pathname.split('/').pop() || 'index.html';
        var params = new URLSearchParams(window.location.search);
        var currentId = params.get('id');

        // Highlight recipe in dropdowns
        if (currentId) {
            var safeId = (window.CSS && CSS.escape) ? CSS.escape(currentId) : currentId.replace(/(["\\\]\[])/g, '\\$1');
            var recipeLinks = document.querySelectorAll('.dropdown a[href="recipe.html?id=' + safeId + '"]');
            recipeLinks.forEach(function(link) {
                link.style.color = 'var(--copper-warm)';
                link.style.fontWeight = '600';
                // Highlight the parent pill
                var group = link.closest('.nav-group');
                if (group) {
                    var pill = group.querySelector('.nav-pill');
                    if (pill) {
                        pill.style.color = 'var(--copper-warm)';
                        pill.style.borderColor = 'var(--border-copper)';
                    }
                }
            });
        }

        // Highlight reference pages and HTML links
        document.querySelectorAll('.dropdown a[href$=".html"]').forEach(function(link) {
            var href = link.getAttribute('href') || '';
            if (href === path) {
                link.style.color = 'var(--copper-warm)';
                link.style.fontWeight = '600';
                var group = link.closest('.nav-group');
                if (group) {
                    var pill = group.querySelector('.nav-pill');
                    if (pill) {
                        pill.style.color = 'var(--copper-warm)';
                        pill.style.borderColor = 'var(--border-copper)';
                    }
                }
            }
        });

        // Highlight direct links (Gallery, Search, Print All, Builder)
        document.querySelectorAll('.nav-direct').forEach(function(link) {
            var href = link.getAttribute('href') || '';
            if (href === path || (path === '' && href === 'index.html')) {
                link.style.color = 'var(--copper-warm)';
                link.style.fontWeight = '600';
                link.style.borderColor = 'var(--border-copper)';
            }
        });
    }

    /* --------------------------------------------------
       Breadcrumb Trail
       Generates a breadcrumb trail for all pages
    -------------------------------------------------- */
    function generateBreadcrumb() {
        const path = window.location.pathname;
        const page = path.split('/').pop().replace('.html', '');
        const pageName = page
            .split(/[-_]/)
            .map(function(word) { return word.charAt(0).toUpperCase() + word.slice(1); })
            .join(' ');
        
        let breadcrumbHtml = '<div class="breadcrumb">';
        breadcrumbHtml += '<a href="index.html">Home</a> <span>/</span> ';
        
        if (page === 'search') {
            const query = new URLSearchParams(window.location.search).get('q');
            breadcrumbHtml += `<span>Search</span>`;
            if (query) breadcrumbHtml += ` <span>/</span> <span>${escHtml(query)}</span>`;
        } else if (page === 'measurement') {
            breadcrumbHtml += `<span>Reference</span> <span>/</span> <span>Measurements</span>`;
        } else if (page === 'culinaryterms') {
            breadcrumbHtml += `<span>Reference</span> <span>/</span> <span>Culinary Terms</span>`;
        } else if (page === 'breadtips') {
            breadcrumbHtml += `<span>Reference</span> <span>/</span> <span>Bread Tips</span>`;
        } else if (page === 'cheesesaucetips') {
            breadcrumbHtml += `<span>Reference</span> <span>/</span> <span>Cheese Sauce Tips</span>`;
        } else if (page === 'tangzhongguide') {
            breadcrumbHtml += `<span>Reference</span> <span>/</span> <span>Tangzhong Guide</span>`;
        } else if (page === 'puffpastrymethods') {
            breadcrumbHtml += `<span>Reference</span> <span>/</span> <span>Puff Pastry Methods</span>`;
        } else if (page === 'gelatin-blooming-guide') {
            breadcrumbHtml += `<span>Reference</span> <span>/</span> <span>Gelatine Blooming</span>`;
        } else if (page === 'ingredient_directory') {
            breadcrumbHtml += `<span>Reference</span> <span>/</span> <span>Ingredient Directory</span>`;
        } else if (page === 'about') {
            breadcrumbHtml += `<span>About</span>`;
        } else if (page === 'colophon') {
            breadcrumbHtml += `<span>Colophon</span>`;
        } else if (page === 'sitemap') {
            breadcrumbHtml += `<span>Sitemap</span>`;
        } else if (page === 'gallery') {
            breadcrumbHtml += `<span>Gallery</span>`;
        } else if (page === 'tags') {
            breadcrumbHtml += `<span>Discovery</span> <span>/</span> <span>Tag Cloud</span>`;
        } else if (page === 'collections') {
            breadcrumbHtml += `<span>Organisation</span> <span>/</span> <span>Collections</span>`;
        } else if (page === 'daily-tracker') {
            breadcrumbHtml += `<span>Nutrition</span> <span>/</span> <span>Daily Tracker</span>`;
        } else if (page === 'recipe-builder') {
            breadcrumbHtml += `<span>Recipe Builder</span>`;
        } else if (page === 'print-all' || page === 'print-all-recipes') {
            breadcrumbHtml += `<span>Print All</span>`;
        } else if (page === '404') {
            breadcrumbHtml = '<div class="breadcrumb"><span>Page Not Found</span></div>';
        } else if (page === '' || page === 'index') {
            breadcrumbHtml = '<div class="breadcrumb"><span>Home</span></div>';
        } else {
            breadcrumbHtml += `<span>${escHtml(pageName)}</span>`;
        }
        
        breadcrumbHtml += '</div>';
        
        const mainContent = document.querySelector('main');
        if (mainContent && !document.querySelector('.breadcrumb')) {
            mainContent.insertAdjacentHTML('afterbegin', breadcrumbHtml);
        }
    }

})();