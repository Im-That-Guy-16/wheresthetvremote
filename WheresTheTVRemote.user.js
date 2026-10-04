// ==UserScript==
// @name         STMPE-Enriched
// @namespace    https://broadcasthe.net/
// @version      1.15.25
// @description  A combination of userscripts that enrich the TV series experience, all managed from one panel on your profile settings page. Features: Enhanced Series Hero, Sonarr Integration, Fanart.tv Logo, Latest Season Synopsis, IMDb Parents Guide, Trending Shows, Homepage Stats Strip, Homepage Latest Uploads, Homepage Featured Cards, Sonarr Upcoming Episodes, Torrent Detail MediaInfo Summary, Site Badge Labels, Recommendation Info Modal, Artwork Placeholders, Hide Empty Requests, Collapse Old Seasons, Trailer Player (fixed), Cast Row (TMDb), Season Browser (TMDb), Similar Shows (TMDb), Actor Search (TMDb), Actor Showcase (TMDb), Enhanced Series Summary, Stamps Row, and Fan Art Carousels.
// @author       Prism16
// @match        *://broadcasthe.net/*
// @match        *://www.broadcasthe.net/*
// @updateURL    https://Im-That-Guy-16.github.io/wheresthetvremote/WheresTheTVRemote.user.js
// @downloadURL  https://Im-That-Guy-16.github.io/wheresthetvremote/WheresTheTVRemote.user.js
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM.xmlHttpRequest
// @grant        GM.setValue
// @grant        GM.getValue
// @grant        GM.deleteValue
// @connect      *
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  // Which BTN page are we on? The script now works on two:
  //   • series.php            -> banner pills (per-server red/green status)
  //   • user.php?action=edit  -> the two settings panels (Manager + Sonarr Settings)
  const PATH = location.pathname;
  const IS_SERIES = /^\/series\.php\b/i.test(PATH);
  const IS_ACTOR  = /^\/actor\.php\b/i.test(PATH);
  const IS_ACTOR_SHOWCASE = /^\/actorshowcase\.php\b/i.test(PATH);
  const IS_RECOMMEND = /^\/recommend\.php\b/i.test(PATH);
  const IS_EDIT   = /^\/user\.php\b/i.test(PATH) && /(?:^|[?&])action=edit(?:&|$)/i.test(location.search);
  const IS_HOME   = /^\/(index\.php)?$/i.test(PATH);
  const IS_TORRENT_DETAIL = /^\/torrents\.php\b/i.test(PATH) && /(?:^|[?&])id=\d+(?:&|$)/i.test(location.search);
  const IS_COLLAGE = /^\/collages\.php\b/i.test(PATH);
  // The placeholder feature runs on ANY BTN page (series, torrents browse, etc.),
  // so we only bail out if we're somehow not on BroadcasTheNet at all.
  if (!/(^|\.)broadcasthe\.net$/i.test(location.hostname)) return;

  /* =========================================================================
   * Storage (shared GM cache — synchronous reads after one async hydrate)
   * =======================================================================*/
  const STORE_KEY = 'btn_sonarr_servers_v1';
  const FEAT_KEY  = 'btn_userscript_features_v1';
  const KEYS_KEY  = 'btn_userscript_keys_v1';
  const OPTS_KEY  = 'btn_userscript_opts_v1';

  const GMstore = {
    get(key, def) {
      if (typeof GM_getValue === 'function') return Promise.resolve(GM_getValue(key, def));
      if (typeof GM !== 'undefined' && GM && typeof GM.getValue === 'function') return Promise.resolve(GM.getValue(key, def));
      try { const v = localStorage.getItem('GM_' + key); return Promise.resolve(v == null ? def : v); }
      catch (e) { return Promise.resolve(def); }
    },
    set(key, val) {
      if (typeof GM_setValue === 'function') { try { GM_setValue(key, val); } catch (e) {} return Promise.resolve(); }
      if (typeof GM !== 'undefined' && GM && typeof GM.setValue === 'function') return Promise.resolve(GM.setValue(key, val));
      try { localStorage.setItem('GM_' + key, val); } catch (e) {}
      return Promise.resolve();
    }
  };

  /* ---- servers ---- */
  let serversCache = [];
  function parseServers(raw) {
    try { const a = JSON.parse(raw || '[]'); return Array.isArray(a) ? a : []; }
    catch (e) { return []; }
  }
  function loadServers() { return serversCache.map(s => Object.assign({}, s)); }
  function saveServers(list) {
    serversCache = list.map(s => Object.assign({}, s));
    GMstore.set(STORE_KEY, JSON.stringify(serversCache));
  }
  function newId() { return 's_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function blankServer() {
    return {
      id: newId(), name: '', url: '', apiKey: '',
      qualityProfileId: null, rootFolderPath: '', languageProfileId: null,
      seasonFolder: true, searchOnAdd: true, monitor: 'all',
      _profiles: [], _rootFolders: [], _languageProfiles: [], _version: null
    };
  }

  /* ---- TMDb list options for the homepage row ---- */
  const TMDB_LISTS = [
    { value: 'trending_day',  label: 'Trending Today',      path: '/trending/tv/day',  title: 'Trending Today' },
    { value: 'trending_week', label: 'Trending This Week',  path: '/trending/tv/week', title: 'Trending This Week' },
    { value: 'popular',       label: 'Popular',             path: '/tv/popular',       title: 'Popular Shows' },
    { value: 'top_rated',     label: 'Top Rated',           path: '/tv/top_rated',     title: 'Top Rated Shows' },
    { value: 'airing_today',  label: 'Airing Today',        path: '/tv/airing_today',  title: 'Airing Today' },
    { value: 'on_the_air',    label: 'On The Air (this week)', path: '/tv/on_the_air',  title: 'On The Air' }
  ];
  const TMDB_LIST_DEFAULT = 'trending_day';

  /* ---- feature flags (Userscript Manager) ---- */
  const FEATURE_DEFS = [
    { id: 'serieshero', name: 'Enhanced Series Hero', def: true,
      desc: 'Replace the native BTN banner on series and season torrent pages with a compact TMDb-powered hero.' },
    { id: 'sonarr', name: 'Sonarr Integration', def: true,
      desc: 'Add a red/green Sonarr status link per server to the series link bar, and add shows to Sonarr in one click.' },
    { id: 'seasons', name: 'Collapse Old Seasons', def: true,
      desc: 'On series pages, automatically collapse every season except the most recent. The (show)/(hide) links stay clickable to expand any season.' },
    { id: 'fanart', name: 'Fanart.tv Logo', def: true, needsKey: true, keyLabel: 'Fanart.tv API Key',
      defKey: '8a3d24a20c50c65c9f729fa3e67eebd2', keyPlaceholder: 'Your fanart.tv personal API key',
      desc: 'Fetch the show’s HD clear logo from fanart.tv and place it at the top of the series sidebar.' },
    { id: 'seasonsynopsis', name: 'Latest Season Synopsis', def: true,
      desc: 'On series pages, add a quiet sidebar card under the poster when TMDb has a synopsis for the latest season.' },
    { id: 'parents', name: 'IMDb Parents Guide', def: true,
      desc: 'Show a colour-coded Parents Guide (nudity, violence, profanity, etc.) as category cards below the torrent table on series pages, with a UK certificate badge and 7-day caching.' },
    { id: 'trending', name: 'Homepage TMDb Row', def: true, needsKey: true, keyLabel: 'TMDb API Key',
      defKey: '75c8f6d3dd058fe33f10db544d0cbb6b', keyPlaceholder: 'Your TMDb API v3 key',
      select: { label: 'Show', options: TMDB_LISTS, default: TMDB_LIST_DEFAULT },
      desc: 'Add a row of UK/US TV shows from TMDb to the top of the homepage — pick the list below (Trending, Popular, Airing Today…). Each poster links to a BTN series search, with an info card on hover.' },
    { id: 'homestats', name: 'Homepage Stats Strip', def: true,
      desc: 'Rebuild the homepage Stats panel as a compact full-width dashboard strip instead of tall legacy columns.' },
    { id: 'homeuploads', name: 'Homepage Latest Uploads', def: true,
      desc: 'Replace the rotating Last 5 Uploads poster widget with a compact text list and hover details.' },
    { id: 'homefeatures', name: 'Homepage Featured Cards', def: true,
      desc: 'Enrich the homepage Featured Series and Featured Actor panels with TMDb backdrops, metadata, synopsis, cast/credits and cleaner BTN/TMDb actions. Uses the TMDb key from the Homepage TMDb Row.' },
    { id: 'homenewseriescarousel', name: 'Homepage New Series Carousel', def: true,
      desc: 'Turn the native “New Series in the Past 30 Days” homepage panel into a compact 2-row, 3-column carousel with left/right page arrows and gentle auto-scroll until you interact with it.' },
    { id: 'homecalendar', name: 'Sonarr Upcoming Episodes', def: true,
      desc: 'Add a compact homepage sidebar card showing today and tomorrow from Sonarr server 1, grouped by air date.' },
    { id: 'torrenttouchups', name: 'Torrent Detail MediaInfo Summary', def: true,
      desc: 'On torrent detail pages, add a modern MediaInfo summary and collapse long file lists/full MediaInfo behind clean toggles.' },
    { id: 'browsetags', name: 'Site Badge Labels', def: true,
      desc: 'Replace old BTN browse-tag images, like AutoUp and upload multiplier badges, with clean text labels across the site.' },
    { id: 'recommendmodal', name: 'Recommendation Info Modal', def: true,
      desc: 'Replace the sparse Recommendations info popup with a rich TMDb modal for the clicked show.' },
    { id: 'placeholder', name: 'Artwork Placeholders', def: true,
      desc: 'Replace BTN’s default “No Poster / No Banner / No Fan Art” images with a clean placeholder that matches the theme — everywhere they appear, including torrent-table thumbnails.' },
    { id: 'hidereq', name: 'Requests Panel', def: true,
      desc: 'On a series page, redraw open requests as a 3-up card grid instead of a bare table, or hide the section entirely when it has none (“Nothing found!”).' },
    { id: 'seriesactionbar', name: 'Series Action Glyph Bar', def: true,
      desc: 'Move the series-page action row (Notify, Favorite, Autofill Actors, Edit, View History) to the top of the sidebar and redraw it as a compact icon bar with tooltips instead of bracketed text links.' },
    { id: 'trailer', name: 'Trailer Player (fixed)', def: true,
      desc: 'Fix the broken (Flash / Error 153) trailer: play it in a clean pop-up YouTube player. Uses the show’s BTN trailer, falling back to TMDb’s official trailer when BTN has none (uses the TMDb key above).' },
    { id: 'actors', name: 'Cast Row (TMDb)', def: true,
      desc: 'Replace BTN’s plain sidebar Actors list with a horizontal cast row above the Fan Art — TMDb photos and character names, each still linking to the actor’s BTN page (uses the TMDb key above).' },
    { id: 'seasonbrowser', name: 'Season Browser (TMDb)', def: true,
      desc: 'Add a Seasons Browser card below Cast on series pages: poster row by season, with a click-to-open animated episode table. Uses TMDb first, then Fanart.tv season posters when available.' },
    { id: 'similar', name: 'Similar Shows (TMDb)', def: true,
      desc: 'Add a horizontal poster row of similar shows (from TMDb) in a card directly below the Cast card. Each poster links to a BTN series search by name — never by ID (uses the TMDb key above).' },
    { id: 'actorsearch', name: 'Actor Search (TMDb)', def: true,
      desc: 'Repair and enrich BTN actor search pages with TMDb person matches, biography, social links and detailed TV credits. Uses the TMDb key from the Homepage TMDb Row.' },
    { id: 'actorshowcase', name: 'Actor Showcase (TMDb)', def: true,
      desc: 'Modernise BTN’s Actors Showcase with TMDb profile photos, clean cards and known-for TV credits. Uses the TMDb key from the Homepage TMDb Row.' },
    { id: 'enhsummary', name: 'Enhanced Series Summary', def: true,
      desc: 'Fold the sidebar Latest Episode, Next Episode and Genres panels into the Series Summary card and enrich it with TMDb (rating, status, network, run, episode stills/dates). Keeps the existing description and external links, and hides the broken YouTube/Flash sidebar card.' },
    { id: 'stamps', name: 'Stamps Row', def: true,
      desc: 'Move the Buy Stamps panel out of the sidebar into a long horizontal row across the bottom of the main column.' },
    { id: 'artwork', name: 'Fan Art Carousels', def: true,
      desc: 'Fill the Series Fan Art card with fanart.tv artwork — backgrounds, posters, banners, thumbnails, clear art, character art and logos — as controllable single-image carousels (uses the Fanart.tv key above).' },
    { id: 'collectwizard', name: 'Series Collection Wizard', def: true,
      desc: 'Collapse the Series Collector panel to its heading and put a step-by-step wizard behind it: one question at a time, each answer written into the site\u2019s own control, with a review screen before anything downloads. The collecting itself is still the site\u2019s.' },
    { id: 'news', name: 'Collapsible News', def: true,
      desc: 'Add a collapse toggle to the front-page news post so you can hide it once you’ve read it. It remembers your choice per article, and re-opens automatically when a new news post is published.' },
    { id: 'collageactionbar', name: 'Collage Action Glyph Bar', def: true,
      desc: 'Move the collage-page action row (List of Collages, New Collage, Edit Description, Manage Torrents) to the top of the sidebar and redraw it as a compact icon bar with tooltips instead of bracketed text links.' },
    { id: 'lighttheme', name: 'Light Mode', def: false, hidden: true,
      desc: 'Switch the site to a light page background, keeping every card, table and toolbar as a frosted dark-glass panel.' }
    // future features slot in here — the manager panel renders whatever is listed.
    // (a `hidden:true` feature is still fully wired up — isEnabled()/setFeature()
    // work normally — it's just skipped when the manager panel renders rows.)
  ];
  const FEATURE_GROUPS = [
    {
      title: 'Series Pages',
      note: 'Main show-page layout, metadata and episode browsing.',
      ids: ['serieshero', 'enhsummary', 'seasonsynopsis', 'seasonbrowser', 'seasons', 'hidereq', 'seriesactionbar', 'parents', 'stamps', 'collectwizard']
    },
    {
      title: 'Artwork & Media',
      note: 'Images, trailers, logos and fan art.',
      ids: ['fanart', 'artwork', 'placeholder', 'trailer']
    },
    {
      title: 'Homepage',
      note: 'Front-page cards, rows and tidy-ups.',
      ids: ['trending', 'homestats', 'homeuploads', 'homefeatures', 'homenewseriescarousel', 'homecalendar', 'news']
    },
    {
      title: 'Discovery',
      note: 'Cast, similar shows and actor pages.',
      ids: ['actors', 'similar', 'recommendmodal', 'actorsearch', 'actorshowcase']
    },
    {
      title: 'Torrent Pages',
      note: 'Torrent detail page cleanup and release information.',
      ids: ['torrenttouchups', 'browsetags']
    },
    {
      title: 'Automation',
      note: 'Server links and add-to-library helpers.',
      ids: ['sonarr']
    },
    {
      title: 'Collage Pages',
      note: 'Collage detail page layout and actions.',
      ids: ['collageactionbar']
    }
  ];
  let featuresCache = {};
  let keysCache = {};
  function isEnabled(id) {
    if (Object.prototype.hasOwnProperty.call(featuresCache, id)) return !!featuresCache[id];
    const d = FEATURE_DEFS.find(f => f.id === id);
    return d ? !!d.def : false;
  }
  function setFeature(id, on) {
    featuresCache[id] = !!on;
    GMstore.set(FEAT_KEY, JSON.stringify(featuresCache));
  }
  function getKey(id) {
    if (Object.prototype.hasOwnProperty.call(keysCache, id)) return keysCache[id] || '';
    const d = FEATURE_DEFS.find(f => f.id === id);
    return (d && d.defKey) ? d.defKey : '';
  }
  function setKey(id, val) {
    keysCache[id] = val;
    GMstore.set(KEYS_KEY, JSON.stringify(keysCache));
  }

  /* ---- per-feature options (e.g. the homepage list choice) ---- */
  let optsCache = {};
  function getOpt(id, def) {
    return Object.prototype.hasOwnProperty.call(optsCache, id) ? optsCache[id] : def;
  }
  function setOpt(id, val) {
    optsCache[id] = val;
    GMstore.set(OPTS_KEY, JSON.stringify(optsCache));
  }

  async function initStorage() {
    const [rawServers, rawFeat, rawKeys, rawOpts] = await Promise.all([
      GMstore.get(STORE_KEY, '[]'),
      GMstore.get(FEAT_KEY, '{}'),
      GMstore.get(KEYS_KEY, '{}'),
      GMstore.get(OPTS_KEY, '{}')
    ]);
    serversCache = parseServers(rawServers);
    try { featuresCache = JSON.parse(rawFeat || '{}') || {}; } catch (e) { featuresCache = {}; }
    try { keysCache = JSON.parse(rawKeys || '{}') || {}; } catch (e) { keysCache = {}; }
    try { optsCache = JSON.parse(rawOpts || '{}') || {}; } catch (e) { optsCache = {}; }
  }

  /* =========================================================================
   * Sonarr API helper (GM_xmlhttpRequest bypasses CORS / mixed content)
   * =======================================================================*/
  function normBase(url) {
    let u = (url || '').trim();
    if (!u) return '';
    if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
    return u.replace(/\/+$/, '');
  }
  function gmXhr(opts) {
    if (typeof GM_xmlhttpRequest === 'function') return GM_xmlhttpRequest(opts);
    if (typeof GM !== 'undefined' && GM && typeof GM.xmlHttpRequest === 'function') return GM.xmlHttpRequest(opts);
    throw new Error('No GM_xmlhttpRequest / GM.xmlHttpRequest available — check the userscript @grant lines');
  }
  function sonarrRequest(server, path, { method = 'GET', body = null } = {}) {
    const url = normBase(server.url) + path;
    return new Promise((resolve, reject) => {
      gmXhr({
        method, url,
        headers: { 'X-Api-Key': (server.apiKey || '').trim(), 'Accept': 'application/json', 'Content-Type': 'application/json' },
        data: body ? JSON.stringify(body) : undefined,
        timeout: 15000,
        onload: (res) => {
          let data = null;
          try { data = res.responseText ? JSON.parse(res.responseText) : null; } catch (e) {}
          if (res.status >= 200 && res.status < 300) resolve({ status: res.status, data });
          else reject({
            status: res.status,
            message: (data && (data.message || data.error)) ||
                     (res.status === 401 ? 'Unauthorized — check the API key' :
                      res.status === 404 ? 'Endpoint not found — check the URL / base path' : 'HTTP ' + res.status),
            data
          });
        },
        ontimeout: () => reject({ status: 0, message: 'Request timed out (15s)' }),
        onerror: () => reject({ status: 0, message: 'Network error — URL unreachable, or Sonarr not running' })
      });
    });
  }
  const SonarrAPI = {
    status: (s) => sonarrRequest(s, '/api/v3/system/status'),
    qualityProfiles: (s) => sonarrRequest(s, '/api/v3/qualityprofile'),
    rootFolders: (s) => sonarrRequest(s, '/api/v3/rootfolder'),
    languageProfiles: (s) => sonarrRequest(s, '/api/v3/languageprofile'),
    calendar: (s, start, end) => sonarrRequest(s, '/api/v3/calendar?start=' + encodeURIComponent(start) + '&end=' + encodeURIComponent(end) + '&includeSeries=true'),
    lookup: (s, term) => sonarrRequest(s, '/api/v3/series/lookup?term=' + encodeURIComponent(term)),
    seriesByTvdb: (s, tvdbId) => sonarrRequest(s, '/api/v3/series?tvdbId=' + encodeURIComponent(tvdbId)),
    addSeries: (s, payload) => sonarrRequest(s, '/api/v3/series', { method: 'POST', body: payload })
  };

  /* =========================================================================
   * Page facts (series identity for the add flow)
   * =======================================================================*/
  function cleanText(s) {
    return String(s == null ? '' : s).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function parseSeasonPageInfo() {
    if (!IS_TORRENT_DETAIL) return null;
    const h2 = document.querySelector('#content .thin > h2');
    if (!h2 || !h2.querySelector('a[href*="series.php"]')) return null;
    const img = h2.querySelector('img');
    const docTitle = cleanText((document.title || '').replace(/\s*::\s*BroadcasTheNet\s*$/i, ''));
    const h2Text = cleanText(h2.textContent || '');
    const fromDoc = docTitle.match(/^(.+?)\s+-\s+Season\s+(\d+)(?:\s*\[(\d{4})\])?$/i);
    const fromH2 = h2Text.match(/^Season\s+(\d+)(?:\s*\[(\d{4})\])?$/i);
    const seriesTitle = cleanText(
      (fromDoc && fromDoc[1]) ||
      (img && (img.alt || '').replace(/\s+-\s+Season\s+\d+.*$/i, '')) ||
      (img && (img.title || '').replace(/\s+-\s+Season\s+\d+.*$/i, ''))
    );
    const seasonNumber = Number((fromDoc && fromDoc[2]) || (fromH2 && fromH2[1]) || 0) || null;
    const seasonYear = (fromDoc && fromDoc[3]) || (fromH2 && fromH2[2]) || '';
    if (!seriesTitle || !seasonNumber) return null;
    const seriesHref = (h2.querySelector('a[href*="series.php"]') || {}).href || '';
    return {
      isSeasonPage: true,
      seriesTitle,
      seasonNumber,
      seasonYear,
      seriesHref,
      displayTitle: seriesTitle + ' - Season ' + seasonNumber
    };
  }

  function seriesInfo() {
    try {
      const seasonInfo = parseSeasonPageInfo();
      const imageSources = [
        document.querySelector('#banner'),
        document.querySelector('#content .thin > h2 img'),
        ...document.querySelectorAll('#content .thin > .sidebar img')
      ].filter(Boolean).map(img => img.src || img.getAttribute('src') || '');
      let tvdbId = null;
      for (const src of imageSources) {
        tvdbId =
          (src.match(/\/v4\/series\/(\d+)\//) || [])[1] ||
          (src.match(/\/series\/(\d+)\//) || [])[1] ||
          (src.match(/\/graphical\/(\d+)-/) || [])[1] ||
          (src.match(/\/(?:posters|fanart|seasons|banners)\/(\d+)-/) || [])[1] || null;
        if (tvdbId) break;
      }
      if (!tvdbId) {
        const tv = document.querySelector('a[href*="thetvdb.com"]');
        if (tv) tvdbId = (tv.href.match(/[?&](?:id|seriesid)=(\d+)/i) || [])[1] || null;
      }
      const imdbA = document.querySelector('a[href*="imdb.com/title/"]');
      const imdbId = imdbA ? ((imdbA.href.match(/title\/(tt\d+)/i) || [])[1] || null) : null;
      const docTitle = cleanText((document.title || '').replace(/\s*::\s*BroadcasTheNet\s*$/i, ''));
      const title = (seasonInfo && seasonInfo.seriesTitle) || docTitle;
      return Object.assign({ tvdbId, imdbId, title }, seasonInfo || {});
    } catch (e) {
      return { tvdbId: null, imdbId: null, title: cleanText((document.title || '').replace(/\s*::\s*BroadcasTheNet\s*$/i, '')) };
    }
  }

  /* =========================================================================
   * Styles — everything keys off the STMPE theme vars, with safe fallbacks so
   * it still renders fine if the theme isn't loaded.
   * =======================================================================*/
  const CSS = `
  .snr, .snr * { box-sizing: border-box; }

  /* ---- settings panels (injected into #slider .scrollContainer) ---- */
  .snr-panel{
    background:var(--bg-2,#12151a); border:1px solid var(--line,#232830); border-radius:12px;
    padding:0 20px 18px; margin:0 0 18px; box-sizing:border-box; vertical-align:top;
    display:inline-block; width:100%; break-inside:avoid; -webkit-column-break-inside:avoid;
    color:var(--text-1,#cdd4de); font-size:13px;
  }
  .snr-panel-title{
    font-family:var(--fd,inherit); font-weight:600; font-size:14px; color:var(--text-1,#cdd4de);
    letter-spacing:.01em; padding:14px 0 12px; margin-bottom:12px; border-bottom:1px solid var(--line,#232830);
  }

  /* ---- manager feature rows ---- */
  .snr-manager-intro{ margin:-3px 0 14px; color:var(--text-3,#7d8794); font-size:12px; line-height:1.5; }
  .snr-feature-group{
    border:1px solid rgba(255,255,255,.07); border-radius:11px; overflow:hidden; margin:0 0 12px;
    background:linear-gradient(180deg,rgba(255,255,255,.026),rgba(255,255,255,.01));
  }
  .snr-feature-group:last-child{ margin-bottom:0; }
  .snr-group-head{
    display:flex; align-items:flex-start; justify-content:space-between; gap:14px;
    padding:10px 13px; border-bottom:1px solid rgba(255,255,255,.055);
    background:rgba(255,255,255,.025);
  }
  .snr-group-title{
    color:var(--text,#f4f7fb); font-family:var(--fd,inherit); font-weight:700; font-size:12.5px;
    text-transform:uppercase; letter-spacing:.08em;
  }
  .snr-group-note{ color:var(--text-3,#7d8794); font-size:11px; line-height:1.35; margin-top:3px; }
  .snr-group-count{ color:var(--accent-bright,#3fc8ff); font-size:11px; font-weight:700; white-space:nowrap; padding-top:1px; }
  .snr-group-body{ padding:0 13px; }
  .snr-feat{ display:flex; align-items:flex-start; gap:14px; padding:11px 0; border-bottom:1px solid rgba(255,255,255,.05); }
  .snr-feat:last-child{ border-bottom:none; }
  .snr-feat .meta{ flex:1 1 auto; min-width:0; }
  .snr-feat .meta b{ color:var(--text,#f4f7fb); font-weight:600; }
  .snr-feat .meta .d{ color:var(--text-3,#7d8794); font-size:11.5px; margin-top:3px; line-height:1.5; }
  .snr-keyrow{ margin-top:9px; }
  .snr-keyrow > label{ display:block; margin-bottom:5px; color:var(--text-2,#9aa4b2); font-weight:600; font-size:11.5px; }
  .snr-keyinput{
    width:100%; padding:7px 10px; background:var(--bg-1,#0c0e12); color:var(--text,#f4f7fb);
    border:1px solid var(--line-2,#2d333c); border-radius:8px; font-size:12.5px; letter-spacing:.02em;
    font-family:var(--ff,inherit);
  }
  .snr-keyinput:focus{ outline:none; border-color:var(--accent,#1f9dff); box-shadow:0 0 0 3px rgba(31,157,255,.15); }
  .snr-selrow{ margin-top:9px; }
  .snr-selrow > label{ display:block; margin-bottom:5px; color:var(--text-2,#9aa4b2); font-weight:600; font-size:11.5px; }
  .snr-selinput{
    width:100%; padding:7px 10px; background:var(--bg-1,#0c0e12); color:var(--text,#f4f7fb);
    border:1px solid var(--line-2,#2d333c); border-radius:8px; font-size:12.5px; font-family:var(--ff,inherit); cursor:pointer;
  }
  .snr-selinput:focus{ outline:none; border-color:var(--accent,#1f9dff); box-shadow:0 0 0 3px rgba(31,157,255,.15); }

  /* toggle switch */
  .snr-switch{ position:relative; width:42px; height:23px; flex:0 0 auto; display:inline-block; cursor:pointer; margin-top:2px; }
  .snr-switch input{ position:absolute; opacity:0; width:0; height:0; }
  .snr-switch .track{ position:absolute; inset:0; background:var(--bg-4,#20252d); border:1px solid var(--line-2,#2d333c); border-radius:999px; transition:.15s; }
  .snr-switch .thumb{ position:absolute; top:3px; left:3px; width:17px; height:17px; border-radius:50%; background:var(--text-3,#7d8794); transition:.15s; }
  .snr-switch input:checked ~ .track{ background:rgba(31,157,255,.22); border-color:var(--accent,#1f9dff); }
  .snr-switch input:checked ~ .thumb{ left:22px; background:var(--accent-bright,#3fc8ff); }

  /* ---- fields ---- */
  .snr-field{ margin-bottom:14px; }
  .snr-field > label{ display:block; margin-bottom:5px; color:var(--text-2,#9aa4b2); font-weight:600; font-size:12px; }
  .snr-field input[type=text], .snr-field input[type=url], .snr-field input[type=password], .snr-field select{
    width:100%; padding:8px 10px; background:var(--bg-1,#0c0e12); color:var(--text,#f4f7fb);
    border:1px solid var(--line-2,#2d333c); border-radius:8px; font-size:13px;
  }
  .snr-field input:focus, .snr-field select:focus{ outline:none; border-color:var(--accent,#1f9dff); box-shadow:0 0 0 3px rgba(31,157,255,.15); }
  .snr-row{ display:flex; gap:12px; flex-wrap:wrap; } .snr-row > .snr-field{ flex:1 1 200px; }
  .snr-inline{ display:flex; gap:8px; align-items:center; } .snr-inline input{ flex:1; }
  .snr-hint{ color:var(--text-3,#7d8794); font-size:11px; margin-top:4px; line-height:1.5; }
  .snr-toggle{ display:flex; align-items:center; gap:8px; cursor:pointer; color:var(--text-1,#cdd4de); font-weight:500; }

  /* ---- ghost buttons (match theme) ---- */
  .snr-btn{
    cursor:pointer; font-family:var(--fd,inherit); font-weight:600; font-size:12px; letter-spacing:.01em;
    padding:7px 14px; border-radius:9px; border:1px solid var(--line-2,#2d333c);
    background:transparent; color:var(--accent-bright,#3fc8ff); transition:.15s;
  }
  .snr-btn:hover{ color:#fff; border-color:var(--accent,#1f9dff); }
  .snr-btn.danger{ color:#ff8a94; border-color:rgba(255,92,106,.4); }
  .snr-btn.danger:hover{ color:#fff; border-color:#ff5c6a; }
  .snr-btn.good{ color:#7ee2a8; border-color:rgba(57,208,138,.5); }
  .snr-btn.good:hover{ color:#fff; border-color:#39d08a; }
  .snr-btn:disabled{ opacity:.5; cursor:not-allowed; }

  /* ---- server tabs ---- */
  .snr-tabs{ display:flex; flex-wrap:wrap; gap:6px; margin-bottom:14px; }
  .snr-tab{ display:inline-flex; align-items:center; gap:7px; padding:6px 12px; border:1px solid var(--line,#232830);
    background:var(--bg-3,#181c22); color:var(--text-2,#9aa4b2); border-radius:8px; cursor:pointer; font-size:12px; }
  .snr-tab.active{ background:rgba(31,157,255,.14); border-color:var(--accent,#1f9dff); color:var(--text,#f4f7fb); }
  .snr-tab.add{ color:var(--accent-bright,#3fc8ff); font-weight:600; }
  .snr-tab .dot{ width:8px; height:8px; border-radius:50%; background:var(--text-3,#7d8794); flex:0 0 auto; }
  .snr-tab .dot.ok{ background:#39d08a; box-shadow:0 0 5px rgba(57,208,138,.7); }
  .snr-tab .dot.bad{ background:#ff5c6a; }

  /* ---- status banners ---- */
  .snr-status{ margin:6px 0 14px; padding:9px 12px; border-radius:8px; font-size:12.5px; display:none; align-items:center; gap:8px; }
  .snr-status.show{ display:flex; }
  .snr-status.ok  { background:rgba(57,208,138,.12); color:#8ff0c4; border:1px solid rgba(57,208,138,.4); }
  .snr-status.bad { background:rgba(255,92,106,.12); color:#ffb3ba; border:1px solid rgba(255,92,106,.4); }
  .snr-status.info{ background:rgba(31,157,255,.12); color:#bfe0ff; border:1px solid rgba(31,157,255,.4); }
  .snr-spin{ width:13px; height:13px; border:2px solid rgba(255,255,255,.3); border-top-color:#fff; border-radius:50%; display:inline-block; animation:snrspin .7s linear infinite; }
  @keyframes snrspin{ to{ transform:rotate(360deg);} }

  .snr-foot{ display:flex; justify-content:space-between; gap:8px; margin-top:8px; }
  .snr-foot .right{ display:flex; gap:8px; }
  .snr-note{ color:var(--text-3,#7d8794); font-size:12px; padding:6px 0 12px; line-height:1.5; }

  /* ---- series-page Sonarr library-status card (sidebar) — the card system,
          modelled on PTP's Radarr card but wearing the Sonarr light-blue accent ---- */
  #snr-inline{
    position:relative; display:block; width:100%; min-width:0; box-sizing:border-box;
    margin:0 0 22px; padding:0;
    background:linear-gradient(180deg, rgba(18,20,25,.96), rgba(8,9,12,.94));
    border:1px solid rgba(255,255,255,.09); border-radius:12px;
    box-shadow:0 14px 34px rgba(0,0,0,.28), inset 0 1px 0 rgba(255,255,255,.04);
    overflow:hidden; font-family:var(--fd, Inter, "Open Sans", Arial, sans-serif);
  }
  #snr-inline::before{ /* brand accent stripe — Sonarr blue (was Radarr gold in PTP) */
    content:""; position:absolute; left:0; top:0; bottom:0; width:3px;
    background:linear-gradient(180deg, #7fdcff, #3fc8ff 52%, #1f9dff);
    box-shadow:0 0 18px rgba(63,200,255,.5);
  }
  #snr-inline .snr-page-head{
    min-width:0; padding:12px 14px 10px 16px;
    border-bottom:1px solid rgba(255,255,255,.07);
    background:linear-gradient(180deg, rgba(255,255,255,.035), rgba(255,255,255,0));
  }
  #snr-inline .snr-page-kicker{
    display:block; color:var(--text,#f4f7fb); font-size:13px; font-weight:900;
    letter-spacing:.02em; line-height:1.1;
  }
  #snr-inline .snr-page-sub{
    display:block; margin-top:2px; color:var(--text-3,#8f96a3); font-size:10.5px;
    font-weight:750; text-transform:uppercase; letter-spacing:.08em;
  }
  #snr-inline .snr-page-actions{
    display:flex; flex-direction:column; align-items:stretch; gap:7px;
    min-width:0; padding:10px 12px 12px 14px;
  }
  #snr-inline a.snr-entry{
    display:flex; align-items:center; justify-content:flex-start; gap:7px; min-height:28px;
    width:100%; box-sizing:border-box; padding:7px 10px; border-radius:9px; text-decoration:none !important;
    border:1px solid rgba(255,255,255,.1); background:rgba(255,255,255,.055);
    color:var(--text-1,#d9dce3) !important; font-size:12px; font-weight:900;
    line-height:1; cursor:pointer; transition:border-color .16s ease, background .16s ease, transform .16s ease, box-shadow .16s ease;
  }
  #snr-inline a.snr-entry::before{
    content:""; width:7px; height:7px; border-radius:50%; background:currentColor;
    box-shadow:0 0 10px currentColor; flex:0 0 auto;
  }
  #snr-inline a.snr-entry:hover{
    transform:translateY(-1px); border-color:rgba(255,255,255,.22);
    background:rgba(255,255,255,.09); color:#fff !important;
  }
  #snr-inline a.is-checking  { color:#5fb9e0 !important; background:rgba(63,200,255,.08); border-color:rgba(63,200,255,.2); }
  #snr-inline a.is-in-library{ color:#5fd39a !important; background:rgba(57,208,138,.1);  border-color:rgba(95,211,154,.26); }
  #snr-inline a.is-missing   { color:#ff6b76 !important; background:rgba(255,92,106,.1);  border-color:rgba(255,107,118,.26); }
  #snr-inline a.is-offline,
  #snr-inline a.is-setup     { color:#9aa4b2 !important; background:rgba(154,164,178,.08); border-color:rgba(154,164,178,.18); }

  /* ---- enhanced series hero: replaces the native 206px BTN banner slot ---- */
  body.snr-series-hero-on #content .thin > center{ display:none !important; }
  body.snr-season-hero-on #content .thin > h2,
  body.snr-season-hero-on #content .thin > .linkbox{ display:none !important; }
  body.snr-series-hero-on #content .thin > .snr-series-hero,
  body.snr-season-hero-on #content .thin > .snr-series-hero{
    grid-column:2; grid-row:1; justify-self:stretch; align-self:stretch;
    width:100%; height:206px; min-height:206px; margin:0; position:relative;
    overflow:hidden; border-radius:12px; border:1px solid var(--line,#232830);
    background:var(--bg-2,#12151a); box-shadow:0 10px 26px rgba(0,0,0,.38);
    color:var(--text,#f4f7fb); isolation:isolate;
  }
  .snr-series-hero .hero-bg{ position:absolute; inset:0; background-position:center; background-size:cover; background-repeat:no-repeat; filter:saturate(.98) contrast(1.04); transform:scale(1.01); }
  .snr-series-hero .hero-shade{ position:absolute; inset:0; background:
    linear-gradient(90deg,rgba(5,7,10,.96) 0%,rgba(5,7,10,.78) 44%,rgba(5,7,10,.38) 74%,rgba(5,7,10,.74) 100%),
    linear-gradient(0deg,rgba(5,7,10,.72) 0%,rgba(5,7,10,.16) 70%,rgba(5,7,10,.32) 100%); }
  .snr-series-hero .hero-inner{ position:relative; z-index:2; display:grid; grid-template-columns:minmax(0,1fr) auto; gap:18px; height:100%; padding:18px 20px; }
  .snr-series-hero .hero-main{ min-width:0; align-self:end; }
  .snr-series-hero .hero-main.is-link{ cursor:pointer; }
  .snr-series-hero .hero-kicker{ color:var(--accent-bright,#3fc8ff); font-size:10.5px; line-height:1; font-weight:800; letter-spacing:.18em; text-transform:uppercase; margin:0 0 7px; text-shadow:0 2px 8px #000; }
  .snr-series-hero .hero-title{ margin:0 0 7px; color:#fff; font-family:var(--fd,inherit); font-weight:800; font-size:34px; line-height:.98; letter-spacing:0; text-shadow:0 3px 18px rgba(0,0,0,.72); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .snr-series-hero .hero-title a{ color:inherit !important; text-decoration:none !important; }
  .snr-series-hero .hero-title a:hover{ color:#fff !important; text-decoration:none !important; text-shadow:0 3px 18px rgba(0,0,0,.72),0 0 18px rgba(63,200,255,.38); }
  .snr-series-hero .hero-overview{ max-width:74ch; margin:0 0 9px; color:#e5edf7; font-size:12.5px; line-height:1.42; text-shadow:0 2px 8px #000; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
  .snr-series-hero .hero-chips{ display:flex; flex-wrap:wrap; align-items:center; gap:6px; min-width:0; }
  .snr-series-hero .hero-chip{ display:inline-flex; align-items:center; max-width:220px; min-height:23px; padding:3px 8px; border-radius:999px; background:rgba(255,255,255,.11); border:1px solid rgba(255,255,255,.15); color:#fff; font-size:11px; font-weight:700; line-height:1.15; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; text-shadow:0 1px 4px #000; }
  .snr-series-hero .hero-chip.score{ color:#f4c04e; border-color:rgba(244,192,78,.38); }
  .snr-series-hero .hero-chip.live{ color:#8ff0c4; border-color:rgba(57,208,138,.45); }
  .snr-series-hero .hero-side{ display:flex; flex-direction:column; justify-content:space-between; align-items:flex-end; min-width:260px; max-width:min(42vw,430px); }
  .snr-series-hero .hero-episodes{ display:grid; grid-template-columns:repeat(2,minmax(120px,1fr)); gap:8px; width:100%; }
  .snr-series-hero .hero-ep{ min-width:0; padding:8px 10px; border-radius:9px; background:rgba(6,8,12,.62); border:1px solid rgba(255,255,255,.12); box-shadow:inset 0 1px 0 rgba(255,255,255,.035); }
  .snr-series-hero .hero-ep .lbl{ color:var(--text-3,#7d8794); font-size:9.5px; line-height:1; font-weight:800; letter-spacing:.12em; text-transform:uppercase; margin:0 0 5px; }
  .snr-series-hero .hero-ep .nm{ color:#fff; font-size:12px; font-weight:700; line-height:1.18; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .snr-series-hero .hero-ep .dt{ color:var(--text-2,#9aa4b2); font-size:11px; line-height:1.2; margin-top:3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .snr-series-hero .hero-actions{ display:flex; flex-wrap:wrap; justify-content:flex-end; align-items:center; gap:6px; }
  .snr-series-hero .hero-action{ display:inline-flex; align-items:center; justify-content:center; min-height:24px; padding:4px 8px; border-radius:7px; border:1px solid rgba(255,255,255,.18); background:rgba(0,0,0,.34); color:#dfe7ee !important; font-size:11px; line-height:1; font-weight:700; text-decoration:none !important; cursor:pointer; text-shadow:none; }
  .snr-series-hero .hero-action:hover{ border-color:var(--accent,#1f9dff); color:#fff !important; background:rgba(31,157,255,.18); }
  .snr-series-hero .hero-action.trailer{ color:#fff !important; background:rgba(31,157,255,.22); border-color:rgba(63,200,255,.42); }
  #snr-season-episode-card{
    margin:22px 0 0; border:1px solid var(--line,#232830); border-radius:12px;
    background:linear-gradient(180deg,var(--bg-2,#12151a),var(--bg-1,#0c0e12));
    box-shadow:0 10px 26px rgba(0,0,0,.34); overflow:hidden; color:var(--text-1,#cdd4de);
  }
  #snr-season-episode-card .snr-sec-head{
    display:flex; align-items:center; justify-content:space-between; gap:12px;
    padding:14px 16px; border-bottom:1px solid var(--line,#232830);
  }
  #snr-season-episode-card .snr-sec-title{
    margin:0; color:var(--text,#f4f7fb); font-family:var(--fd,inherit); font-size:14px;
    line-height:1.2; font-weight:850;
  }
  #snr-season-episode-card .snr-sec-count{ color:var(--text-3,#7d8794); font-size:11px; font-weight:750; white-space:nowrap; }
  #snr-season-episode-card .snr-sec-tabs{
    display:flex; gap:7px; padding:10px 12px; overflow-x:auto; scrollbar-width:thin;
    scrollbar-color:var(--line-2,#2d333c) transparent; border-bottom:1px solid rgba(255,255,255,.055);
  }
  #snr-season-episode-card .snr-sec-tabs::-webkit-scrollbar{ height:7px; }
  #snr-season-episode-card .snr-sec-tabs::-webkit-scrollbar-thumb{ background:var(--line-2,#2d333c); border-radius:999px; }
  #snr-season-episode-card .snr-sec-tab{
    flex:0 0 auto; min-width:44px; height:30px; padding:0 10px; border-radius:8px;
    border:1px solid rgba(255,255,255,.09); background:rgba(255,255,255,.025);
    color:var(--text-2,#9aa4b2); font:inherit; font-size:12px; font-weight:850; line-height:1;
    cursor:pointer; transition:background .15s,border-color .15s,color .15s,box-shadow .15s;
  }
  #snr-season-episode-card .snr-sec-tab:hover,
  #snr-season-episode-card .snr-sec-tab:focus-visible{
    color:#fff; border-color:rgba(63,200,255,.35); background:rgba(63,200,255,.10); outline:0;
  }
  #snr-season-episode-card .snr-sec-tab.active{
    color:#fff; border-color:rgba(63,200,255,.50); background:rgba(63,200,255,.16);
    box-shadow:0 0 18px rgba(63,200,255,.16);
  }
  #snr-season-episode-card .snr-sec-detail{
    display:grid; grid-template-columns:minmax(260px,36%) minmax(0,1fr); gap:18px; min-height:246px;
    padding:16px;
  }
  #snr-season-episode-card .snr-sec-still{
    position:relative; align-self:stretch; min-height:210px; border-radius:10px; overflow:hidden;
    border:1px solid rgba(255,255,255,.08); background:var(--bg-3,#181c22);
    box-shadow:0 12px 28px rgba(0,0,0,.32);
  }
  #snr-season-episode-card .snr-sec-still img{ display:block; width:100%; height:100%; object-fit:cover; }
  #snr-season-episode-card .snr-sec-still.is-empty{
    display:flex; align-items:center; justify-content:center; color:var(--text-3,#7d8794);
    font-size:12px; font-weight:800; text-transform:uppercase; letter-spacing:.08em;
  }
  #snr-season-episode-card .snr-sec-copy{ min-width:0; display:flex; flex-direction:column; justify-content:center; }
  #snr-season-episode-card .snr-sec-kicker{
    color:var(--accent-bright,#3fc8ff); font-size:10.5px; line-height:1; font-weight:900;
    letter-spacing:.14em; text-transform:uppercase; margin-bottom:8px;
  }
  #snr-season-episode-card .snr-sec-ep-title{
    margin:0; color:#fff; font-family:var(--fd,inherit); font-size:22px; line-height:1.15; font-weight:900;
  }
  #snr-season-episode-card .snr-sec-meta{
    display:flex; flex-wrap:wrap; gap:6px; margin:11px 0 14px;
  }
  #snr-season-episode-card .snr-sec-chip{
    display:inline-flex; align-items:center; min-height:24px; padding:4px 8px; border-radius:999px;
    border:1px solid rgba(63,200,255,.16); background:rgba(63,200,255,.07);
    color:var(--text-1,#cdd4de); font-size:11px; line-height:1.1; font-weight:800;
  }
  #snr-season-episode-card .snr-sec-overview{
    max-width:92ch; margin:0; color:var(--text-2,#9aa4b2); font-size:13px; line-height:1.5;
    display:-webkit-box; -webkit-line-clamp:5; -webkit-box-orient:vertical; overflow:hidden;
  }
  body.snr-season-episodes-on #content .thin .box[data-snr-native-show-info="1"]{ display:none !important; }
  @media (max-width:1000px){
    body.snr-series-hero-on #content .thin > .snr-series-hero,
    body.snr-season-hero-on #content .thin > .snr-series-hero{ grid-column:1 !important; grid-row:auto !important; height:132px; min-height:132px; justify-self:stretch !important; }
    .snr-series-hero .hero-inner{ display:flex; padding:13px 14px; }
    .snr-series-hero .hero-title{ font-size:24px; }
    .snr-series-hero .hero-overview{ display:none; }
    .snr-series-hero .hero-side{ min-width:0; max-width:none; flex:1 1 auto; }
    .snr-series-hero .hero-episodes{ display:none; }
    .snr-series-hero .hero-actions{ align-self:flex-end; }
  }
  @media (max-width:680px){
    .snr-series-hero .hero-side{ display:none; }
    .snr-series-hero .hero-title{ white-space:normal; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }
    #snr-season-episode-card .snr-sec-detail{ grid-template-columns:1fr; min-height:0; }
    #snr-season-episode-card .snr-sec-still{ aspect-ratio:16/9; min-height:0; }
    #snr-season-episode-card .snr-sec-ep-title{ font-size:18px; }
  }

  /* ---- add-to-Sonarr modal (kept, themed) ---- */
  #snr-add-ov{ position:fixed; inset:0; background:rgba(0,0,0,.6); z-index:99999; display:none; align-items:flex-start; justify-content:center; font-family:var(--ff,Arial,sans-serif); }
  #snr-add-ov.open{ display:flex; }
  #snr-add-modal{ background:var(--bg-2,#12151a); color:var(--text-1,#cdd4de); margin-top:8vh; width:560px; max-width:94vw; max-height:84vh;
    border:1px solid var(--line,#232830); border-radius:14px; overflow:hidden; box-shadow:0 20px 60px rgba(0,0,0,.6); display:flex; flex-direction:column; font-size:13px; }
  #snr-add-modal *{ box-sizing:border-box; }
  .snr-addhead{ display:flex; gap:14px; padding:16px 20px; border-bottom:1px solid var(--line,#232830); }
  .snr-addhead img{ width:74px; height:auto; border-radius:8px; flex:0 0 auto; background:var(--bg-1,#0c0e12); }
  .snr-addhead .meta h3{ margin:0 0 4px; font-size:16px; color:var(--text,#f4f7fb); font-family:var(--fd,inherit); }
  .snr-addhead .meta .sub{ color:var(--text-2,#9aa4b2); font-size:12px; }
  .snr-addhead .meta .srv{ margin-top:8px; font-size:12px; color:var(--accent-bright,#3fc8ff); }
  .snr-addbody{ padding:18px 20px; overflow-y:auto; }
  .snr-addfoot{ display:flex; justify-content:space-between; gap:8px; padding:12px 20px; border-top:1px solid var(--line,#232830); }

  /* ---- trailer pop-up player ---- */
  #snr-trailer-ov{ position:fixed; inset:0; background:rgba(4,6,10,.9); z-index:2147483000; display:flex; align-items:center; justify-content:center; opacity:0; transition:opacity .15s; }
  #snr-trailer-ov.open{ opacity:1; }
  #snr-trailer-ov .snr-tr-box{ position:relative; width:min(92vw,1180px); }
  #snr-trailer-ov .snr-tr-frame{ position:relative; width:100%; aspect-ratio:16/9; background:#000; border:1px solid var(--line,#232830); border-radius:12px; overflow:hidden; box-shadow:0 24px 70px rgba(0,0,0,.7); }
  #snr-trailer-ov .snr-tr-frame iframe{ position:absolute; inset:0; width:100%; height:100%; border:0; }
  #snr-trailer-ov .snr-tr-msg{ position:absolute; inset:0; display:flex; align-items:center; justify-content:center; gap:10px; color:var(--text-2,#9aa4b2); font-size:14px; }
  #snr-trailer-ov .snr-tr-x{ position:absolute; top:-44px; right:0; width:36px; height:36px; border-radius:50%; border:1px solid var(--line-2,#2d333c); background:var(--bg-2,#12151a); color:var(--text-1,#cdd4de); font-size:20px; line-height:1; cursor:pointer; transition:.15s; }
  #snr-trailer-ov .snr-tr-x:hover{ color:#fff; border-color:var(--accent,#1f9dff); }

  /* ---- cast row (TMDb photos, BTN links) ---- */
  #snr-cast .snr-cast-row{ display:flex; gap:14px; overflow-x:auto; padding:14px 16px 16px; scrollbar-width:thin; scrollbar-color:var(--line-2,#2d333c) transparent; }
  #snr-cast .snr-cast-row::-webkit-scrollbar{ height:8px; }
  #snr-cast .snr-cast-row::-webkit-scrollbar-thumb{ background:var(--line-2,#2d333c); border-radius:4px; }
  #snr-cast a.snr-cast-card{ flex:0 0 auto; width:88px; text-align:center; text-decoration:none; color:var(--text-1,#cdd4de); }
  #snr-cast .snr-cast-av{ width:78px; height:78px; border-radius:50%; background:var(--bg-3,#181c22); border:2px solid var(--line,#232830); margin:0 auto 8px; display:flex; align-items:center; justify-content:center; font-family:var(--fd,inherit); font-weight:600; font-size:22px; color:var(--text-3,#7d8794); overflow:hidden; transition:border-color .15s, transform .15s; }
  #snr-cast .snr-cast-av img{ width:100%; height:100%; object-fit:cover; display:block; }
  #snr-cast a.snr-cast-card:hover .snr-cast-av{ border-color:var(--accent,#1f9dff); transform:translateY(-2px); }
  #snr-cast a.snr-cast-card:hover .snr-cast-name{ color:var(--accent-bright,#3fc8ff); }
  #snr-cast .snr-cast-name{ font-size:12px; font-weight:600; line-height:1.25; overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }
  #snr-cast .snr-cast-char{ font-size:11px; color:var(--text-3,#7d8794); line-height:1.25; margin-top:2px; overflow:hidden; display:-webkit-box; -webkit-line-clamp:1; -webkit-box-orient:vertical; }

  /* ---- enhanced series summary ---- */
  #summary .ess-meta{ display:flex; flex-wrap:wrap; gap:8px; align-items:center; padding:14px 20px 2px; }
  #summary .ess-chip{ display:inline-flex; align-items:center; gap:5px; font-size:12px; font-weight:600; padding:4px 10px; border-radius:999px; border:1px solid var(--line-2,#2d333c); background:var(--bg-3,#181c22); color:var(--text-1,#cdd4de); }
  #summary .ess-chip.star{ color:#f4c04e; border-color:rgba(244,192,78,.4); }
  #summary .ess-chip.status-on{ color:#7ee2a8; border-color:rgba(57,208,138,.45); }
  #summary a.ess-chip{ text-decoration:none; }
  #summary a.ess-chip:hover{ border-color:var(--accent,#1f9dff); color:var(--accent-bright,#3fc8ff); }
  #summary .ess-eps{ display:flex; gap:14px; flex-wrap:wrap; padding:6px 20px 16px; }
  #summary .ess-ep{ flex:1 1 240px; display:flex; gap:12px; background:var(--bg-2,#12151a); border:1px solid var(--line,#232830); border-radius:10px; padding:10px; min-width:0; }
  #summary .ess-ep .thumb{ flex:0 0 96px; width:96px; height:54px; border-radius:6px; object-fit:cover; background:var(--bg-3,#181c22); }
  #summary .ess-ep .who{ min-width:0; }
  #summary .ess-ep .lbl{ font-size:10.5px; font-weight:700; letter-spacing:1px; text-transform:uppercase; color:var(--text-3,#7d8794); margin-bottom:3px; }
  #summary .ess-ep .se{ font-size:13px; font-weight:600; color:var(--text,#f4f7fb); }
  #summary .ess-ep .nm{ font-size:12px; color:var(--text-1,#cdd4de); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  #summary .ess-ep .dt{ font-size:11.5px; color:var(--text-2,#9aa4b2); margin-top:3px; }
  #summary .ess-ep .cd{ color:var(--accent-bright,#3fc8ff); font-weight:600; }

  /* ---- collapsible front-page news ---- */
  #news_post .head{ cursor:pointer; user-select:none; }
  #news_post .head .snr-news-caret{ display:inline-block; width:14px; margin-right:5px; opacity:.85; color:var(--accent-bright,#3fc8ff); font-size:11px; }
  #news_post .head:hover .snr-news-caret{ opacity:1; }
  a.snr-news-link{ display:inline-block; padding:4px 2px; font-weight:600; font-size:12.5px; color:var(--accent-bright,#3fc8ff); text-decoration:none; letter-spacing:.02em; }
  a.snr-news-link:hover{ color:#fff; }

  /* ---- stamps row (moved to bottom of main column) ---- */
  #snr-stamps ul.nobullet{ display:flex !important; flex-wrap:wrap; gap:12px; list-style:none; padding:14px 16px 16px; margin:0; }
  #snr-stamps ul.nobullet li{ margin:0 !important; padding:0 !important; display:inline-flex; }
  #snr-stamps ul.nobullet li a{ display:inline-flex; }
  #snr-stamps ul.nobullet li img{ height:56px; width:auto; border-radius:6px; border:1px solid var(--line,#232830); transition:.15s; display:block; }
  #snr-stamps ul.nobullet li a:hover img{ border-color:var(--accent,#1f9dff); transform:translateY(-2px); }

  /* ---- fan art carousels ---- */
  .snr-cars{ padding:14px 16px 16px; display:flex; flex-direction:column; gap:18px; }
  .snr-car-lbl{ display:flex; align-items:center; justify-content:space-between; font-size:12px; font-weight:600; color:var(--text-1,#cdd4de); margin-bottom:7px; }
  .snr-car-count{ font-size:11px; color:var(--text-3,#7d8794); font-weight:500; }
  .snr-car-stage{ position:relative; width:100%; height:300px; background:transparent; border:0; border-radius:10px; overflow:hidden; display:flex; align-items:center; justify-content:center; }
  .snr-car-img{ max-width:100%; max-height:100%; object-fit:contain; display:block; }
  .snr-car-nav{ position:absolute; top:50%; transform:translateY(-50%); width:38px; height:38px; border-radius:50%; border:1px solid var(--line-2,#2d333c); background:rgba(12,14,18,.72); color:var(--text,#f4f7fb); font-size:20px; line-height:1; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:.15s; backdrop-filter:blur(4px); -webkit-backdrop-filter:blur(4px); }
  .snr-car-nav:hover{ border-color:var(--accent,#1f9dff); color:var(--accent-bright,#3fc8ff); }
  .snr-car-nav.prev{ left:12px; } .snr-car-nav.next{ right:12px; }
  .snr-car-dl{ position:absolute; bottom:10px; right:12px; font-size:11px; color:var(--text-2,#9aa4b2); text-decoration:none; background:rgba(12,14,18,.72); padding:3px 9px; border-radius:6px; border:1px solid var(--line-2,#2d333c); }
  .snr-car-dl:hover{ color:var(--accent-bright,#3fc8ff); border-color:var(--accent,#1f9dff); }
  `;

  function injectStyle() {
    if (document.getElementById('snr-style')) return;
    const st = document.createElement('style');
    st.id = 'snr-style';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  // Generic one-shot CSS injector used by the bundled feature modules.
  function injectCss(id, css) {
    if (document.getElementById(id)) return;
    const st = document.createElement('style');
    st.id = id;
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }

  /* =========================================================================
   * SITE BADGE LABELS (feature: 'browsetags')
   * =======================================================================*/
  const BROWSETAG_CSS = `
  .stmpe-browsetag{
    display:inline-flex; align-items:center; justify-content:center; min-width:42px; min-height:18px;
    box-sizing:border-box; padding:2px 7px; margin:1px 0; border-radius:5px;
    border:1px solid rgba(63,200,255,.22); background:linear-gradient(180deg,rgba(18,24,31,.95),rgba(8,11,16,.95));
    color:var(--text,#f4f7fb); font-family:var(--fd,inherit); font-size:10.5px; font-weight:900; line-height:1;
    letter-spacing:0; text-transform:uppercase; white-space:nowrap; vertical-align:middle;
    box-shadow:0 0 0 1px rgba(255,255,255,.035) inset,0 0 14px rgba(63,200,255,.18);
  }
  .stmpe-browsetag--auto{
    border-color:rgba(63,200,255,.50); color:#79dcff; background:linear-gradient(180deg,rgba(16,45,65,.92),rgba(8,18,28,.95));
    box-shadow:0 0 0 1px rgba(255,255,255,.05) inset,0 0 16px rgba(63,200,255,.34);
  }
  .stmpe-browsetag--upload{
    border-color:rgba(255,226,80,.62); color:#fff1a6; background:linear-gradient(180deg,rgba(64,57,20,.92),rgba(19,17,10,.95));
    box-shadow:0 0 0 1px rgba(255,255,255,.05) inset,0 0 16px rgba(255,226,80,.30);
  }
  .stmpe-browsetag--free{
    border-color:rgba(70,232,151,.50); color:#96f2bf; background:linear-gradient(180deg,rgba(16,55,38,.92),rgba(8,20,16,.95));
    box-shadow:0 0 0 1px rgba(255,255,255,.05) inset,0 0 16px rgba(70,232,151,.28);
  }
  .stmpe-browsetag--neutral{
    border-color:rgba(185,195,208,.34); color:#d7dee8; background:linear-gradient(180deg,rgba(36,42,51,.90),rgba(13,16,21,.95));
    box-shadow:0 0 0 1px rgba(255,255,255,.045) inset,0 0 14px rgba(185,195,208,.16);
  }
  .stmpe-browsetag-wrap{
    display:inline-flex; align-items:center; gap:5px; margin-left:9px; vertical-align:middle;
  }
  .stmpe-browsetag-inline-cell>br{ display:none; }
  .stmpe-browsetag-empty-cell{ display:none !important; }
  .stmpe-browsetag-cell{
    white-space:nowrap; text-align:right; vertical-align:middle;
  }
  .stmpe-browsetag-cell>br{ display:none; }
  .stmpe-browsetag-cell .stmpe-browsetag{ margin-left:5px; margin-right:0; }
  .stmpe-torrent-action{
    display:inline-flex !important; align-items:center; justify-content:center; width:24px; height:24px;
    margin:0 6px 0 0; border:0 !important; border-radius:0 !important; background:transparent !important;
    box-shadow:none !important; color:var(--accent-bright,#3fc8ff) !important; text-decoration:none !important;
    vertical-align:middle; overflow:visible !important; line-height:1 !important;
  }
  .stmpe-torrent-action:hover{ color:#fff !important; text-shadow:0 0 12px rgba(63,200,255,.72); }
  .stmpe-torrent-action--report{ color:#ff8897 !important; }
  .stmpe-torrent-action--report:hover{ color:#ffd3d9 !important; text-shadow:0 0 12px rgba(255,136,151,.62); }
  .stmpe-torrent-action img{ display:block !important; width:18px !important; height:18px !important; object-fit:contain; margin:0 !important; }
  .stmpe-torrent-action-fallback{ display:inline-flex; align-items:center; justify-content:center; width:18px; height:18px; font-size:17px; font-weight:900; line-height:1; }
  `;

  function browseTagSlug(img) {
    const raw = img && img.getAttribute('src') || '';
    const path = raw.split('?')[0].split('#')[0];
    const file = path.slice(path.lastIndexOf('/') + 1);
    return file.replace(/\.[a-z0-9]+$/i, '').toLowerCase();
  }

  function browseTagLabel(img) {
    const slug = browseTagSlug(img);
    const title = ttClean(img && img.getAttribute('title') || img && img.getAttribute('alt') || '');
    if (slug === 'auto') return 'Auto';
    const multiplier = slug.match(/^(\d+)x$/i);
    if (multiplier) return (Number(multiplier[1]) / 10).toFixed(1) + 'x';
    if (/free/.test(slug)) return 'Free';
    if (/neutral/.test(slug)) return 'Neutral';
    if (title) {
      return title
        .replace(/^official\s+btn\s+/i, '')
        .replace(/\s*upload!?$/i, '')
        .replace(/!?$/i, '')
        .trim();
    }
    return slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  function browseTagKind(img) {
    const text = (browseTagSlug(img) + ' ' + (img.getAttribute('title') || '')).toLowerCase();
    if (/auto/.test(text)) return 'auto';
    if (/\b\d+x\b|upload/.test(text)) return 'upload';
    if (/free/.test(text)) return 'free';
    if (/neutral/.test(text)) return 'neutral';
    return 'default';
  }

  function torrentActionKind(link) {
    if (!link) return '';
    const href = link.getAttribute('href') || '';
    let url = null;
    try { url = new URL(href, location.href); } catch (e) {}
    if (!url) return '';
    const path = url.pathname || '';
    const action = url.searchParams.get('action') || '';
    if (/\/torrents\.php$/i.test(path) && /^download$/i.test(action)) return 'download';
    if (/\/reports\.php$/i.test(path) && /^report$/i.test(action)) return 'report';
    return '';
  }

  function cleanActionSeparator(link) {
    let node = link && link.previousSibling;
    while (node && node.nodeType === Node.TEXT_NODE && !node.nodeValue.trim()) node = node.previousSibling;
    if (node && node.nodeType === Node.TEXT_NODE && /\|/.test(node.nodeValue || '')) {
      node.nodeValue = node.nodeValue.replace(/\s*\|\s*$/, '');
    }
  }

  function isMagnetAction(link) {
    return /^magnet:/i.test((link && link.getAttribute('href') || '').trim());
  }

  function removeDuplicateDownloadActions(root) {
    const scope = root || document;
    [...scope.querySelectorAll('table.torrent_table tr.group_torrent td:first-child > span')]
      .forEach(cluster => {
        const downloads = [...cluster.querySelectorAll('a')]
          .filter(link => torrentActionKind(link) === 'download');
        const duplicates = downloads.slice(1);
        if (downloads.length) {
          duplicates.push(...[...cluster.querySelectorAll('a')].filter(isMagnetAction));
        }
        duplicates.forEach(link => {
          cleanActionSeparator(link);
          link.remove();
        });
      });
  }

  function enhanceTorrentActionLinks(root) {
    const scope = root || document;
    removeDuplicateDownloadActions(scope);
    const links = [...scope.querySelectorAll('table.torrent_table a, #torrent_table a')]
      .filter(link => torrentActionKind(link));
    links.forEach(link => {
      const kind = torrentActionKind(link);
      const label = kind === 'download' ? 'Download' : 'Report';
      link.classList.add('stmpe-torrent-action', 'stmpe-torrent-action--' + kind);
      link.classList.remove('stmpe-browsetag', 'stmpe-browsetag--default');
      link.title = label;
      link.setAttribute('aria-label', label);
      link.querySelectorAll('.stmpe-browsetag').forEach(tag => {
        tag.remove();
      });
      link.innerHTML = '<span class="stmpe-torrent-action-fallback" aria-hidden="true">' + (kind === 'download' ? '&#8595;' : '&#9873;') + '</span>';
    });
    return links.length > 0;
  }

  function alignBrowseTags(row) {
    if (!row || !row.cells || row.cells.length < 2) return;
    const firstCell = row.cells[0];
    if (!/^\s*»/.test(firstCell.textContent || '')) return;
    const tagCell = [...row.cells].find((cell, index) => index > 0 && cell.querySelector('.stmpe-browsetag'));
    if (!firstCell || !tagCell || tagCell === firstCell) return;
    const tags = [...tagCell.querySelectorAll('.stmpe-browsetag')];
    if (!tags.length) return;
    let wrap = firstCell.querySelector(':scope > .stmpe-browsetag-wrap');
    if (!wrap) {
      wrap = document.createElement('span');
      wrap.className = 'stmpe-browsetag-wrap';
      const br = [...firstCell.childNodes].find(node => node.nodeType === Node.ELEMENT_NODE && node.tagName === 'BR');
      firstCell.insertBefore(wrap, br || null);
    }
    tags.forEach(tag => wrap.appendChild(tag));
    firstCell.classList.add('stmpe-browsetag-inline-cell');
    if (!ttClean(tagCell.textContent || '')) tagCell.classList.add('stmpe-browsetag-empty-cell');
  }

  function alignBrowseTagCells(root) {
    const scope = root || document;
    [...scope.querySelectorAll('td')].forEach(cell => {
      if (!cell.querySelector('.stmpe-browsetag')) return;
      if (cell.closest('.stmpe-browsetag-inline-cell')) return;
      cell.classList.add('stmpe-browsetag-cell');
    });
  }

  function runBrowseTagLabels() {
    if (!IS_TORRENT_DETAIL) return false;
    injectCss('stmpe-browsetags-style', BROWSETAG_CSS);
    enhanceTorrentActionLinks(document);
    const imgs = [...document.querySelectorAll('img[src*="/common/browsetags/"]')];
    imgs.forEach(img => {
      if (torrentActionKind(img.closest('a'))) return;
      const label = browseTagLabel(img);
      if (!label || img.closest('.stmpe-browsetag')) return;
      const span = document.createElement('span');
      span.className = 'stmpe-browsetag stmpe-browsetag--' + browseTagKind(img);
      span.textContent = label;
      span.title = img.getAttribute('title') || label;
      span.setAttribute('aria-label', span.title);
      img.replaceWith(span);
    });
    enhanceTorrentActionLinks(document);
    [...document.querySelectorAll('tr')].forEach(row => alignBrowseTags(row));
    alignBrowseTagCells(document);
    return imgs.length > 0;
  }

  /* =========================================================================
   * LIGHT THEME (feature: 'lighttheme')
   *   The whole dark theme is built on CSS custom properties (--bg-*, --text-*,
   *   --panel, --head, ...), so this doesn't reskin anything directly — it
   *   flips the page canvas to light and the "loose" text that sits directly
   *   on it (breadcrumbs, pagination, bare headings) to dark, then re-declares
   *   the original dark-mode token values fresh on every surface that stays a
   *   dark UI element (header, nav, pills, panels), so their own text/lines
   *   don't inherit the new dark page-text colour. The actual content cards
   *   (.box/.torrent_table/.forum_post/...) get upgraded from solid dark
   *   panels to translucent, blurred frosted-glass ones on top of that.
   *   Toggling document.documentElement's 'stmpe-light' class is all that's
   *   needed at runtime — every rule below is scoped under it.
   * =======================================================================*/
  const LIGHT_THEME_CSS = `
  html.stmpe-light body{
    background:linear-gradient(180deg,#eef1f5 0%, #e7eaef 600px, #e7eaef 100%) !important;
  }
  html.stmpe-light{
    --text:#14171c; --text-1:#33383f; --text-2:#5b6270; --text-3:#7d8592;
    color-scheme:light;
  }
  html.stmpe-light ::selection{ background:rgba(31,157,255,.22); color:#0b0d10; }
  html.stmpe-light *{ scrollbar-color:#b9c0ca #e9ecf0; }
  html.stmpe-light *::-webkit-scrollbar-thumb{ background:#c3cad3; }
  html.stmpe-light *::-webkit-scrollbar-thumb:hover{ background:#aab2bd; }

  /* bare text sitting directly on the page canvas (breadcrumbs, pagination,
     loose section headings between cards) reads dark now */
  html.stmpe-light #content, html.stmpe-light .thin{ color:var(--text-1); }
  html.stmpe-light h1, html.stmpe-light h2, html.stmpe-light h3, html.stmpe-light h4{ color:var(--text); }
  html.stmpe-light .linkbox a, html.stmpe-light .pages a{ color:var(--text-2); }
  html.stmpe-light .linkbox a:hover, html.stmpe-light .pages a:hover{ color:#000; }

  /* every surface that stays a dark UI element (cards, tables, header, nav +
     its dropdowns, user pills, search bars, modals, the bbcode editor, the
     settings panel this switch itself lives in) gets the original light-on-
     dark text tokens re-declared fresh, so inheritance doesn't leak the new
     dark page-text colour in from above */
  html.stmpe-light .box, html.stmpe-light .main_column .box, html.stmpe-light .sidebar .box,
  html.stmpe-light .forum_post, html.stmpe-light .torrent_table, html.stmpe-light .filter_torrents,
  html.stmpe-light .search_form, html.stmpe-light form.search_form,
  html.stmpe-light .layout, html.stmpe-light .forum_index,
  html.stmpe-light .head, html.stmpe-light .box>.head, html.stmpe-light h3.head,
  html.stmpe-light #header, html.stmpe-light #menu1, html.stmpe-light #menu1 ul,
  html.stmpe-light .subnav, html.stmpe-light .potato-menu ul,
  html.stmpe-light #userinfo, html.stmpe-light #searchbars, html.stmpe-light #donation,
  html.stmpe-light #alerts .alertbar, html.stmpe-light #snr-add-modal,
  html.stmpe-light #snr-trailer-ov .snr-tr-frame, html.stmpe-light .bbcodetextbox,
  html.stmpe-light #quickreplypreview.box, html.stmpe-light .snr-panel,
  html.stmpe-light .useredit #slider .scrollContainer>.panel
  {
    --text:#f4f7fb; --text-1:#cdd4de; --text-2:#8b94a1; --text-3:#5a626d;
    color:var(--text-1) !important;
  }

  /* upgrade the actual content cards to frosted dark glass */
  html.stmpe-light .box, html.stmpe-light .main_column .box, html.stmpe-light .sidebar .box,
  html.stmpe-light .forum_post, html.stmpe-light .torrent_table,
  html.stmpe-light .filter_torrents, html.stmpe-light .search_form, html.stmpe-light form.search_form,
  html.stmpe-light .layout, html.stmpe-light .forum_index
  {
    background:linear-gradient(180deg,rgba(20,24,30,.70) 0%, rgba(15,18,22,.66) 100%) !important;
    backdrop-filter:blur(18px) saturate(150%);
    -webkit-backdrop-filter:blur(18px) saturate(150%);
    border-color:rgba(255,255,255,.08) !important;
  }
  html.stmpe-light .head, html.stmpe-light .box>.head, html.stmpe-light h3.head{
    background:linear-gradient(180deg,rgba(26,31,38,.82) 0%, rgba(18,22,27,.78) 100%) !important;
    backdrop-filter:blur(18px) saturate(150%);
    -webkit-backdrop-filter:blur(18px) saturate(150%);
  }
  `;

  function applyLightTheme() {
    injectCss('snr-light-theme', LIGHT_THEME_CSS);
    document.documentElement.classList.toggle('stmpe-light', isEnabled('lighttheme'));
  }

  /* =========================================================================
   * Utils
   * =======================================================================*/
  function escapeHtml(s){ return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function escapeAttr(s){ return escapeHtml(s); }
  function hostFrom(u){ try { return new URL(normBase(u)).host; } catch(e){ return 'Sonarr'; } }
  function bytes(n){ if(!n) return '0 B'; const u=['B','KB','MB','GB','TB','PB']; let i=0; while(n>=1024&&i<u.length-1){n/=1024;i++;} return n.toFixed(1)+' '+u[i]; }
  // The Series Action Glyph Bar (if enabled) is pinned as the very top sidebar
  // item, with the Fanart clear-logo (if enabled) pinned directly beneath it.
  // Anything else that wants to sit "at the top" of the series sidebar should
  // anchor after whichever of those two is actually present, in that order.
  function snrSidebarPinnedAnchor(sidebar) {
    const logo = document.getElementById('snr-fanart-logo');
    if (logo && logo.parentElement === sidebar) return logo;
    const bar = sidebar.querySelector(':scope > .linkbox.snr-action-bar');
    if (bar) return bar;
    return null;
  }

  /* =========================================================================
   * SETTINGS PAGE — two panels injected into the profile settings grid
   * =======================================================================*/
  let servers = [];
  let activeTab = 0;

  function injectSettingsPanels() {
    const sc = document.querySelector('#slider .scrollContainer');
    if (!sc) return false;
    if (document.getElementById('snr-manager-panel')) return true;

    const mgr = document.createElement('div');
    mgr.className = 'snr snr-panel';
    mgr.id = 'snr-manager-panel';
    sc.appendChild(mgr);

    const set = document.createElement('div');
    set.className = 'snr snr-panel';
    set.id = 'snr-settings-panel';
    sc.appendChild(set);

    renderManager();
    renderSonarrSettings();
    return true;
  }

  /* ---- Userscript Manager panel ---- */
  function renderFeatureRow(f) {
    const row = document.createElement('div');
    row.className = 'snr-feat';
    // API-key slot for features that need one (stored as plain text so the
    // browser's password manager doesn't pop up on every click / focus).
    const keyHtml = f.needsKey ?
      `<div class="snr-keyrow"><label>${escapeHtml(f.keyLabel || 'API Key')}</label>` +
      `<input type="text" class="snr-keyinput" spellcheck="false" autocomplete="off" ` +
      `autocapitalize="off" autocorrect="off" name="snr_${escapeAttr(f.id)}_key_${Date.now().toString(36)}" ` +
      `data-lpignore="true" data-1p-ignore data-bwignore data-form-type="other" ` +
      `data-key-id="${escapeAttr(f.id)}" value="${escapeAttr(getKey(f.id))}" ` +
      `placeholder="${escapeAttr(f.keyPlaceholder || 'Paste your API key')}"></div>` : '';
    // Dropdown option (e.g. which TMDb list the homepage row shows).
    const selHtml = f.select ?
      `<div class="snr-selrow"><label>${escapeHtml(f.select.label || 'Option')}</label>` +
      `<select class="snr-selinput" data-sel-id="${escapeAttr(f.id)}">` +
      f.select.options.map(o => `<option value="${escapeAttr(o.value)}" ${getOpt(f.id, f.select.default) === o.value ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('') +
      `</select></div>` : '';
    row.innerHTML =
      `<div class="meta"><b>${escapeHtml(f.name)}</b><div class="d">${escapeHtml(f.desc)}</div>${keyHtml}${selHtml}</div>` +
      `<label class="snr-switch"><input type="checkbox" ${isEnabled(f.id) ? 'checked' : ''}>` +
      `<span class="track"></span><span class="thumb"></span></label>`;
    row.querySelector('.snr-switch input').addEventListener('change', (e) => {
      setFeature(f.id, e.target.checked);
      if (f.id === 'sonarr') renderSonarrSettings(); // reflect enabled/disabled note
      if (f.id === 'lighttheme') applyLightTheme(); // live preview, no reload needed
    });
    const keyInput = row.querySelector('.snr-keyinput');
    if (keyInput) {
      const save = () => setKey(keyInput.dataset.keyId, keyInput.value.trim());
      keyInput.addEventListener('change', save);
      keyInput.addEventListener('blur', save);
    }
    const selInput = row.querySelector('.snr-selinput');
    if (selInput) {
      selInput.addEventListener('change', () => setOpt(selInput.dataset.selId, selInput.value));
    }
    return row;
  }

  function renderManager() {
    const p = document.getElementById('snr-manager-panel');
    if (!p) return;
    p.innerHTML =
      '<div class="snr-panel-title">Userscript Manager</div>' +
      '<div class="snr-manager-intro">Switch features on or off by area. API keys and dropdown choices are saved in your browser.</div>';
    const byId = {};
    FEATURE_DEFS.forEach(f => { byId[f.id] = f; });
    const rendered = {};

    FEATURE_GROUPS.forEach(group => {
      const features = group.ids.map(id => byId[id]).filter(f => f && !f.hidden);
      if (!features.length) return;
      const section = document.createElement('section');
      section.className = 'snr-feature-group';
      section.innerHTML =
        '<div class="snr-group-head">' +
          '<div><div class="snr-group-title">' + escapeHtml(group.title) + '</div>' +
          '<div class="snr-group-note">' + escapeHtml(group.note || '') + '</div></div>' +
          '<div class="snr-group-count">' + features.length + '</div>' +
        '</div><div class="snr-group-body"></div>';
      const body = section.querySelector('.snr-group-body');
      features.forEach(f => {
        body.appendChild(renderFeatureRow(f));
        rendered[f.id] = true;
      });
      p.appendChild(section);
    });

    const loose = FEATURE_DEFS.filter(f => !rendered[f.id] && !f.hidden);
    if (loose.length) {
      const section = document.createElement('section');
      section.className = 'snr-feature-group';
      section.innerHTML =
        '<div class="snr-group-head">' +
          '<div><div class="snr-group-title">Other</div>' +
          '<div class="snr-group-note">New or uncategorised features.</div></div>' +
          '<div class="snr-group-count">' + loose.length + '</div>' +
        '</div><div class="snr-group-body"></div>';
      const body = section.querySelector('.snr-group-body');
      loose.forEach(f => body.appendChild(renderFeatureRow(f)));
      p.appendChild(section);
    }
  }

  /* ---- Sonarr Settings panel (the server config the script creates) ---- */
  function sq(sel) { const r = document.getElementById('snr-settings-panel'); return r ? r.querySelector(sel) : null; }

  function renderSonarrSettings() {
    const p = document.getElementById('snr-settings-panel');
    if (!p) return;
    servers = loadServers();
    if (servers.length === 0) servers.push(blankServer());
    if (activeTab < 0 || activeTab >= servers.length) activeTab = 0;

    const disabledNote = isEnabled('sonarr') ? '' :
      '<div class="snr-note">Sonarr Integration is currently turned <b>off</b> in the Userscript Manager above — ' +
      'these settings are saved but the banner pills won’t appear on series pages until you switch it on.</div>';

    p.innerHTML =
      '<div class="snr-panel-title">Sonarr Settings</div>' + disabledNote +
      '<div class="snr-tabs" data-el="tabs"></div>' +
      '<div class="snr-body" data-el="body"></div>' +
      '<div class="snr-status" data-el="status"></div>' +
      '<div class="snr-foot">' +
        '<button class="snr-btn danger" data-act="delete">Delete server</button>' +
        '<div class="right"><button class="snr-btn" data-act="test">Test</button>' +
        '<button class="snr-btn good" data-act="save">Save</button></div>' +
      '</div>';

    p.querySelector('[data-act="delete"]').addEventListener('click', onDeleteClick);
    p.querySelector('[data-act="save"]').addEventListener('click', onSaveClick);
    p.querySelector('[data-act="test"]').addEventListener('click', () => { commitCurrentForm(); testAndPopulate(servers[activeTab]); });

    renderTabs();
    renderBody();
  }

  function renderTabs() {
    const tabs = sq('[data-el="tabs"]');
    if (!tabs) return;
    tabs.innerHTML = '';
    servers.forEach((s, i) => {
      const t = document.createElement('div');
      t.className = 'snr-tab' + (i === activeTab ? ' active' : '');
      const dot = s._live === true ? 'ok' : (s._live === false ? 'bad' : '');
      t.innerHTML = `<span class="dot ${dot}"></span><span>${escapeHtml(s.name || ('Server ' + (i + 1)))}</span>`;
      t.addEventListener('click', () => { commitCurrentForm(); activeTab = i; renderTabs(); renderBody(); });
      tabs.appendChild(t);
    });
    const add = document.createElement('div');
    add.className = 'snr-tab add';
    add.textContent = '+ Add';
    add.title = 'Add another Sonarr server';
    add.addEventListener('click', () => { commitCurrentForm(); servers.push(blankServer()); activeTab = servers.length - 1; renderTabs(); renderBody(); });
    tabs.appendChild(add);
  }

  function renderBody() {
    const body = sq('[data-el="body"]');
    const s = servers[activeTab];
    if (!body) return;
    if (!s) { body.innerHTML = '<div class="snr-note">No server selected.</div>'; return; }

    body.innerHTML = `
      <div class="snr-field">
        <label>Server name</label>
        <input type="text" data-f="name" placeholder="e.g. Home Sonarr" value="${escapeAttr(s.name)}">
      </div>
      <div class="snr-field">
        <label>URL</label>
        <input type="text" data-f="url" placeholder="http://192.168.1.50:8989" value="${escapeAttr(s.url)}">
        <div class="snr-hint">Include http/https, host and port. Add a base path if Sonarr sits behind a reverse proxy (e.g. https://host/sonarr).</div>
      </div>
      <div class="snr-field">
        <label>API Key</label>
        <input type="text" data-f="apiKey" spellcheck="false" autocomplete="off" autocapitalize="off"
          autocorrect="off" name="snr_sonarr_key_${Date.now().toString(36)}"
          data-lpignore="true" data-1p-ignore data-bwignore data-form-type="other"
          placeholder="Sonarr → Settings → General → API Key" value="${escapeAttr(s.apiKey)}">
      </div>
      <div class="snr-row">
        <div class="snr-field">
          <label>Quality Profile</label>
          <select data-f="qualityProfileId"><option value="">— test connection first —</option></select>
        </div>
        <div class="snr-field">
          <label>Root Folder</label>
          <select data-f="rootFolderPath"><option value="">— test connection first —</option></select>
        </div>
      </div>
      <div class="snr-row">
        <div class="snr-field" data-el="langWrap" style="display:none;">
          <label>Language Profile</label>
          <select data-f="languageProfileId"></select>
        </div>
        <div class="snr-field">
          <label>Default monitor</label>
          <select data-f="monitor">
            ${['all','future','missing','existing','firstSeason','lastSeason','pilot','none']
              .map(v=>`<option value="${v}" ${s.monitor===v?'selected':''}>${v}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="snr-field"><label class="snr-toggle"><input type="checkbox" data-f="seasonFolder" ${s.seasonFolder?'checked':''}> Use season folders</label></div>
      <div class="snr-field">
        <label class="snr-toggle"><input type="checkbox" data-f="searchOnAdd" ${s.searchOnAdd?'checked':''}> Search for missing episodes on add</label>
        <div class="snr-hint">When adding a show, tell Sonarr to immediately start searching indexers for episodes.</div>
      </div>
    `;

    body.querySelectorAll('[data-f]').forEach(el => {
      const f = el.dataset.f;
      const handler = () => {
        if (el.type === 'checkbox') s[f] = el.checked;
        else if (f === 'qualityProfileId' || f === 'languageProfileId') s[f] = el.value ? Number(el.value) : null;
        else s[f] = el.value;
      };
      el.addEventListener('change', handler);
      el.addEventListener('input', handler);
    });

    // auto-test when both url + key filled and dropdowns still empty
    const urlEl = body.querySelector('[data-f="url"]');
    const keyEl = body.querySelector('[data-f="apiKey"]');
    const maybeAuto = () => {
      if (urlEl.value.trim() && keyEl.value.trim() && (!s._profiles || !s._profiles.length)) { commitCurrentForm(); testAndPopulate(s); }
    };
    urlEl.addEventListener('blur', maybeAuto);
    keyEl.addEventListener('blur', maybeAuto);

    if (s._profiles && s._profiles.length) fillProfiles(s);
    if (s._rootFolders && s._rootFolders.length) fillRootFolders(s);
    if (s._languageProfiles && s._languageProfiles.length) fillLanguageProfiles(s);
    if (s._live === true) setStatus('ok', `Connected — Sonarr v${s._version || '?'}`);
  }

  function commitCurrentForm() {
    const body = sq('[data-el="body"]');
    const s = servers[activeTab];
    if (!body || !s) return;
    body.querySelectorAll('[data-f]').forEach(el => {
      const f = el.dataset.f;
      if (el.type === 'checkbox') s[f] = el.checked;
      else if (f === 'qualityProfileId' || f === 'languageProfileId') s[f] = el.value ? Number(el.value) : null;
      else s[f] = el.value;
    });
  }

  function setStatus(kind, html) {
    const el = sq('[data-el="status"]');
    if (!el) return;
    el.className = 'snr-status show ' + kind;
    el.innerHTML = (kind === 'info' ? '<span class="snr-spin"></span>' : '') + html;
  }

  function fillProfiles(s) {
    const sel = sq('[data-f="qualityProfileId"]');
    if (!sel) return;
    sel.innerHTML = '<option value="">— select —</option>' +
      s._profiles.map(p => `<option value="${p.id}" ${s.qualityProfileId===p.id?'selected':''}>${escapeHtml(p.name)}</option>`).join('');
  }
  function fillRootFolders(s) {
    const sel = sq('[data-f="rootFolderPath"]');
    if (!sel) return;
    sel.innerHTML = '<option value="">— select —</option>' +
      s._rootFolders.map(r => {
        const free = r.freeSpace ? ' (' + bytes(r.freeSpace) + ' free)' : '';
        return `<option value="${escapeAttr(r.path)}" ${s.rootFolderPath===r.path?'selected':''}>${escapeHtml(r.path)}${free}</option>`;
      }).join('');
  }
  function fillLanguageProfiles(s) {
    const wrap = sq('[data-el="langWrap"]');
    const sel = sq('[data-f="languageProfileId"]');
    if (!wrap || !sel) return;
    if (!s._languageProfiles.length) { wrap.style.display = 'none'; return; }
    wrap.style.display = '';
    sel.innerHTML = s._languageProfiles.map(p => `<option value="${p.id}" ${s.languageProfileId===p.id?'selected':''}>${escapeHtml(p.name)}</option>`).join('');
  }

  async function testAndPopulate(s) {
    if (!s) return;
    if (!s.url || !s.url.trim()) { setStatus('bad', 'Enter a URL first.'); return; }
    if (!s.apiKey || !s.apiKey.trim()) { setStatus('bad', 'Enter an API key first.'); return; }
    setStatus('info', 'Testing connection…');
    try {
      const st = await SonarrAPI.status(s);
      s._live = true;
      s._version = st.data && st.data.version;
      if (!s.name) s.name = (st.data && st.data.instanceName) || hostFrom(s.url);
      const [qp, rf] = await Promise.all([
        SonarrAPI.qualityProfiles(s).catch(() => ({ data: [] })),
        SonarrAPI.rootFolders(s).catch(() => ({ data: [] }))
      ]);
      s._profiles = qp.data || [];
      s._rootFolders = rf.data || [];
      try { const lp = await SonarrAPI.languageProfiles(s); s._languageProfiles = lp.data || []; }
      catch (e) { s._languageProfiles = []; }

      fillProfiles(s); fillRootFolders(s); fillLanguageProfiles(s);
      if (!s.qualityProfileId && s._profiles[0]) { s.qualityProfileId = s._profiles[0].id; fillProfiles(s); }
      if (!s.rootFolderPath && s._rootFolders[0]) { s.rootFolderPath = s._rootFolders[0].path; fillRootFolders(s); }

      const nameField = sq('[data-f="name"]');
      if (nameField && !nameField.value) nameField.value = s.name;

      setStatus('ok', `Connected — Sonarr v${s._version || '?'}. Loaded ${s._profiles.length} profile(s), ${s._rootFolders.length} root folder(s).`);
      renderTabs();
    } catch (err) {
      s._live = false;
      setStatus('bad', 'Failed: ' + escapeHtml(err.message || 'unknown error'));
      renderTabs();
    }
  }

  function onSaveClick() {
    commitCurrentForm();
    const clean = servers.filter(s => (s.url && s.url.trim()) || (s.name && s.name.trim()));
    saveServers(clean);
    servers = loadServers();
    if (servers.length === 0) servers.push(blankServer());
    if (activeTab >= servers.length) activeTab = servers.length - 1;
    setStatus('ok', 'Saved.');
    renderTabs();
  }

  function onDeleteClick() {
    const s = servers[activeTab];
    if (!s) return;
    if (!confirm('Delete server "' + (s.name || 'Server ' + (activeTab + 1)) + '"?')) return;
    servers.splice(activeTab, 1);
    if (servers.length === 0) servers.push(blankServer());
    activeTab = Math.max(0, activeTab - 1);
    saveServers(servers.filter(x => (x.url && x.url.trim())));
    renderTabs(); renderBody();
    setStatus('ok', 'Deleted.');
  }

  /* =========================================================================
   * SERIES PAGE — Sonarr library-status CARD (sidebar)
   *   A titled panel (like PTP's Radarr card) with one colour-coded pill per
   *   configured server, each carrying a status dot:
   *     blue  = checking      green = on Sonarr (click → open)
   *     red   = not on Sonarr (click → add)   grey = offline / not set up
   * =======================================================================*/
  function setEntryState(el, state) {
    el.classList.remove('is-checking', 'is-in-library', 'is-missing', 'is-offline', 'is-setup');
    el.classList.add('is-' + state);
  }

  function injectLinkbar() {
    if (document.getElementById('snr-inline')) return true;

    const sidebar = document.querySelector('div.sidebar') || document.querySelector('.sidebar');
    const lb = document.querySelector('.linkbox');
    if (!sidebar && !lb) return false;

    const panel = document.createElement('section');
    panel.id = 'snr-inline';
    panel.setAttribute('aria-label', 'Sonarr library status');
    panel.innerHTML =
      '<div class="snr-page-head">' +
        '<span class="snr-page-kicker">Sonarr</span>' +
        '<span class="snr-page-sub">Library status</span>' +
      '</div>' +
      '<div class="snr-page-actions"></div>';

    if (sidebar) {
      // Sit just below the Action Bar / Fanart clear-logo when present, else at the top.
      const anchor = snrSidebarPinnedAnchor(sidebar);
      if (anchor) anchor.insertAdjacentElement('afterend', panel);
      else sidebar.insertBefore(panel, sidebar.firstElementChild);
    } else {
      lb.insertAdjacentElement('afterend', panel);
    }

    renderSonarrCard();
    return true;
  }

  // (Re)build the card body: one pill per configured server.
  function renderSonarrCard() {
    const panel = document.getElementById('snr-inline');
    if (!panel) return;
    const actions = panel.querySelector('.snr-page-actions');
    const sub = panel.querySelector('.snr-page-sub');
    if (!actions) return;
    actions.textContent = '';

    const info = window.__btnSeries || seriesInfo();
    const list = loadServers().filter(s => s.url && s.url.trim() && s.apiKey && s.apiKey.trim());

    if (list.length === 0) {
      if (sub) sub.textContent = 'No server configured';
      const a = document.createElement('a');
      a.className = 'snr-entry';
      a.href = '/user.php?action=edit';
      a.textContent = 'Set up Sonarr';
      a.title = 'No Sonarr server configured — open profile settings';
      setEntryState(a, 'setup');
      actions.appendChild(a);
      return;
    }

    if (sub) sub.textContent = list.length === 1 ? 'Checking server' : 'Checking servers';
    list.forEach(s => {
      const label = s.name || hostFrom(s.url);
      const a = document.createElement('a');
      a.className = 'snr-entry';
      a.href = 'javascript:void(0)';
      a.textContent = label;
      setEntryState(a, 'checking');
      a.title = 'Checking ' + label + '…';
      actions.appendChild(a);
      resolveServerEntry(s, info, a);
    });
    updateCardSummary();
  }

  function updateCardSummary() {
    const panel = document.getElementById('snr-inline');
    if (!panel) return;
    const sub = panel.querySelector('.snr-page-sub');
    const entries = [...panel.querySelectorAll('a.snr-entry')];
    if (!sub || !entries.length) return;
    const checking  = entries.filter(a => a.classList.contains('is-checking')).length;
    const inLibrary = entries.filter(a => a.classList.contains('is-in-library')).length;
    const missing   = entries.filter(a => a.classList.contains('is-missing')).length;
    const offline   = entries.filter(a => a.classList.contains('is-offline')).length;
    if (checking) {
      sub.textContent = checking === 1 ? 'Checking server' : `Checking ${checking} servers`;
      return;
    }
    const bits = [];
    if (inLibrary) bits.push(inLibrary === 1 ? 'In library' : `${inLibrary} in library`);
    if (missing)   bits.push(missing === 1 ? 'Ready to add' : `${missing} ready to add`);
    if (offline)   bits.push(offline === 1 ? '1 offline' : `${offline} offline`);
    sub.textContent = bits.join(' · ') || 'Library status';
  }

  // Resolve a single server's pill: green (on Sonarr) / red (add) / grey (offline).
  async function resolveServerEntry(s, info, a) {
    const label = s.name || hostFrom(s.url);
    try {
      await SonarrAPI.status(s);
      let existing = null;
      if (info.tvdbId) {
        try { const r = await SonarrAPI.seriesByTvdb(s, info.tvdbId); existing = (r.data && r.data[0]) || null; } catch (e) {}
      }
      if (existing) {
        setEntryState(a, 'in-library');
        a.textContent = 'On ' + label;
        a.href = normBase(s.url) + '/series/' + encodeURIComponent(existing.titleSlug);
        a.target = '_blank'; a.rel = 'noopener';
        a.title = 'On ' + label + ' — click to open in Sonarr';
      } else {
        setEntryState(a, 'missing');
        a.textContent = 'Add to ' + label;
        a.href = 'javascript:void(0)';
        a.title = 'Not on ' + label + ' — click to add';
        a.addEventListener('click', (e) => { e.preventDefault(); openAddModal(s, info); });
      }
    } catch (err) {
      setEntryState(a, 'offline');
      a.textContent = label + ' offline';
      a.title = label + ' offline: ' + ((err && err.message) || 'unreachable');
      a.addEventListener('click', (e) => e.preventDefault());
    } finally {
      updateCardSummary();
    }
  }

  /* =========================================================================
   * Add-to-Sonarr confirm modal
   * =======================================================================*/
  let addState = null;

  function buildAddSkeleton() {
    if (document.getElementById('snr-add-ov')) return;
    const ov = document.createElement('div');
    ov.id = 'snr-add-ov';
    ov.className = 'snr';
    ov.innerHTML = `
      <div id="snr-add-modal">
        <div class="snr-addhead">
          <img data-el="poster" alt="">
          <div class="meta">
            <h3 data-el="title">…</h3>
            <div class="sub" data-el="sub"></div>
            <div class="srv" data-el="srv"></div>
          </div>
        </div>
        <div class="snr-addbody">
          <div class="snr-status" data-el="status"></div>
          <div class="snr-row">
            <div class="snr-field"><label>Quality Profile</label><select data-f="qualityProfileId"></select></div>
            <div class="snr-field"><label>Root Folder</label><select data-f="rootFolderPath"></select></div>
          </div>
          <div class="snr-row">
            <div class="snr-field" data-el="langWrap" style="display:none;"><label>Language Profile</label><select data-f="languageProfileId"></select></div>
            <div class="snr-field"><label>Monitor</label><select data-f="monitor">
              ${['all','future','missing','existing','firstSeason','lastSeason','pilot','none'].map(v=>`<option value="${v}">${v}</option>`).join('')}
            </select></div>
          </div>
          <div class="snr-field"><label class="snr-toggle"><input type="checkbox" data-f="seasonFolder"> Use season folders</label></div>
          <div class="snr-field"><label class="snr-toggle"><input type="checkbox" data-f="searchOnAdd"> Search for missing episodes on add</label></div>
        </div>
        <div class="snr-addfoot">
          <button class="snr-btn" data-act="cancel">Cancel</button>
          <div class="right"><button class="snr-btn good" data-act="add">Add to Sonarr</button></div>
        </div>
      </div>`;
    document.body.appendChild(ov);
    ov.addEventListener('click', (e) => { if (e.target === ov) ov.classList.remove('open'); });
    ov.querySelector('[data-act="cancel"]').addEventListener('click', () => ov.classList.remove('open'));
  }

  async function openAddModal(server, info) {
    buildAddSkeleton();
    const ov = document.getElementById('snr-add-ov');
    ov.classList.add('open');
    const q = (sel) => ov.querySelector(sel);
    const setStat = (k, h) => { const el = q('[data-el="status"]'); el.className = 'snr-status show ' + k; el.innerHTML = (k === 'info' ? '<span class="snr-spin"></span>' : '') + h; };
    const hideStat = () => { q('[data-el="status"]').className = 'snr-status'; };

    q('[data-el="srv"]').textContent = 'Server: ' + (server.name || hostFrom(server.url));
    q('[data-el="title"]').textContent = info.title || 'Resolving…';
    q('[data-el="sub"]').textContent = '';
    q('[data-el="poster"]').src = '';
    const addBtn = q('[data-act="add"]'); addBtn.disabled = true;
    setStat('info', 'Resolving series & loading options…');

    try {
      const term = info.tvdbId ? ('tvdb:' + info.tvdbId) : info.title;
      const [qp, rf, lk] = await Promise.all([
        SonarrAPI.qualityProfiles(server),
        SonarrAPI.rootFolders(server),
        SonarrAPI.lookup(server, term)
      ]);
      let lang = [];
      try { const lp = await SonarrAPI.languageProfiles(server); lang = lp.data || []; } catch (e) {}
      const profiles = qp.data || [], roots = rf.data || [];
      const found = (lk.data || []).find(x => String(x.tvdbId) === String(info.tvdbId)) || (lk.data || [])[0];
      if (!found) { setStat('bad', 'Could not find this series in Sonarr’s lookup.'); return; }
      addState = { server, lookup: found };

      q('[data-el="title"]').textContent = (found.title || info.title) + (found.year ? (' (' + found.year + ')') : '');
      q('[data-el="sub"]').textContent = [found.network, found.status,
        (found.seasons ? found.seasons.filter(se => se.seasonNumber > 0).length + ' seasons' : '')].filter(Boolean).join(' · ');
      const poster = (found.images || []).find(i => i.coverType === 'poster');
      if (poster) q('[data-el="poster"]').src = poster.remoteUrl || poster.url;

      q('[data-f="qualityProfileId"]').innerHTML = profiles.map(p =>
        `<option value="${p.id}" ${server.qualityProfileId===p.id?'selected':''}>${escapeHtml(p.name)}</option>`).join('');
      q('[data-f="rootFolderPath"]').innerHTML = roots.map(r =>
        `<option value="${escapeAttr(r.path)}" ${server.rootFolderPath===r.path?'selected':''}>${escapeHtml(r.path)}${r.freeSpace?(' ('+bytes(r.freeSpace)+' free)'):''}</option>`).join('');
      const langWrap = q('[data-el="langWrap"]');
      if (lang.length) {
        langWrap.style.display = '';
        q('[data-f="languageProfileId"]').innerHTML = lang.map(p =>
          `<option value="${p.id}" ${server.languageProfileId===p.id?'selected':''}>${escapeHtml(p.name)}</option>`).join('');
      } else { langWrap.style.display = 'none'; }
      q('[data-f="monitor"]').value = server.monitor || 'all';
      q('[data-f="seasonFolder"]').checked = server.seasonFolder !== false;
      q('[data-f="searchOnAdd"]').checked = server.searchOnAdd !== false;

      hideStat();
      addBtn.disabled = false;
      addBtn.onclick = () => doAdd(ov, q, setStat, addBtn);
    } catch (err) {
      setStat('bad', 'Error: ' + escapeHtml(err.message || 'unknown'));
    }
  }

  async function doAdd(ov, q, setStat, addBtn) {
    if (!addState) return;
    const { server, lookup } = addState;
    const qpId = Number(q('[data-f="qualityProfileId"]').value) || null;
    const rootPath = q('[data-f="rootFolderPath"]').value;
    const langWrap = q('[data-el="langWrap"]');
    const langId = (langWrap.style.display !== 'none' && q('[data-f="languageProfileId"]').value)
      ? Number(q('[data-f="languageProfileId"]').value) : null;
    const monitor = q('[data-f="monitor"]').value;
    const seasonFolder = q('[data-f="seasonFolder"]').checked;
    const searchOnAdd = q('[data-f="searchOnAdd"]').checked;
    if (!qpId) { setStat('bad', 'Pick a quality profile.'); return; }
    if (!rootPath) { setStat('bad', 'Pick a root folder.'); return; }

    const payload = Object.assign({}, lookup, {
      qualityProfileId: qpId, rootFolderPath: rootPath, monitored: true, seasonFolder: seasonFolder,
      addOptions: { monitor: monitor, searchForMissingEpisodes: searchOnAdd, searchForCutoffUnmetEpisodes: false }
    });
    if (langId) payload.languageProfileId = langId;

    addBtn.disabled = true;
    setStat('info', 'Adding to ' + (server.name || 'Sonarr') + '…');
    try {
      await SonarrAPI.addSeries(server, payload);
      setStat('ok', 'Added! ' + (searchOnAdd ? 'Sonarr is searching for episodes.' : 'Monitoring set.'));
      // flip the matching banner pill to green
      setTimeout(() => { ov.classList.remove('open'); refreshPills(); }, 1300);
    } catch (err) {
      addBtn.disabled = false;
      setStat('bad', 'Add failed: ' + escapeHtml(err.message || 'unknown'));
    }
  }

  function refreshPills() {
    const panel = document.getElementById('snr-inline');
    if (panel) { renderSonarrCard(); return; }
    injectLinkbar();
  }

  /* =========================================================================
   * Fanart.tv Logo — HD clear logo at the top of the series sidebar
   * =======================================================================*/
  function gmGet(url) {
    return new Promise((resolve, reject) => {
      try {
        gmXhr({
          method: 'GET', url, timeout: 15000,
          onload: (res) => resolve(res.responseText || ''),
          ontimeout: () => reject(new Error('timeout')),
          onerror: () => reject(new Error('network error'))
        });
      } catch (e) { reject(e); }
    });
  }

  // Resolve a TVDB id — prefer what seriesInfo() already found, otherwise
  // follow the thetvdb.com link and scrape the id off the target page.
  async function resolveTvdbId() {
    const info = window.__btnSeries || seriesInfo();
    if (info && info.tvdbId) return info.tvdbId;
    const a = document.querySelector('a[href*="thetvdb.com"]');
    if (!a) return null;
    try {
      const html = await gmGet(a.href);
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const span = doc.querySelector('#series_basic_info > ul > li:nth-child(1) > span');
      const id = span && span.textContent ? span.textContent.replace(/\D+/g, '') : '';
      return id || null;
    } catch (e) { return null; }
  }

  async function fetchFanartLogo(tvdbId, key) {
    const url = 'https://webservice.fanart.tv/v3/tv/' + encodeURIComponent(tvdbId) + '?api_key=' + encodeURIComponent(key);
    let json;
    try { json = JSON.parse(await gmGet(url)); } catch (e) { return null; }
    const logos = (json && json.hdtvlogo) || (json && json.clearlogo) || [];
    if (!logos.length) return null;
    const en = logos.find(l => l && l.lang === 'en');
    return (en || logos[0]).url || null;
  }

  function addFanartLogo(logoUrl) {
    if (!logoUrl || document.getElementById('snr-fanart-logo')) return;
    const sidebar = document.querySelector('div.sidebar') || document.querySelector('.sidebar');
    if (!sidebar) return;
    const box = document.createElement('div');
    box.className = 'box snr';
    box.id = 'snr-fanart-logo';
    box.innerHTML = '<div style="padding:18px 20px;display:flex;align-items:center;justify-content:center;">' +
      '<img alt="" style="width:100%;max-width:100%;height:auto;filter:drop-shadow(0 3px 10px rgba(0,0,0,.5));"></div>';
    box.querySelector('img').src = logoUrl;
    const bar = sidebar.querySelector(':scope > .linkbox.snr-action-bar');
    if (bar) bar.insertAdjacentElement('afterend', box);
    else sidebar.insertBefore(box, sidebar.firstChild);
  }

  async function runFanart() {
    if (document.getElementById('snr-fanart-logo')) return;
    const key = (getKey('fanart') || '').trim();
    if (!key) return; // no key configured — silently skip
    try {
      const tvdbId = await resolveTvdbId();
      if (!tvdbId) return;
      const url = await fetchFanartLogo(tvdbId, key);
      if (url) addFanartLogo(url);
    } catch (e) { /* non-fatal */ }
  }

  /* =========================================================================
   * FEATURE: IMDb Parents Guide (series page, card grid below torrents)
   *   Self-contained module — all helpers are local so nothing collides with
   *   the Sonarr/Fanart code above. Uses IMDb's internal GraphQL endpoint.
   * =======================================================================*/
  function runParentsGuide() {
    if (document.getElementById('btn-parents-guide')) return;

    const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
    const CACHE_PREFIX = 'btn_pg_cache_';
    const PREF_BOX_COLLAPSED = 'btn_pg_box_collapsed';
    const PREF_CAT_COLLAPSED = 'btn_pg_cat_collapsed';
    const GQL_ENDPOINT = 'https://api.graphql.imdb.com/';
    const GQL_CLIENT_NAME = 'imdb-web-next-localized';
    const CERT_PREF = ['GB', 'US'];
    const ITEMS_PREVIEW = 3;
    const LOG = (...a) => console.log('[STMPE-PG]', ...a);

    const CAT_META = {
      NUDITY:      { icon: '🔞', order: 0 },
      VIOLENCE:    { icon: '🔪', order: 1 },
      PROFANITY:   { icon: '🤬', order: 2 },
      ALCOHOL:     { icon: '🍸', order: 3 },
      FRIGHTENING: { icon: '😱', order: 4 }
    };
    const SEV = {
      'None':     { color: '#9a9998', rank: 0 },
      'Mild':     { color: '#8cb844', rank: 1 },
      'Moderate': { color: '#ed9a02', rank: 2 },
      'Severe':   { color: '#fa6f64', rank: 3 }
    };
    const SEV_UNKNOWN = { color: '#8a94a6', rank: -1 };

    function sevInfo(level) { return (level && SEV[level]) || SEV_UNKNOWN; }
    function loadPref(k, d) { try { return GM_getValue(k, d); } catch (e) { return d; } }
    function savePref(k, v) { try { GM_setValue(k, v); } catch (e) {} }
    function delPref(k)     { try { GM_deleteValue(k); } catch (e) {} }
    function getCatCollapsedMap() { try { return JSON.parse(loadPref(PREF_CAT_COLLAPSED, '{}')) || {}; } catch (e) { return {}; } }
    function setCatCollapsed(catId, collapsed) {
      const m = getCatCollapsedMap();
      if (collapsed) m[catId] = true; else delete m[catId];
      savePref(PREF_CAT_COLLAPSED, JSON.stringify(m));
    }
    function sanitize(html) {
      const t = document.createElement('div');
      t.innerHTML = html || '';
      t.querySelectorAll('script,style,iframe,object,embed,link,meta').forEach(n => n.remove());
      t.querySelectorAll('*').forEach(el2 => {
        [...el2.attributes].forEach(a => {
          const n = a.name.toLowerCase();
          if (n.startsWith('on') || (n === 'href' && /^\s*javascript:/i.test(a.value))) el2.removeAttribute(a.name);
        });
      });
      return t.innerHTML;
    }
    function esc(s) { return (s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
    function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
    function pct(n, d) { return d > 0 ? Math.round((n / d) * 100) : 0; }

    function findImdbId() {
      const a = document.querySelector('a[href*="imdb.com/title/tt"]');
      if (a) { const m = a.href.match(/tt\d{7,9}/); if (m) return m[0]; }
      const m2 = document.documentElement.innerHTML.match(/imdb\.com\/title\/(tt\d{7,9})/);
      return m2 ? m2[1] : null;
    }

    function gmPostJson(url, bodyObj, extraHeaders) {
      return new Promise((resolve, reject) => {
        gmXhr({
          method: 'POST', url: url,
          headers: Object.assign({ 'Content-Type': 'application/json', 'Accept': 'application/json' }, extraHeaders || {}),
          data: JSON.stringify(bodyObj), timeout: 8000,
          onload: (r) => resolve(r),
          onerror: () => reject(new Error('Network error contacting IMDb GraphQL')),
          ontimeout: () => reject(new Error('IMDb GraphQL request timed out'))
        });
      });
    }

    const PG_QUERY = `
      query BTN_ParentsGuide($id: ID!) {
        title(id: $id) {
          id
          certificate { rating }
          parentsGuide {
            categories {
              category { id text }
              severity { text votedFor }
              totalSeverityVotes
              guideItems(first: 100) {
                edges { node { ... on ParentsGuideItem { isSpoiler text { plaidHtml plainText } } } }
              }
            }
          }
        }
      }`;

    function normalizeTitle(title) {
      const pg = title && title.parentsGuide;
      const certificate = (title && title.certificate && title.certificate.rating) || null;
      if (!pg) return { ok: false, reason: 'No parents-guide data for this title.', certificate };
      const categories = (pg.categories || []).map(c => {
        const id = (c && c.category && c.category.id) || null;
        const label = (c && c.category && c.category.text) || id || '?';
        let level = (c && c.severity && c.severity.text) || null;
        if (level === 'Unknown') level = null;
        const items = ((c && c.guideItems && c.guideItems.edges) || [])
          .map(e => { const n = e && e.node; if (!n) return null; const html = (n.text && (n.text.plaidHtml || n.text.plainText)) || ''; return html ? { html, spoiler: !!n.isSpoiler } : null; })
          .filter(Boolean)
          .sort((a, b) => (a.spoiler ? 1 : 0) - (b.spoiler ? 1 : 0));
        return { id: id || label, label, level, votedFor: (c && c.severity && c.severity.votedFor) || 0, total: (c && c.totalSeverityVotes) || 0, items };
      }).sort((a, b) => (CAT_META[a.id]?.order ?? 99) - (CAT_META[b.id]?.order ?? 99));
      const hasAny = categories.some(c => c.level || c.items.length);
      if (!hasAny) return { ok: false, reason: 'No parents-guide entries submitted for this title yet.', certificate };
      return { ok: true, certificate, categories };
    }

    async function fetchViaGraphQL(ttId) {
      const body = { query: PG_QUERY, operationName: 'BTN_ParentsGuide', variables: { id: ttId } };
      let r;
      try { r = await gmPostJson(GQL_ENDPOINT, body, { 'x-imdb-client-name': GQL_CLIENT_NAME }); }
      catch (e) { return { ok: false, reason: e.message || 'GraphQL network error' }; }
      if (r.status === 202 || !(r.responseText || '').trim()) return { ok: false, reason: 'GraphQL endpoint throttled/empty (HTTP ' + r.status + ').' };
      if (r.status >= 400) return { ok: false, reason: 'GraphQL endpoint returned HTTP ' + r.status + '.', rawText: r.responseText };
      let json;
      try { json = JSON.parse(r.responseText); } catch (e) { return { ok: false, reason: 'GraphQL response was not JSON.', rawText: r.responseText }; }
      if (json.errors && json.errors.length) return { ok: false, reason: 'GraphQL errors: ' + json.errors.map(e => e.message).join('; '), raw: json };
      const title = json && json.data && json.data.title;
      if (!title) return { ok: false, reason: 'GraphQL returned no title data.', raw: json };
      const norm = normalizeTitle(title); norm.raw = json; return norm;
    }

    const CERT_QUERY = `
      query BTN_Certs($id: ID!) {
        title(id: $id) { certificates(first: 80) { edges { node { rating country { id text } ratingsBody { id } } } } }
      }`;

    async function fetchPreferredCert(ttId) {
      let r;
      try { r = await gmPostJson(GQL_ENDPOINT, { query: CERT_QUERY, operationName: 'BTN_Certs', variables: { id: ttId } }, { 'x-imdb-client-name': GQL_CLIENT_NAME }); }
      catch (e) { return null; }
      if (r.status >= 400 || !(r.responseText || '').trim()) return null;
      let j; try { j = JSON.parse(r.responseText); } catch (e) { return null; }
      if (j.errors && j.errors.length) return null;
      const edges = (j && j.data && j.data.title && j.data.title.certificates && j.data.title.certificates.edges) || [];
      const byCountry = {};
      edges.forEach(e => { const n = e && e.node; if (!n) return; const c = n.country && n.country.id; if (!c) return; if (!byCountry[c]) byCountry[c] = { rating: n.rating, body: (n.ratingsBody && n.ratingsBody.id) || null }; });
      for (const c of CERT_PREF) { if (byCountry[c] && byCountry[c].rating) return { country: c, rating: byCountry[c].rating, body: byCountry[c].body }; }
      return null;
    }

    const inflight = {};
    function fetchGuide(ttId, force) {
      if (!force && inflight[ttId]) return inflight[ttId];
      const p = _fetchGuide(ttId, force).finally(() => { if (inflight[ttId] === p) delete inflight[ttId]; });
      inflight[ttId] = p; return p;
    }
    async function _fetchGuide(ttId, force) {
      const cacheKey = CACHE_PREFIX + ttId;
      if (!force) { try { const cached = JSON.parse(loadPref(cacheKey, 'null')); if (cached && cached.data && (Date.now() - cached.at) < CACHE_TTL_MS) return cached.data; } catch (e) {} }
      let res;
      try { res = await fetchViaGraphQL(ttId); } catch (e) { res = { ok: false, reason: (e && e.message) || 'GraphQL failed' }; }
      if (res.ok) {
        try { const c = await fetchPreferredCert(ttId); if (c) { res.certificate = c.rating; res.certCountry = c.country; res.certBody = c.body; } } catch (e) {}
        savePref(cacheKey, JSON.stringify({ at: Date.now(), data: res }));
      }
      return res;
    }

    function fullLink(ttId) { const p = el('div', 'pg-fulllink'); p.innerHTML = '<a href="https://www.imdb.com/title/' + ttId + '/parentalguide/" target="_blank" rel="noopener">View full guide on IMDb →</a>'; return p; }
    function sourceBadge() { return '<span class="pg-src" title="Fetched from IMDb\'s internal GraphQL endpoint">GraphQL API</span>'; }
    function certSpan(data) {
      if (!data || !data.certificate) return null;
      const country = data.certCountry ? data.certCountry + ' ' : '';
      const s = el('span', 'pg-cert', esc(country + data.certificate));
      s.title = ((data.certBody || data.certCountry || '') + ' rating').trim();
      return s;
    }
    function buildBox(ttId) {
      const box = el('div', 'box pg-box'); box.id = 'btn-parents-guide';
      const head = el('div', 'head pg-head');
      const collapsedBox = loadPref(PREF_BOX_COLLAPSED, true);
      head.innerHTML = '<span class="pg-caret">' + (collapsedBox ? '▸' : '▾') + '</span><span class="pg-title">🎬 IMDb Parents Guide</span><span class="pg-head-right"></span>';
      const body = el('div', 'body pg-body');
      if (collapsedBox) body.style.display = 'none';
      head.addEventListener('click', () => {
        const hidden = body.style.display === 'none';
        body.style.display = hidden ? '' : 'none';
        head.querySelector('.pg-caret').textContent = hidden ? '▾' : '▸';
        savePref(PREF_BOX_COLLAPSED, !hidden);
      });
      box.appendChild(head); box.appendChild(body);
      load(box, head, body, ttId, false);
      return box;
    }
    function load(box, head, body, ttId, force) {
      body.innerHTML = '';
      body.appendChild(el('div', 'pg-status', 'Loading parents guide…'));
      fetchGuide(ttId, force)
        .then(res => res.ok ? renderData(box, head, body, res, ttId) : renderMessage(box, head, body, ttId, res))
        .catch(err => renderMessage(box, head, body, ttId, { reason: (err && err.message) || 'Unknown error' }, true));
    }
    function renderMessage(box, head, body, ttId, res, isError) {
      body.innerHTML = '';
      const rightM = head.querySelector('.pg-head-right'); rightM.innerHTML = '';
      const cM = certSpan(res); if (cM) rightM.appendChild(cM);
      body.appendChild(el('div', 'pg-status' + (isError ? ' pg-error' : ''), (isError ? '⚠️ ' : '') + (res.reason || 'No data.')));
      const retry = el('button', 'pg-retry', '↻ Retry');
      retry.addEventListener('click', () => { delPref(CACHE_PREFIX + ttId); load(box, head, body, ttId, true); });
      body.appendChild(retry);
      body.appendChild(fullLink(ttId));
    }
    function renderData(box, head, body, data, ttId) {
      body.innerHTML = '';
      let worst = SEV_UNKNOWN, worstLevel = null;
      data.categories.forEach(c => { const inf = sevInfo(c.level); if (inf.rank > worst.rank) { worst = inf; worstLevel = c.level; } });
      box.style.setProperty('--pg-accent', worst.color);
      const right = head.querySelector('.pg-head-right'); right.innerHTML = '';
      right.insertAdjacentHTML('beforeend', sourceBadge());
      const cD = certSpan(data); if (cD) right.appendChild(cD);
      if (worstLevel) { const o = el('span', 'pg-overall', worstLevel); o.style.background = worst.color; right.appendChild(o); }
      const catCollapsed = getCatCollapsedMap();
      data.categories.forEach(cat => {
        const meta = CAT_META[cat.id] || { icon: '•' };
        const inf = sevInfo(cat.level);
        const hasItems = cat.items.length > 0;
        const catEl = el('div', 'pg-cat'); catEl.style.setProperty('--sev', inf.color);
        let collapsed = (cat.id in catCollapsed) ? catCollapsed[cat.id] : (cat.level === 'None' || !hasItems);
        const cHead = el('div', 'pg-cat-head');
        cHead.innerHTML = '<span class="pg-cat-caret">' + (collapsed ? '▸' : '▾') + '</span><span class="pg-cat-icon">' + meta.icon + '</span><span class="pg-cat-label">' + esc(cat.label) + '</span>' + (hasItems ? '<span class="pg-cat-count">' + cat.items.length + '</span>' : '') + '<span class="pg-sev-badge">' + (cat.level || '—') + '</span>';
        const cBody = el('div', 'pg-cat-body');
        if (collapsed) cBody.style.display = 'none';
        if (cat.total > 0) {
          const vp = pct(cat.votedFor, cat.total);
          const bar = el('div', 'pg-votebar'); bar.title = cat.votedFor + ' of ' + cat.total + ' voters (' + vp + '%)';
          const fill = el('div', 'pg-votebar-fill'); fill.style.width = vp + '%'; fill.style.background = inf.color;
          bar.appendChild(fill); cBody.appendChild(bar);
          cBody.appendChild(el('div', 'pg-votemeta', cat.votedFor + '/' + cat.total + ' voters (' + vp + '%)'));
        }
        if (hasItems) {
          const makeLi = (item) => {
            const li = el('li', 'pg-item' + (item.spoiler ? ' pg-spoiler' : ''));
            li.innerHTML = sanitize(item.html);
            if (item.spoiler) { li.title = 'Spoiler — click to reveal'; li.addEventListener('click', () => li.classList.toggle('revealed')); }
            return li;
          };
          const shown = cat.items.slice(0, ITEMS_PREVIEW);
          const rest  = cat.items.slice(ITEMS_PREVIEW);
          const ul = el('ul', 'pg-items'); shown.forEach(item => ul.appendChild(makeLi(item))); cBody.appendChild(ul);
          if (rest.length) {
            const moreUl = el('ul', 'pg-items pg-more-items'); moreUl.style.display = 'none';
            rest.forEach(item => moreUl.appendChild(makeLi(item))); cBody.appendChild(moreUl);
            const moreBtn = el('button', 'pg-more', '+ ' + rest.length + ' more');
            moreBtn.addEventListener('click', (e) => { e.stopPropagation(); const hidden = moreUl.style.display === 'none'; moreUl.style.display = hidden ? '' : 'none'; moreBtn.textContent = hidden ? '− show less' : ('+ ' + rest.length + ' more'); });
            cBody.appendChild(moreBtn);
          }
        } else { cBody.appendChild(el('div', 'pg-noitems', 'No detailed notes listed.')); }
        cHead.addEventListener('click', () => { const hidden = cBody.style.display === 'none'; cBody.style.display = hidden ? '' : 'none'; cHead.querySelector('.pg-cat-caret').textContent = hidden ? '▾' : '▸'; setCatCollapsed(cat.id, !hidden); });
        catEl.appendChild(cHead); catEl.appendChild(cBody); body.appendChild(catEl);
      });
      body.appendChild(fullLink(ttId));
    }
    function placeBox(box) {
      const mc = document.querySelector('.main_column');
      if (mc) {
        const tables = mc.querySelectorAll('.torrent_table');
        if (tables.length) { const last = tables[tables.length - 1]; last.parentNode.insertBefore(box, last.nextSibling); return true; }
        mc.appendChild(box); return true;
      }
      const thin = document.querySelector('.thin');
      if (thin) { thin.appendChild(box); return true; }
      return false;
    }
    function tryInjectPg() {
      if (document.getElementById('btn-parents-guide')) return true;
      const ttId = findImdbId();
      if (!ttId) return false;
      if (!document.querySelector('.main_column')) return false;
      const box = buildBox(ttId);
      return placeBox(box);
    }

    injectCss('snr-pg-style', `
      #btn-parents-guide { --pg-accent:#8a94a6; clear:both; width:100%; box-sizing:border-box; margin:0 0 10px; overflow:hidden; }
      #btn-parents-guide .pg-head { display:flex; align-items:center; gap:6px; cursor:pointer; border-left:4px solid var(--pg-accent); }
      #btn-parents-guide .pg-caret { width:12px; display:inline-block; opacity:.8; }
      #btn-parents-guide .pg-title { font-weight:bold; }
      #btn-parents-guide .pg-head-right { margin-left:auto; display:flex; gap:6px; align-items:center; }
      #btn-parents-guide .pg-cert { font-size:11px; font-weight:700; letter-spacing:.3px; border:1px solid currentColor; border-radius:3px; padding:0 5px; opacity:.85; }
      #btn-parents-guide .pg-overall { font-size:11px; font-weight:700; color:#0e0e0e; border-radius:3px; padding:1px 6px; }
      #btn-parents-guide .pg-src { font-size:10px; font-weight:600; opacity:.55; border:1px solid rgba(255,255,255,.2); border-radius:3px; padding:0 5px; }
      #btn-parents-guide .pg-body { display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:10px; align-items:start; padding:12px; }
      #btn-parents-guide .pg-status { grid-column:1 / -1; padding:6px 2px; opacity:.85; font-size:12px; }
      #btn-parents-guide .pg-error { color:#ff8a80; }
      #btn-parents-guide .pg-retry { cursor:pointer; font:inherit; font-size:11px; padding:3px 10px; border-radius:4px; border:1px solid rgba(255,255,255,.25); background:rgba(255,255,255,.06); color:inherit; justify-self:start; }
      #btn-parents-guide .pg-retry:hover { background:rgba(255,255,255,.14); }
      #btn-parents-guide .pg-cat { min-width:0; box-sizing:border-box; border:1px solid rgba(255,255,255,.08); border-top:3px solid var(--sev); border-radius:5px; background:rgba(255,255,255,.03); overflow:hidden; }
      #btn-parents-guide .pg-cat-head { display:flex; align-items:center; gap:6px; cursor:pointer; padding:7px 9px; user-select:none; }
      #btn-parents-guide .pg-cat-head:hover { background:rgba(255,255,255,.05); }
      #btn-parents-guide .pg-cat-caret { width:11px; opacity:.7; font-size:11px; }
      #btn-parents-guide .pg-cat-icon { font-size:15px; }
      #btn-parents-guide .pg-cat-label { flex:1 1 auto; font-weight:600; font-size:13px; line-height:1.2; }
      #btn-parents-guide .pg-cat-count { font-size:10px; opacity:.55; }
      #btn-parents-guide .pg-sev-badge { font-size:10px; font-weight:700; color:#0e0e0e; background:var(--sev); border-radius:3px; padding:1px 6px; white-space:nowrap; }
      #btn-parents-guide .pg-cat-body { padding:6px 9px 9px; }
      #btn-parents-guide .pg-votebar { height:5px; border-radius:3px; background:rgba(255,255,255,.1); overflow:hidden; margin:2px 0 3px; }
      #btn-parents-guide .pg-votebar-fill { height:100%; }
      #btn-parents-guide .pg-votemeta { font-size:10px; opacity:.6; margin-bottom:5px; }
      #btn-parents-guide .pg-items { list-style:none; margin:0; padding:0; }
      #btn-parents-guide .pg-item { font-size:12px; line-height:1.45; padding:5px 0; border-top:1px solid rgba(255,255,255,.06); }
      #btn-parents-guide .pg-item:first-child { border-top:none; }
      #btn-parents-guide .pg-item a { text-decoration:underline; }
      #btn-parents-guide .pg-noitems { font-size:11px; opacity:.55; padding:2px 0; }
      #btn-parents-guide .pg-more { cursor:pointer; font:inherit; font-size:11px; margin-top:6px; padding:2px 8px; border-radius:4px; border:1px solid rgba(255,255,255,.2); background:rgba(255,255,255,.05); color:inherit; opacity:.85; }
      #btn-parents-guide .pg-more:hover { background:rgba(255,255,255,.13); opacity:1; }
      #btn-parents-guide .pg-spoiler { filter:blur(4px); cursor:pointer; transition:filter .15s; background:rgba(250,111,100,.06); border-radius:3px; }
      #btn-parents-guide .pg-spoiler::after { content:" 🔒 spoiler"; font-size:9px; opacity:.7; }
      #btn-parents-guide .pg-spoiler.revealed { filter:none; background:transparent; }
      #btn-parents-guide .pg-spoiler.revealed::after { content:""; }
      #btn-parents-guide .pg-fulllink { grid-column:1 / -1; margin-top:2px; font-size:11px; text-align:right; }
    `);

    const ttEarly = findImdbId();
    if (ttEarly) fetchGuide(ttEarly, false);
    if (tryInjectPg()) return;
    let done = false;
    const finish = () => { done = true; obs.disconnect(); clearInterval(poll); clearTimeout(stop); };
    const obs = new MutationObserver(() => { if (!done && tryInjectPg()) finish(); });
    obs.observe(document.body, { childList: true, subtree: true });
    const poll = setInterval(() => { if (!done && tryInjectPg()) finish(); }, 800);
    const stop = setTimeout(() => { if (!done) { finish(); LOG('gave up: no IMDb link / target found'); } }, 12000);
  }

  /* =========================================================================
   * FEATURE: Trending Shows (homepage, TMDb trending-TV row)
   * =======================================================================*/
  // Shared hover info card for the homepage row.
  let trTip = null;
  function trEnsureTip() {
    if (trTip) return trTip;
    trTip = document.createElement('div');
    trTip.id = 'snr-tr-tip'; trTip.className = 'snr';
    trTip.innerHTML = '<img class="tip-bg" alt=""><div class="tip-body"><div class="tip-title"></div><div class="tip-meta"></div><div class="tip-ov"></div></div>';
    document.body.appendChild(trTip);
    return trTip;
  }
  function trShowTip(el, d) {
    const tip = trEnsureTip();
    const bg = tip.querySelector('.tip-bg');
    const src = d.backdrop_path ? ('https://image.tmdb.org/t/p/w500' + d.backdrop_path)
             : (d.poster_path ? ('https://image.tmdb.org/t/p/w500' + d.poster_path) : '');
    if (src) { bg.style.display = ''; bg.src = src; } else { bg.style.display = 'none'; }
    tip.querySelector('.tip-title').textContent = d.name || d.original_name || 'Unknown';
    const yr = (d.first_air_date || '').slice(0, 4);
    const rating = d.vote_average ? ('★ ' + Number(d.vote_average).toFixed(1)) : '';
    tip.querySelector('.tip-meta').innerHTML =
      (rating ? '<span class="tip-star">' + rating + '</span>' : '') +
      (yr ? '<span>' + yr + '</span>' : '');
    tip.querySelector('.tip-ov').textContent = d.overview || 'No description available.';
    // Position: prefer below the poster (the row sits near the page top), flip
    // above if there isn't room.
    tip.classList.add('show'); // make it measurable
    const r = el.getBoundingClientRect();
    const tw = tip.offsetWidth || 330, th = tip.offsetHeight || 300;
    let left = r.left + r.width / 2 - tw / 2;
    left = Math.max(10, Math.min(left, window.innerWidth - tw - 10));
    let top = r.bottom + 10;
    if (top + th > window.innerHeight - 10) top = Math.max(10, r.top - th - 10);
    tip.style.left = left + 'px'; tip.style.top = top + 'px';
  }
  function trHideTip() { if (trTip) trTip.classList.remove('show'); }

  function runTrending() {
    if (document.getElementById('snr-trending')) return;
    const key = (getKey('trending') || '').trim();
    if (!key) return;
    const mainColumn = document.querySelector('#content > div.thin > div.main_column') || document.querySelector('.main_column');
    if (!mainColumn) return;

    const listVal = getOpt('trending', TMDB_LIST_DEFAULT);
    const list = TMDB_LISTS.find(l => l.value === listVal) || TMDB_LISTS[0];

    injectCss('snr-trending-style', `
      #snr-trending .snr-tr-grid{ display:flex; flex-wrap:wrap; gap:1.5%; padding:12px; }
      #snr-trending .snr-tr-item{ width:12.7%; margin-bottom:10px; cursor:pointer; }
      #snr-trending .snr-tr-item img{ width:100%; border-radius:6px; display:block; box-shadow:0 3px 10px rgba(0,0,0,.4); transition:transform .12s, box-shadow .12s; }
      #snr-trending .snr-tr-item:hover img{ transform:translateY(-3px); box-shadow:0 8px 22px rgba(0,0,0,.55); }
      #snr-trending .snr-tr-name{ text-align:center; font-size:12px; margin-top:5px; line-height:1.3; color:var(--text-1,#cdd4de); }
      #snr-trending .snr-tr-item:hover .snr-tr-name{ color:var(--accent-bright,#3fc8ff); }
      @media (max-width:900px){ #snr-trending .snr-tr-item{ width:23%; } }
      #snr-tr-tip{ position:fixed; z-index:2147483000; width:330px; background:var(--bg-2,#12151a); border:1px solid var(--line,#232830); border-radius:12px; overflow:hidden; box-shadow:0 20px 55px rgba(0,0,0,.65); opacity:0; pointer-events:none; transition:opacity .12s, transform .12s; transform:translateY(4px); }
      #snr-tr-tip.show{ opacity:1; transform:translateY(0); }
      #snr-tr-tip .tip-bg{ width:100%; height:150px; object-fit:cover; background:var(--bg-3,#181c22); display:block; }
      #snr-tr-tip .tip-body{ padding:12px 14px; }
      #snr-tr-tip .tip-title{ font-weight:700; font-size:14px; color:var(--text,#f4f7fb); line-height:1.3; }
      #snr-tr-tip .tip-meta{ font-size:12px; color:var(--text-2,#9aa4b2); margin:5px 0 8px; display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
      #snr-tr-tip .tip-star{ color:#f4c04e; font-weight:700; }
      #snr-tr-tip .tip-ov{ font-size:12px; color:var(--text-1,#cdd4de); line-height:1.5; max-height:8.4em; overflow:hidden; }
    `);

    const box = document.createElement('div');
    box.className = 'box';
    box.id = 'snr-trending';
    const head = document.createElement('div');
    head.className = 'head';
    head.style.fontWeight = 'bold';
    head.textContent = list.title + ' From TMDb';
    box.appendChild(head);
    const grid = document.createElement('div');
    grid.className = 'snr-tr-grid pad';
    box.appendChild(grid);
    mainColumn.insertBefore(box, mainColumn.firstChild);

    const api = (path) => 'https://api.themoviedb.org/3' + path + (path.indexOf('?') >= 0 ? '&' : '?') + 'api_key=' + encodeURIComponent(key);

    // UK/US shows only. Grab two pages so there are still enough after filtering.
    const isUkUs = d => Array.isArray(d.origin_country) && d.origin_country.some(c => c === 'US' || c === 'GB');
    Promise.all([
      fetch(api(list.path + '?language=en-US&page=1')).then(r => r.json()).catch(() => null),
      fetch(api(list.path + '?language=en-US&page=2')).then(r => r.json()).catch(() => null)
    ])
      .then(pages => {
        const all = pages.filter(Boolean).reduce((a, p) => a.concat((p && p.results) || []), []);
        const seen = {};
        const shows = all
          .filter(d => d && d.poster_path)
          .filter(isUkUs)
          .filter(d => { const k = (d.name || d.original_name || '').toLowerCase(); if (seen[k]) return false; seen[k] = 1; return true; })
          .slice(0, 7);
        shows.forEach(d => {
          const item = document.createElement('div');
          item.className = 'snr-tr-item';
          const img = document.createElement('img');
          img.loading = 'lazy';
          img.src = 'https://image.tmdb.org/t/p/w342' + d.poster_path;
          img.alt = d.name || '';
          const name = document.createElement('div');
          name.className = 'snr-tr-name';
          name.textContent = d.name || d.original_name || '';
          item.appendChild(img);
          item.appendChild(name);
          item.addEventListener('click', () => { window.location.href = 'https://broadcasthe.net/series.php?name=' + encodeURIComponent(d.name || d.original_name || ''); });
          item.addEventListener('mouseenter', () => trShowTip(item, d));
          item.addEventListener('mouseleave', trHideTip);
          grid.appendChild(item);
        });
      })
      .catch((e) => { console.warn('[STMPE-Trending] fetch failed', e); });
  }

  /* =========================================================================
   * FEATURE: Homepage New Series Carousel
   * =======================================================================*/
  function hnscBox() {
    const main = document.querySelector('#content > div.thin > div.main_column') || document.querySelector('.main_column');
    if (!main) return null;
    return [...main.querySelectorAll(':scope > .box, .box')].find(box => {
      const head = box.querySelector(':scope > .head, :scope > .box_head, .head, .box_head');
      return head && /new\s+series\s+in\s+the\s+past\s+30\s+days/i.test(cleanText(head.textContent || ''));
    }) || null;
  }

  function hnscCss() {
    injectCss('stmpe-home-newseries-carousel-style', `
      .stmpe-home-newseries-carousel{ overflow:hidden; }
      .stmpe-home-newseries-carousel .hnsc-source{ display:none !important; }
      .stmpe-home-newseries-carousel>.head{
        display:flex; align-items:center; justify-content:space-between; gap:12px;
      }
      .stmpe-home-newseries-carousel .hnsc-shell{ padding:16px 16px 18px; }
      .stmpe-home-newseries-carousel .hnsc-top{
        display:inline-flex; align-items:center; justify-content:flex-end; gap:8px; margin-left:auto;
      }
      .stmpe-home-newseries-carousel .hnsc-count{
        color:var(--text-3,#7d8794); font-size:11px; font-weight:800; min-width:44px; text-align:center;
      }
      .stmpe-home-newseries-carousel .hnsc-nav{
        display:inline-flex; align-items:center; justify-content:center; width:30px; height:30px; border-radius:9px;
        border:1px solid rgba(63,200,255,.18); background:rgba(255,255,255,.035);
        color:var(--accent-bright,#3fc8ff); font:inherit; font-size:20px; line-height:1; cursor:pointer;
        transition:background .15s,border-color .15s,color .15s,opacity .15s,transform .15s;
      }
      .stmpe-home-newseries-carousel .hnsc-nav:hover:not(:disabled),
      .stmpe-home-newseries-carousel .hnsc-nav:focus-visible{
        border-color:rgba(63,200,255,.46); background:rgba(63,200,255,.10); color:#fff; outline:0;
        transform:translateY(-1px);
      }
      .stmpe-home-newseries-carousel .hnsc-nav:disabled{ opacity:.34; cursor:default; }
      .stmpe-home-newseries-carousel .hnsc-viewport{ overflow:hidden; width:100%; }
      .stmpe-home-newseries-carousel .hnsc-track{
        display:flex; width:100%; transition:transform .28s cubic-bezier(.16,1,.3,1); will-change:transform;
      }
      .stmpe-home-newseries-carousel .hnsc-page{
        flex:0 0 100%; min-width:100%; display:grid; grid-template-columns:repeat(3,minmax(0,1fr));
        grid-template-rows:repeat(2,auto); gap:22px 28px;
      }
      .stmpe-home-newseries-carousel .hnsc-item{ min-width:0; text-align:center; }
      .stmpe-home-newseries-carousel .hnsc-item a:first-of-type{ display:block; line-height:0; }
      .stmpe-home-newseries-carousel .hnsc-item img{
        display:block; width:100% !important; aspect-ratio:5.4/1; height:auto !important; max-width:none !important;
        object-fit:cover; object-position:center; border-radius:9px; border:1px solid var(--line,#232830);
        box-shadow:0 5px 18px rgba(0,0,0,.28); transition:transform .15s ease,box-shadow .15s ease,border-color .15s ease;
      }
      .stmpe-home-newseries-carousel .hnsc-item:hover img{
        transform:translateY(-2px); border-color:rgba(63,200,255,.35); box-shadow:0 11px 26px rgba(0,0,0,.42);
      }
      .stmpe-home-newseries-carousel .hnsc-title{
        display:block; margin-top:7px; color:var(--text,#f4f7fb) !important; text-align:center;
        font-family:var(--fd,inherit); font-size:13px; line-height:1.25; font-weight:750; text-decoration:none !important;
        overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
      }
      .stmpe-home-newseries-carousel .hnsc-title:hover{ color:var(--accent-bright,#3fc8ff) !important; }
      @media (max-width:900px){
        .stmpe-home-newseries-carousel .hnsc-page{ grid-template-columns:repeat(2,minmax(0,1fr)); grid-template-rows:repeat(3,auto); gap:18px; }
      }
      @media (max-width:560px){
        .stmpe-home-newseries-carousel .hnsc-page{ grid-template-columns:1fr; grid-template-rows:none; }
        .stmpe-home-newseries-carousel .hnsc-item:nth-child(n+4){ display:none; }
      }
    `);
  }

  function runHomeNewSeriesCarousel() {
    if (window.__stmpeHomeNewSeriesCarousel) return true;
    const box = hnscBox();
    if (!box) return false;
    const table = box.querySelector('.pad > table, table');
    if (!table || table.dataset.stmpeNewSeriesCarousel === '1') return !!table;
    const cells = [...table.querySelectorAll('td')]
      .filter(cell => cell.querySelector('img') && cell.querySelector('a[href*="series.php"]'));
    if (cells.length < 1) return false;

    window.__stmpeHomeNewSeriesCarousel = true;
    table.dataset.stmpeNewSeriesCarousel = '1';
    table.classList.add('hnsc-source');
    box.classList.add('stmpe-home-newseries-carousel');
    hnscCss();

    const shell = document.createElement('div');
    shell.className = 'hnsc-shell';
    shell.innerHTML =
      '<div class="hnsc-viewport"><div class="hnsc-track"></div></div>';
    const controls = document.createElement('div');
    controls.className = 'hnsc-top';
    controls.innerHTML =
      '<button class="hnsc-nav prev" type="button" title="Previous page" aria-label="Previous page">‹</button>' +
      '<span class="hnsc-count"></span>' +
      '<button class="hnsc-nav next" type="button" title="Next page" aria-label="Next page">›</button>';
    const head = box.querySelector(':scope > .head, :scope > .box_head, .head, .box_head');
    if (head) head.appendChild(controls);

    const track = shell.querySelector('.hnsc-track');
    const pages = [];
    cells.forEach((cell, index) => {
      if (index % 6 === 0) {
        const page = document.createElement('div');
        page.className = 'hnsc-page';
        pages.push(page);
        track.appendChild(page);
      }
      const item = document.createElement('div');
      item.className = 'hnsc-item';
      while (cell.firstChild) item.appendChild(cell.firstChild);
      item.querySelectorAll('br').forEach(br => br.remove());
      const title = [...item.querySelectorAll('a[href*="series.php"]')].find(a => !a.querySelector('img'));
      if (title) title.classList.add('hnsc-title');
      pages[pages.length - 1].appendChild(item);
    });

    let current = 0;
    let autoTimer = null;
    const prev = controls.querySelector('.hnsc-nav.prev');
    const next = controls.querySelector('.hnsc-nav.next');
    const count = controls.querySelector('.hnsc-count');
    const update = () => {
      track.style.transform = 'translateX(-' + (current * 100) + '%)';
      prev.disabled = current <= 0;
      next.disabled = current >= pages.length - 1;
      count.textContent = (current + 1) + ' / ' + pages.length;
    };
    const stopAuto = () => {
      if (autoTimer) window.clearInterval(autoTimer);
      autoTimer = null;
    };
    prev.addEventListener('click', () => { if (current > 0) { current -= 1; update(); } });
    next.addEventListener('click', () => { if (current < pages.length - 1) { current += 1; update(); } });
    ['mouseenter', 'pointerdown', 'click', 'focusin'].forEach(type => {
      box.addEventListener(type, stopAuto, { once: true, capture: type !== 'mouseenter' });
    });
    if (pages.length <= 1) controls.style.display = 'none';
    else {
      autoTimer = window.setInterval(() => {
        if (!document.body.contains(box)) { stopAuto(); return; }
        current = current >= pages.length - 1 ? 0 : current + 1;
        update();
      }, 6000);
    }
    update();

    const pad = table.closest('.pad') || table.parentNode;
    pad.insertBefore(shell, table);
    return true;
  }

  /* =========================================================================
   * FEATURE: Homepage Stats Strip
   * =======================================================================*/
  function homeStatsBox() {
    const main = document.querySelector('#content > div.thin > div.main_column') || document.querySelector('.main_column');
    if (!main) return null;
    return [...main.querySelectorAll(':scope > .box, .box')].find(box => {
      const head = box.querySelector(':scope > .head, :scope > .box_head, .head, .box_head');
      return head && /^Stats$/i.test((head.textContent || '').trim());
    }) || null;
  }

  function homeStatsMetric(raw) {
    const text = String(raw || '').replace(/\s+/g, ' ').trim();
    const idx = text.indexOf(':');
    if (idx < 1) return null;
    const label = text.slice(0, idx).trim();
    const value = text.slice(idx + 1).trim();
    return label && value ? { label, value } : null;
  }

  function homeStatsSectionsFromLines(source) {
    const rawText = (source.innerText || source.textContent || '').replace(/\r/g, '');
    const lines = rawText.split(/\n+/).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const sections = [];
    let current = null;
    lines.forEach(line => {
      if (/^(?:Torrent|Tracker|IRC|Forum)\s+Stats$/i.test(line)) {
        current = { title: line, metrics: [] };
        sections.push(current);
        return;
      }
      const metric = homeStatsMetric(line);
      if (metric) {
        if (!current) {
          current = { title: 'Stats', metrics: [] };
          sections.push(current);
        }
        current.metrics.push(metric);
      }
    });
    return sections.filter(s => s.metrics.length);
  }

  function homeStatsSectionsFromNodes(source) {
    const sections = [];
    let current = null;
    const start = title => {
      current = { title: title || 'Stats', metrics: [] };
      sections.push(current);
    };
    const visit = node => {
      if (!node || node.nodeType !== 1) return;
      const tag = node.tagName;
      if (tag === 'B' || tag === 'STRONG') {
        start((node.textContent || '').replace(/\s+/g, ' ').trim());
        return;
      }
      if (tag === 'LI') {
        const metric = homeStatsMetric(node.textContent);
        if (metric) {
          if (!current) start('Stats');
          current.metrics.push(metric);
        }
        return;
      }
      [...node.childNodes].forEach(visit);
    };
    [...source.childNodes].forEach(visit);
    return sections.filter(s => s.metrics.length);
  }

  function runHomeStatsStrip() {
    const box = homeStatsBox();
    if (!box || box.dataset.stmpeStatsStrip === '1') return !!box;
    const source = box.querySelector(':scope > ul.stats, ul.stats');
    if (!source) return false;
    const sections = homeStatsSectionsFromLines(source);
    const parsed = sections.length ? sections : homeStatsSectionsFromNodes(source);
    if (!parsed.length) return true;

    const wrap = document.createElement('div');
    wrap.className = 'stmpe-home-stats';
    parsed.slice(0, 4).forEach(section => {
      const card = document.createElement('section');
      card.className = 'stmpe-home-stats__section';
      card.innerHTML =
        '<div class="stmpe-home-stats__title">' + escapeHtml(section.title) + '</div>' +
        '<div class="stmpe-home-stats__metrics">' +
          section.metrics.map(metric =>
            '<div class="stmpe-home-stats__metric">' +
              '<span class="stmpe-home-stats__label">' + escapeHtml(metric.label) + '</span>' +
              '<span class="stmpe-home-stats__value">' + escapeHtml(metric.value) + '</span>' +
            '</div>'
          ).join('') +
        '</div>';
      wrap.appendChild(card);
    });

    box.classList.add('stmpe-home-stats-box');
    box.dataset.stmpeStatsStrip = '1';
    source.replaceWith(wrap);
    return true;
  }

  /* =========================================================================
   * FEATURE: Homepage Latest Uploads
   * =======================================================================*/
  const HOME_UPLOAD_COUNT = 5;

  function hluCss() {
    injectCss('stmpe-home-uploads-style', `
      .stmpe-home-uploads-box{ overflow:visible !important; }
      .stmpe-home-uploads-box>.head{ border-radius:var(--radius) var(--radius) 0 0; overflow:hidden; }
      .stmpe-home-uploads-box #last_uploads{ padding:10px 12px 12px; }
      .stmpe-home-uploads-box .stats,
      .stmpe-home-uploads-box .nobullet{ margin:0 !important; padding:0 !important; list-style:none !important; }
      .stmpe-home-uploads-box .extrapad{ display:none !important; }
      .hlu-list{ display:grid; gap:0; margin:0; padding:0; list-style:none; }
      .hlu-item{
        position:relative; display:grid; grid-template-columns:22px minmax(0,1fr); gap:9px; align-items:center;
        min-height:38px; padding:7px 2px; border:0;
        border-radius:0; background:transparent; text-decoration:none !important;
        color:var(--text-1,#cdd4de) !important; z-index:0;
        transition:color .16s ease,transform .16s ease;
      }
      .hlu-item + .hlu-item{ border-top:1px solid rgba(255,255,255,.055); }
      .hlu-item:hover,
      .hlu-item:focus-visible{
        background:transparent; transform:translateY(-1px); color:#fff !important; outline:0; z-index:100;
      }
      .hlu-rank{
        display:inline-flex; align-items:flex-start; justify-content:center; width:22px; min-height:22px; padding-top:1px;
        color:var(--accent-bright,#3fc8ff); font-size:12px; font-weight:900; line-height:1.25;
      }
      .hlu-main{ display:block; min-width:0; }
      .hlu-title{
        display:block; color:var(--text,#f4f7fb); font-size:12.5px; font-weight:850; line-height:1.25;
        white-space:normal; overflow:visible; overflow-wrap:anywhere;
      }
      .hlu-meta{
        display:block; margin-top:3px; color:var(--text-2,#8b94a1); font-size:10.5px; font-weight:650; line-height:1.25;
        white-space:normal; overflow:visible; overflow-wrap:anywhere;
      }
      .hlu-item:hover .hlu-meta,
      .hlu-item:focus-visible .hlu-meta{ color:var(--text-1,#cdd4de); }
      .hlu-popover{
        position:absolute; left:33px; top:calc(100% - 2px); width:430px; max-width:calc(100vw - 56px);
        z-index:70; display:block; padding:12px 13px; border:1px solid rgba(63,200,255,.22);
        border-radius:8px; background:var(--bg-2,#12151a) !important;
        box-shadow:0 18px 44px rgba(0,0,0,.46),0 0 0 1px rgba(255,255,255,.025) inset;
        opacity:0; visibility:hidden; pointer-events:none; transform:translateY(-3px);
        transition:opacity .14s ease,transform .14s ease,visibility 0s linear .14s;
      }
      .hlu-item:hover .hlu-popover,
      .hlu-item:focus-visible .hlu-popover{
        opacity:1; visibility:visible; transform:translateY(0);
        transition:opacity .14s ease .08s,transform .14s ease .08s,visibility 0s linear .08s;
      }
      .hlu-pop-title{ display:block; color:#fff; font-size:13px; font-weight:900; line-height:1.25; margin-bottom:9px; }
      .hlu-pop-body{ display:grid; grid-template-columns:82px minmax(0,1fr); gap:13px; align-items:start; }
      .hlu-pop-body.no-art{ grid-template-columns:minmax(0,1fr); }
      .hlu-pop-art{
        display:block; width:82px; aspect-ratio:2/3; border-radius:7px; overflow:hidden; background:rgba(255,255,255,.04);
        border:1px solid rgba(255,255,255,.08); box-shadow:0 10px 24px rgba(0,0,0,.28);
      }
      .hlu-pop-art img{ display:block; width:100%; height:100%; object-fit:cover; object-position:center top; }
      .hlu-pop-grid{ display:grid; gap:6px; }
      .hlu-pop-row{ display:grid; grid-template-columns:70px minmax(0,1fr); gap:8px; align-items:start; color:var(--text-1,#cdd4de); font-size:11px; line-height:1.35; }
      .hlu-pop-row b{ color:var(--text-3,#7d8794); font-size:10px; font-weight:900; text-transform:uppercase; }
      .hlu-pop-row span{ min-width:0; overflow-wrap:anywhere; }
      .hlu-loading{ color:var(--text-2,#8b94a1); font-size:12px; padding:4px 1px; }
      @media (max-width:760px){
        .hlu-popover{ left:0; width:min(430px,calc(100vw - 38px)); }
        .hlu-pop-body{ grid-template-columns:70px minmax(0,1fr); gap:10px; }
        .hlu-pop-art{ width:70px; }
      }
    `);
  }

  function hluClean(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  }

  function hluUrl(raw) {
    try { return new URL(raw || '', location.href); }
    catch (e) { return null; }
  }

  function hluIdFromHref(href) {
    const url = hluUrl(href);
    return url ? (url.searchParams.get('id') || '') : '';
  }

  function hluSeriesFromTitle(title) {
    return hluClean(String(title || '').split(/\s+-\s+/)[0] || title);
  }

  function hluDetailFromTitle(title, series) {
    const cleanTitle = hluClean(title);
    const cleanSeries = hluClean(series);
    const prefix = cleanSeries + ' - ';
    if (cleanSeries && cleanTitle.toLowerCase().indexOf(prefix.toLowerCase()) === 0) {
      return hluClean(cleanTitle.slice(prefix.length));
    }
    const match = cleanTitle.match(/\s+-\s+(.+)$/);
    return hluClean(match ? match[1] : '');
  }

  function hluImageHost(src) {
    const url = hluUrl(src);
    if (!url) return '';
    return url.hostname.replace(/^www\./i, '');
  }

  function hluParseItem(root, slot) {
    const scope = root && root.querySelector ? (root.querySelector('#last_uploads') || root) : null;
    if (!scope) return null;
    const torrentA = scope.querySelector('a[href*="torrents.php"]');
    if (!torrentA) return null;
    const seriesA = scope.querySelector('a[href*="series.php"]');
    const img = scope.querySelector('img');
    const torrentHref = torrentA.getAttribute('href') || torrentA.href || '';
    const seriesHref = seriesA ? (seriesA.getAttribute('href') || seriesA.href || '') : '';
    const title = hluClean(torrentA.textContent);
    const imageTitle = img ? hluClean(img.getAttribute('title') || img.getAttribute('alt') || '') : '';
    const series = imageTitle || hluSeriesFromTitle(title);
    const detail = hluDetailFromTitle(title, series);
    if (!title || !torrentHref) return null;
    const image = img ? (img.getAttribute('src') || img.src || '') : '';
    return {
      slot,
      title,
      series,
      detail,
      torrentHref,
      seriesHref,
      torrentId: hluIdFromHref(torrentHref),
      seriesId: hluIdFromHref(seriesHref),
      image,
      imageHost: hluImageHost(image)
    };
  }

  function hluParseHtml(html, slot) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    return hluParseItem(doc, slot);
  }

  function hluFetchUrl(slot) {
    return new URL('/index.php?action=get_uploads&id=' + encodeURIComponent(slot), location.origin).href;
  }

  function hluMeta(item) {
    return [item.series, item.detail, item.torrentId ? 'Torrent #' + item.torrentId : '']
      .map(hluClean).filter(Boolean).join(' · ');
  }

  function hluPopover(item) {
    const rows = [
      ['Series', item.series],
      ['Release', item.title],
      ['Detail', item.detail],
      ['Torrent', item.torrentId ? '#' + item.torrentId : item.torrentHref],
      ['Series ID', item.seriesId ? '#' + item.seriesId : ''],
      ['Artwork', item.imageHost || item.image]
    ].filter(row => hluClean(row[1]));
    const art = item.image
      ? '<span class="hlu-pop-art"><img src="' + escapeAttr(item.image) + '" alt="' + escapeAttr(item.series || item.title) + '" loading="lazy" decoding="async"></span>'
      : '';
    return '<span class="hlu-popover" aria-hidden="true">' +
      '<span class="hlu-pop-title">' + escapeHtml(item.title) + '</span>' +
      '<span class="hlu-pop-body' + (art ? '' : ' no-art') + '">' +
        art +
        '<span class="hlu-pop-grid">' +
          rows.map(row =>
            '<span class="hlu-pop-row"><b>' + escapeHtml(row[0]) + '</b><span>' + escapeHtml(row[1]) + '</span></span>'
          ).join('') +
        '</span>' +
      '</span>' +
    '</span>';
  }

  function hluRender(box, items, loading) {
    if (!box || !items.length) return;
    const head = box.querySelector(':scope > .head strong, :scope > .head b, :scope > .head');
    if (head) head.textContent = 'Latest Uploads';
    let body = box.querySelector('#last_uploads');
    if (!body) {
      body = document.createElement('div');
      body.id = 'last_uploads';
      const headNode = box.querySelector(':scope > .head');
      if (headNode && headNode.nextSibling) box.insertBefore(body, headNode.nextSibling);
      else box.appendChild(body);
    }
    body.innerHTML =
      '<div class="hlu-list">' +
        items.map(item =>
          '<a class="hlu-item" href="' + escapeAttr(item.torrentHref) + '">' +
            '<span class="hlu-rank">' + escapeHtml(item.slot || '') + '</span>' +
            '<span class="hlu-main">' +
              '<span class="hlu-title">' + escapeHtml(item.title) + '</span>' +
              '<span class="hlu-meta">' + escapeHtml(hluMeta(item)) + '</span>' +
            '</span>' +
            hluPopover(item) +
          '</a>'
        ).join('') +
      '</div>' +
      (loading ? '<div class="hlu-loading">Loading the rest...</div>' : '');
    const extra = box.querySelector(':scope > .extrapad');
    if (extra) extra.remove();
  }

  function homeUploadsBox() {
    const sidebar = document.querySelector('#content > div.thin > div.sidebar') || document.querySelector('.sidebar');
    if (!sidebar) return null;
    return [...sidebar.querySelectorAll(':scope > .box, .box')]
      .find(b => /(?:last\s*5|latest|recent)\s+uploads/i.test(((b.querySelector(':scope > .head, .head') || {}).textContent || '').trim()));
  }

  function runHomeLatestUploads() {
    const box = homeUploadsBox();
    if (!box || box.dataset.stmpeLatestUploads === '1') return !!box;
    box.dataset.stmpeLatestUploads = '1';
    box.classList.add('stmpe-home-uploads-box');
    hluCss();

    const current = hluParseItem(box, 1);
    if (current) hluRender(box, [current], true);
    else {
      const body = box.querySelector('#last_uploads');
      if (body) body.innerHTML = '<div class="hlu-loading">Loading latest uploads...</div>';
    }

    Promise.all([...Array(HOME_UPLOAD_COUNT)].map((_, i) => {
      const slot = i + 1;
      return gmGet(hluFetchUrl(slot)).then(html => hluParseHtml(html, slot)).catch(() => null);
    })).then(rows => {
      const seen = new Set();
      const items = rows.filter(Boolean).filter(item => {
        const key = item.torrentHref || item.title;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (items.length) hluRender(box, items, false);
      else if (current) hluRender(box, [current], false);
    }).catch(() => {
      if (current) hluRender(box, [current], false);
    });

    return true;
  }

  /* =========================================================================
   * FEATURE: Torrent Detail MediaInfo Summary
   * =======================================================================*/
  function ttCss() {
    injectCss('stmpe-torrent-touchups-style', `
      tr[id^="torrent_"].stmpe-tt-row>td{ overflow:visible; }
      table.torrent_table tr.stmpe-tt-trigger>td{
        cursor:pointer; transition:background .16s ease,color .16s ease,border-color .16s ease;
      }
      table.torrent_table tr.stmpe-tt-trigger:hover>td,
      table.torrent_table tr.stmpe-tt-trigger:focus-within>td{
        background:linear-gradient(90deg,rgba(63,200,255,.075),rgba(255,255,255,.012));
      }
      table.torrent_table tr.stmpe-tt-trigger.is-open>td{
        color:var(--text,#f4f7fb); border-bottom-color:rgba(63,200,255,.16);
      }
      table.torrent_table tr.stmpe-tt-trigger>td:first-child{
        color:var(--text-1,#cdd4de); font-weight:650;
      }
      table.torrent_table tr.stmpe-tt-trigger.is-open>td:first-child{
        color:var(--accent-bright,#3fc8ff);
      }
      tr[id^="torrent_"].stmpe-tt-row{ display:table-row !important; }
      tr[id^="torrent_"].stmpe-tt-row>td{
        padding:0 !important; border-bottom:0 !important; background:rgba(255,255,255,.008);
      }
      .stmpe-tt-panel{
        max-height:0; opacity:0; overflow:hidden; padding:0 20px;
        transition:max-height .34s cubic-bezier(.16,1,.3,1),opacity .22s ease,padding .22s ease;
      }
      tr[id^="torrent_"].stmpe-tt-row.stmpe-tt-open .stmpe-tt-panel{
        opacity:1; padding:12px 20px 28px;
      }
      tr[id^="torrent_"].stmpe-tt-row.stmpe-tt-open .stmpe-tt-panel::after{
        content:""; display:block; height:10px; border-bottom:1px solid rgba(63,200,255,.12);
      }
      .stmpe-tt-summary{
        margin:10px 0 12px; border:1px solid rgba(63,200,255,.16); border-radius:12px;
        background:linear-gradient(180deg,rgba(18,22,28,.96),rgba(10,13,18,.96));
        box-shadow:0 18px 44px rgba(0,0,0,.26),0 0 0 1px rgba(255,255,255,.025) inset;
        overflow:hidden; color:var(--text-1,#cdd4de);
      }
      .stmpe-tt-top{
        display:flex; align-items:flex-start; justify-content:space-between; gap:16px;
        padding:14px 16px 12px; border-bottom:1px solid rgba(255,255,255,.07);
        background:linear-gradient(180deg,rgba(255,255,255,.035),rgba(255,255,255,.01));
      }
      .stmpe-tt-title{ margin:0; color:var(--text,#f4f7fb); font-family:var(--fd,inherit); font-size:15px; font-weight:850; line-height:1.25; }
      .stmpe-tt-sub{ display:block; margin-top:3px; color:var(--text-3,#7d8794); font-size:11px; font-weight:650; }
      .stmpe-tt-pills{ display:flex; flex-wrap:wrap; justify-content:flex-end; gap:6px; max-width:58%; }
      .stmpe-tt-pill{
        display:inline-flex; align-items:center; min-height:24px; padding:4px 8px; border-radius:999px;
        border:1px solid rgba(63,200,255,.16); background:rgba(63,200,255,.08);
        color:var(--text,#f4f7fb); font-size:11px; font-weight:800; line-height:1.1; white-space:nowrap;
      }
      .stmpe-tt-body{ display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:10px; padding:12px; }
      .stmpe-tt-card{
        min-width:0; border:1px solid rgba(255,255,255,.07); border-radius:10px;
        background:rgba(255,255,255,.025); overflow:hidden;
      }
      .stmpe-tt-card h4{
        margin:0; padding:9px 11px; border-bottom:1px solid rgba(255,255,255,.06);
        color:var(--accent-bright,#3fc8ff); font-family:var(--fd,inherit); font-size:12px; font-weight:900;
      }
      .stmpe-tt-fields{ display:grid; gap:1px; padding:8px 10px 10px; }
      .stmpe-tt-field{ display:grid; grid-template-columns:88px minmax(0,1fr); gap:8px; padding:4px 0; line-height:1.35; }
      .stmpe-tt-key{ color:var(--text-3,#7d8794); font-size:10.5px; font-weight:900; text-transform:uppercase; }
      .stmpe-tt-val{ color:var(--text-1,#cdd4de); font-size:12px; font-weight:650; overflow-wrap:anywhere; }
      .stmpe-tt-lang-strip{
        margin:0 12px 12px; padding:9px 12px; border:1px solid rgba(63,200,255,.14); border-radius:10px;
        background:linear-gradient(180deg,rgba(255,255,255,.026),rgba(255,255,255,.012));
        box-shadow:inset 0 1px 0 rgba(255,255,255,.025);
      }
      .stmpe-tt-lang-flags{ display:flex; flex-wrap:wrap; align-items:center; justify-content:center; gap:7px; }
      .stmpe-tt-flag{
        display:inline-flex; align-items:center; justify-content:center; width:26px; height:22px; border-radius:6px;
        border:1px solid rgba(255,255,255,.09); background:rgba(7,10,14,.46); color:var(--text,#f4f7fb);
        font-size:15px; line-height:1; box-shadow:0 0 12px rgba(63,200,255,.10),inset 0 1px 0 rgba(255,255,255,.05);
      }
      .stmpe-tt-flag.is-code{ font-size:10px; font-weight:900; letter-spacing:0; text-transform:uppercase; color:var(--accent-bright,#3fc8ff); }
      .stmpe-tt-toggle{
        display:flex; align-items:center; justify-content:space-between; gap:12px; width:100%;
        margin:10px 0 12px; padding:10px 12px; border:1px solid rgba(63,200,255,.18); border-radius:10px;
        background:rgba(63,200,255,.055); color:var(--text,#f4f7fb); font:inherit; font-size:12.5px; font-weight:850;
        cursor:pointer; text-align:left; transition:background .15s ease,border-color .15s ease,color .15s ease;
      }
      .stmpe-tt-toggle:hover,
      .stmpe-tt-toggle:focus-visible{ border-color:rgba(63,200,255,.42); background:rgba(63,200,255,.10); outline:0; }
      .stmpe-tt-toggle small{ color:var(--text-3,#7d8794); font-size:10.5px; font-weight:750; }
      .stmpe-tt-file-table.is-collapsed{ display:none !important; }
      .stmpe-tt-raw{
        margin:10px 0 0; border:1px solid rgba(255,255,255,.075); border-radius:10px;
        background:rgba(255,255,255,.018); overflow:hidden;
      }
      .stmpe-tt-raw>summary{
        padding:10px 12px; cursor:pointer; color:var(--text,#f4f7fb); font-size:12.5px; font-weight:850;
        background:rgba(255,255,255,.025); border-bottom:1px solid transparent;
      }
      .stmpe-tt-raw[open]>summary{ border-bottom-color:rgba(255,255,255,.06); }
      .stmpe-tt-raw>blockquote{
        margin:0 !important; border:0 !important; border-radius:0 !important;
        background:transparent !important; max-height:520px; overflow:auto; font-size:11.5px; line-height:1.42;
      }
      @media (max-width:900px){
        .stmpe-tt-top{ display:block; }
        .stmpe-tt-pills{ justify-content:flex-start; max-width:none; margin-top:10px; }
        .stmpe-tt-body{ grid-template-columns:1fr; }
      }
    `);
  }

  function ttClean(s) {
    return String(s == null ? '' : s).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function ttSectionType(name) {
    const clean = ttClean(name)
      .replace(/:$/i, '')
      .replace(/\s+\d+\s+of\s+\d+$/i, '')
      .replace(/\s+#?\d+$/i, '');
    if (/^general$/i.test(clean)) return 'general';
    if (/^video$/i.test(clean)) return 'video';
    if (/^audio$/i.test(clean)) return 'audio';
    if (/^text$/i.test(clean)) return 'text';
    return '';
  }

  function ttParseMediaInfo(text) {
    const lines = String(text || '').replace(/\r/g, '').split('\n').map(line => line.trim()).filter(Boolean);
    const sections = [];
    let current = null;

    lines.forEach(line => {
      const type = ttSectionType(line);
      if (type) {
        current = { type, title: ttClean(line), fields: {} };
        sections.push(current);
        return;
      }
      if (!current) return;
      const match = line.match(/^([^:]+?)\s*:\s*(.*)$/);
      if (!match) return;
      const key = ttClean(match[1]);
      const val = ttClean(match[2]);
      if (key && val && !current.fields[key]) current.fields[key] = val;
    });

    const first = type => sections.find(section => section.type === type);
    const all = type => sections.filter(section => section.type === type);
    const data = {
      general: first('general'),
      video: first('video'),
      audio: first('audio'),
      audioCount: all('audio').length,
      subtitles: all('text'),
      subtitleCount: all('text').length,
      sections
    };
    data.usable = sections.some(section => Object.keys(section.fields).length);
    return data;
  }

  function ttField(section, names) {
    if (!section || !section.fields) return '';
    for (const name of names) {
      if (section.fields[name]) return section.fields[name];
      const found = Object.keys(section.fields).find(key => key.toLowerCase() === String(name).toLowerCase());
      if (found) return section.fields[found];
    }
    return '';
  }

  function ttResolution(video) {
    const res = ttField(video, ['Resolution']);
    if (res) return res;
    const w = ttField(video, ['Width']).replace(/[^\d]/g, '');
    const h = ttField(video, ['Height']).replace(/[^\d]/g, '');
    return (w && h) ? (w + 'x' + h) : '';
  }

  function ttFirstPresent(values) {
    return values.map(ttClean).find(Boolean) || '';
  }

  function ttUnique(values) {
    const seen = new Set();
    return values.map(ttClean).filter(Boolean).filter(value => {
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function ttJoinLimited(values, limit) {
    const uniq = ttUnique(values);
    const shown = uniq.slice(0, limit);
    return shown.join(', ') + (uniq.length > shown.length ? ' +' + (uniq.length - shown.length) + ' more' : '');
  }

  function ttLanguageLabel(lang) {
    return ttClean(lang).replace(/\s*\((GB|US|ES|UK|BR|CA|AU|Latin America)\)\s*$/i, match => ' ' + match.trim());
  }

  function ttSubtitleLanguages(data) {
    return ttUnique(((data && data.subtitles) || []).map(section => ttField(section, ['Language']))).map(ttLanguageLabel);
  }

  function ttCountryFlag(code) {
    const cc = ttClean(code).toUpperCase();
    if (!/^[A-Z]{2}$/.test(cc)) return '';
    return String.fromCodePoint(...[...cc].map(char => 0x1F1E6 + char.charCodeAt(0) - 65));
  }

  function ttLanguageCountry(lang) {
    const lower = ttClean(lang).toLowerCase();
    if (!lower) return '';
    if (/\bgb\b|\buk\b|british/i.test(lower)) return 'GB';
    if (/\bus\b|united states|america/i.test(lower)) return 'US';
    if (/latin america/i.test(lower)) return 'MX';
    if (/\bes\b|spain/i.test(lower)) return 'ES';
    if (/\bbr\b|brazil/i.test(lower)) return 'BR';
    if (/\bca\b|canada/i.test(lower)) return 'CA';
    if (/\bau\b|australia/i.test(lower)) return 'AU';
    const base = lower.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
    const map = {
      afrikaans: 'ZA', albanian: 'AL', arabic: 'SA', armenian: 'AM', basque: 'ES', bengali: 'BD',
      bosnian: 'BA', bulgarian: 'BG', catalan: 'ES', chinese: 'CN', croatian: 'HR', czech: 'CZ',
      danish: 'DK', dutch: 'NL', english: 'US', estonian: 'EE', finnish: 'FI', french: 'FR',
      galician: 'ES', georgian: 'GE', german: 'DE', greek: 'GR', hebrew: 'IL', hindi: 'IN',
      hungarian: 'HU', icelandic: 'IS', indonesian: 'ID', italian: 'IT', japanese: 'JP',
      kannada: 'IN', korean: 'KR', latvian: 'LV', lithuanian: 'LT', malay: 'MY', malayalam: 'IN',
      norwegian: 'NO', persian: 'IR', polish: 'PL', portuguese: 'PT', romanian: 'RO', russian: 'RU',
      serbian: 'RS', slovak: 'SK', slovenian: 'SI', spanish: 'ES', swedish: 'SE', tamil: 'IN',
      telugu: 'IN', thai: 'TH', turkish: 'TR', ukrainian: 'UA', urdu: 'PK', vietnamese: 'VN'
    };
    return map[base] || '';
  }

  function ttSubtitleFlagStrip(data) {
    const languages = ttSubtitleLanguages(data);
    if (!languages.length) return '';
    const flags = languages.map(lang => {
      const country = ttLanguageCountry(lang);
      const flag = ttCountryFlag(country);
      const fallback = ttClean(lang).slice(0, 2).toUpperCase();
      return '<span class="stmpe-tt-flag' + (flag ? '' : ' is-code') + '" title="' + escapeAttr(lang) + '" aria-label="' + escapeAttr(lang) + '">' + escapeHtml(flag || fallback) + '</span>';
    }).join('');
    return '<div class="stmpe-tt-lang-strip"><div class="stmpe-tt-lang-flags">' + flags + '</div></div>';
  }

  function ttDiscParts(value) {
    return String(value || '').split('/').map(ttClean).filter(Boolean);
  }

  function ttDiscVideoFields(value) {
    const parts = ttDiscParts(value);
    const fields = {};
    if (parts[0]) fields.Format = parts[0];
    const resolution = parts.find(part => /\b(?:\d{3,4}[pi]|\d{3,4}x\d{3,4})\b/i.test(part));
    const frameRate = parts.find(part => /\bfps\b/i.test(part));
    const aspect = parts.find(part => /^\d+(?:[.,]\d+)?:\d+(?:[.,]\d+)?$/i.test(part));
    const profile = parts.find(part => /\bprofile\b/i.test(part));
    const bitRate = parts.find(part => /\b(?:kbps|mbps|gbps|b\/s)\b/i.test(part) && !/\bfps\b/i.test(part));
    if (resolution) fields.Resolution = resolution.replace(/\s+/g, '');
    if (frameRate) fields['Frame rate'] = frameRate;
    if (aspect) fields['Display aspect ratio'] = aspect;
    if (profile) fields['Format profile'] = profile;
    if (bitRate) fields['Bit rate'] = bitRate;
    return fields;
  }

  function ttDiscAudioFields(value) {
    const parts = ttDiscParts(value);
    const fields = {};
    if (parts[0]) fields.Language = parts[0];
    if (parts[1]) fields.Format = parts[1];
    const channels = parts.find(part => /\b\d+(?:\.\d+)?\b/.test(part) && !/\b(?:khz|kbps|mbps|bit|fps|dn)\b/i.test(part));
    const sampling = parts.find(part => /\bkhz\b/i.test(part));
    const bitRate = parts.find(part => /\b(?:kbps|mbps|gbps|b\/s)\b/i.test(part));
    if (channels) fields['Channel(s)'] = channels + (/channels?/i.test(channels) ? '' : ' channels');
    if (sampling) fields['Sampling rate'] = sampling;
    if (bitRate) fields['Bit rate'] = bitRate;
    return fields;
  }

  function ttDiscSubtitleFields(value) {
    const parts = ttDiscParts(value);
    const fields = {};
    if (parts[0]) fields.Language = parts[0];
    if (parts[1]) fields['Bit rate'] = parts[1];
    return fields;
  }

  function ttParseDiscInfo(text) {
    const lines = String(text || '').replace(/\r/g, '').split('\n').map(line => line.trim()).filter(Boolean);
    const general = { type: 'general', title: 'Disc Info', fields: { Format: 'Blu-ray Disc' } };
    const sections = [general];
    let discTitle = '';

    lines.forEach(line => {
      if (/^disc\s+\d+\s+info$/i.test(line) || /^disc\s+info$/i.test(line)) return;
      const match = line.match(/^([^:]+?)\s*:\s*(.*)$/);
      if (!match) return;
      const key = ttClean(match[1]);
      const val = ttClean(match[2]);
      if (!key || !val) return;

      if (/^video$/i.test(key)) {
        const section = { type: 'video', title: 'Video', fields: ttDiscVideoFields(val) };
        if (Object.keys(section.fields).length) sections.push(section);
      } else if (/^audio$/i.test(key)) {
        const section = { type: 'audio', title: 'Audio', fields: ttDiscAudioFields(val) };
        if (Object.keys(section.fields).length) sections.push(section);
      } else if (/^subtitle$/i.test(key)) {
        const section = { type: 'text', title: 'Subtitle', fields: ttDiscSubtitleFields(val) };
        if (Object.keys(section.fields).length) sections.push(section);
      } else if (/^disc title$/i.test(key) && !discTitle) {
        discTitle = val;
        general.fields.Title = val;
      } else if (/^size$/i.test(key) && !general.fields['File size']) {
        general.fields['File size'] = val;
      } else if (/^disc size$/i.test(key) && !general.fields['Disc size']) {
        general.fields['Disc size'] = val;
      } else if (/^length$/i.test(key) && !general.fields.Duration) {
        general.fields.Duration = val;
      } else if (/^total bitrate$/i.test(key) && !general.fields['Overall bit rate']) {
        general.fields['Overall bit rate'] = val;
      }
    });

    if (!general.fields['File size'] && general.fields['Disc size']) general.fields['File size'] = general.fields['Disc size'];
    const first = type => sections.find(section => section.type === type);
    const all = type => sections.filter(section => section.type === type);
    const data = {
      general,
      video: first('video'),
      audio: first('audio'),
      audioCount: all('audio').length,
      subtitles: all('text'),
      subtitleCount: all('text').length,
      sections,
      isDiscInfo: true
    };
    data.usable = sections.length > 1 || Object.keys(general.fields).length > 1;
    return data;
  }

  function ttSubtitleName(section, index) {
    const lang = ttField(section, ['Language']);
    const title = ttField(section, ['Title']);
    const forced = /^yes$/i.test(ttField(section, ['Forced']));
    const hearing = /sdh|hearing impaired|cc/i.test(title) ? 'SDH' : '';
    let cleanTitle = title.replace(/\b(SDH|CC|Hearing impaired)\b/ig, '').replace(/[\[\]()]+/g, ' ').trim();
    if (lang) {
      const norm = value => ttClean(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
      const langBase = ttClean(lang.replace(/\s*\([^)]*\)\s*/g, ' '));
      const langNorm = norm(lang);
      const baseNorm = norm(langBase);
      const titleNorm = norm(cleanTitle);
      if (titleNorm && (titleNorm === langNorm || langNorm.startsWith(titleNorm))) cleanTitle = '';
      else if (titleNorm && titleNorm.startsWith(langNorm)) cleanTitle = cleanTitle.replace(new RegExp('^' + lang.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b[\\s:-]*', 'i'), '').trim();
      else if (baseNorm && titleNorm && titleNorm.startsWith(baseNorm)) cleanTitle = cleanTitle.replace(new RegExp('^' + langBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b[\\s:-]*', 'i'), '').trim();
    }
    const parts = [
      lang || ('Track ' + (index + 1)),
      cleanTitle && (!lang || cleanTitle.toLowerCase() !== lang.toLowerCase()) ? cleanTitle : '',
      hearing,
      forced ? 'Forced' : ''
    ].filter(Boolean);
    return parts.join(' - ');
  }

  function ttSubtitleSummary(data) {
    const tracks = (data && data.subtitles) || [];
    if (!tracks.length) return null;
    const forcedCount = tracks.filter(section => /^yes$/i.test(ttField(section, ['Forced']))).length;
    return {
      count: tracks.length,
      countLabel: tracks.length + ' subtitle track' + (tracks.length === 1 ? '' : 's'),
      languages: ttJoinLimited(tracks.map(section => ttField(section, ['Language'])), 5),
      formats: ttJoinLimited(tracks.map(section => ttFirstPresent([ttField(section, ['Format']), ttField(section, ['Codec ID'])])), 4),
      tracks: ttJoinLimited(tracks.map((section, index) => ttSubtitleName(section, index)), 6),
      forced: forcedCount ? forcedCount + ' forced' : ''
    };
  }

  function ttSectionHtml(title, rows) {
    const body = rows.filter(row => ttClean(row.value)).map(row =>
      '<div class="stmpe-tt-field">' +
        '<span class="stmpe-tt-key">' + escapeHtml(row.label) + '</span>' +
        '<span class="stmpe-tt-val">' + escapeHtml(row.value) + '</span>' +
      '</div>'
    ).join('');
    if (!body) return '';
    return '<section class="stmpe-tt-card"><h4>' + escapeHtml(title) + '</h4><div class="stmpe-tt-fields">' + body + '</div></section>';
  }

  function ttSummaryHtml(data, fileCount) {
    const g = data.general;
    const v = data.video;
    const a = data.audio;
    const container = ttField(g, ['Format']);
    const duration = ttField(g, ['Duration']);
    const size = ttField(g, ['File size']);
    const videoCodec = ttFirstPresent([ttField(v, ['Format']), ttField(v, ['Codec ID'])]);
    const audioCodec = ttFirstPresent([ttField(a, ['Format']), ttField(a, ['Format/Info'])]);
    const resolution = ttResolution(v);
    const subs = ttSubtitleSummary(data);
    const flagStrip = subs ? ttSubtitleFlagStrip(data) : '';
    const pills = [container, duration, size, resolution, videoCodec, audioCodec, subs && subs.countLabel]
      .filter(Boolean)
      .slice(0, 7)
      .map(value => '<span class="stmpe-tt-pill">' + escapeHtml(value) + '</span>')
      .join('');
    const sections = [
      ttSectionHtml('General', [
        { label: 'Container', value: container },
        { label: 'Title', value: ttField(g, ['Title']) },
        { label: 'Runtime', value: duration },
        { label: 'Size', value: size },
        { label: 'Overall rate', value: ttField(g, ['Overall bit rate']) },
        { label: 'Frame rate', value: ttField(g, ['Frame rate']) }
      ]),
      ttSectionHtml('Video', [
        { label: 'Codec', value: videoCodec },
        { label: 'Profile', value: ttField(v, ['Format profile']) },
        { label: 'Resolution', value: resolution },
        { label: 'Aspect', value: ttField(v, ['Display aspect ratio']) },
        { label: 'Frame rate', value: ttField(v, ['Frame rate']) },
        { label: 'Bit rate', value: ttField(v, ['Bit rate']) },
        { label: 'Bit depth', value: ttField(v, ['Bit depth']) },
        { label: 'Scan', value: ttField(v, ['Scan type']) }
      ]),
      ttSectionHtml(data.audioCount > 1 ? 'Audio 1 of ' + data.audioCount : 'Audio', [
        { label: 'Codec', value: audioCodec },
        { label: 'Channels', value: ttField(a, ['Channel(s)', 'Channel count']) },
        { label: 'Language', value: ttField(a, ['Language']) },
        { label: 'Bit rate', value: ttField(a, ['Bit rate']) },
        { label: 'Sampling', value: ttField(a, ['Sampling rate']) },
        { label: 'Mode', value: ttField(a, ['Compression mode']) }
      ]),
      subs && ttSectionHtml('Embedded Subtitles', [
        { label: 'Count', value: subs.countLabel },
        { label: 'Languages', value: subs.languages },
        { label: 'Tracks', value: subs.tracks },
        { label: 'Formats', value: subs.formats },
        { label: 'Forced', value: subs.forced }
      ])
    ].filter(Boolean).join('');

    return '<div class="stmpe-tt-summary">' +
      '<div class="stmpe-tt-top">' +
        '<div><h3 class="stmpe-tt-title">MediaInfo Summary</h3>' +
          '<span class="stmpe-tt-sub">' + escapeHtml(fileCount ? (fileCount + ' file' + (fileCount === 1 ? '' : 's') + ' in this torrent') : 'Parsed from the torrent MediaInfo') + '</span></div>' +
        (pills ? '<div class="stmpe-tt-pills">' + pills + '</div>' : '') +
      '</div>' +
      '<div class="stmpe-tt-body">' + sections + '</div>' +
      flagStrip +
    '</div>';
  }

  function ttFindMediaInfo(row) {
    return [...row.querySelectorAll('blockquote')]
      .find(block => {
        const text = (block.innerText || block.textContent || '').replace(/\r/g, '');
        const hasMediaInfo = /(?:^|\n)\s*General\s*:?\s*(?:\n|$)/i.test(text) && /(?:^|\n)\s*Video\s*:?\s*(?:\n|$)/i.test(text);
        const hasDiscInfo = ttIsDiscInfoText(text);
        return hasMediaInfo || hasDiscInfo;
      });
  }

  function ttIsDiscInfoText(text) {
    return /(?:^|\n)\s*DISC(?:\s+\d+)?\s+INFO\s*:?\s*(?:\n|$)/i.test(text) &&
      /(?:^|\n)\s*VIDEO\s*:/i.test(text);
  }

  function ttFindFileTable(row) {
    return [...row.querySelectorAll('table')]
      .find(table => {
        const first = table.rows && table.rows[0] ? ttClean(table.rows[0].innerText || table.rows[0].textContent) : '';
        return /\bFile Name\b/i.test(first) && /\bSize\b/i.test(first);
      });
  }

  function ttFileCount(table) {
    if (!table || !table.rows) return 0;
    return Math.max(0, table.rows.length - 1);
  }

  function ttCollapseFileTable(row, table) {
    if (!table || table.dataset.stmpeTtFiles === '1') return;
    table.dataset.stmpeTtFiles = '1';
    table.classList.add('stmpe-tt-file-table', 'is-collapsed');
    const count = ttFileCount(table);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'stmpe-tt-toggle';
    btn.setAttribute('aria-expanded', 'false');
    const setLabel = () => {
      const open = !table.classList.contains('is-collapsed');
      btn.innerHTML =
        '<span>' + (open ? 'Hide file list' : 'Show file list') + '</span>' +
        '<small>' + (count ? count + ' file' + (count === 1 ? '' : 's') : 'File details') + '</small>';
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    btn.addEventListener('click', () => {
      table.classList.toggle('is-collapsed');
      setLabel();
      ttUpdatePanelHeight(row);
    });
    setLabel();
    table.parentNode.insertBefore(btn, table);
    row.classList.add('stmpe-tt-row');
  }

  function ttWrapRawMediaInfo(block, row) {
    if (!block || block.parentElement.classList.contains('stmpe-tt-raw')) return;
    const details = document.createElement('details');
    details.className = 'stmpe-tt-raw';
    const summary = document.createElement('summary');
    summary.textContent = 'Full MediaInfo';
    block.parentNode.insertBefore(details, block);
    details.appendChild(summary);
    details.appendChild(block);
    details.addEventListener('toggle', () => ttUpdatePanelHeight(row));
  }

  function ttReleaseRow(row) {
    const release = row && row.previousElementSibling;
    if (!release || release.id || !release.cells || release.cells.length < 1) return null;
    return release;
  }

  function ttEnsurePanel(row) {
    const cell = row && row.cells && row.cells[0];
    if (!cell) return null;
    let panel = cell.querySelector(':scope > .stmpe-tt-panel');
    if (panel) return panel;
    panel = document.createElement('div');
    panel.className = 'stmpe-tt-panel';
    while (cell.firstChild) panel.appendChild(cell.firstChild);
    cell.appendChild(panel);
    return panel;
  }

  function ttUpdatePanelHeight(row) {
    const panel = row && row.querySelector(':scope > td > .stmpe-tt-panel');
    if (!panel || !row.classList.contains('stmpe-tt-open')) return;
    requestAnimationFrame(() => {
      panel.style.maxHeight = ttPanelHeight(panel);
    });
  }

  function ttPanelHeight(panel) {
    return Math.ceil((panel ? panel.scrollHeight : 0) + 32) + 'px';
  }

  function ttSetOpen(row, open) {
    const panel = ttEnsurePanel(row);
    const release = ttReleaseRow(row);
    if (!panel || !release) return;
    if (open) {
      row.classList.add('stmpe-tt-open');
      release.classList.add('is-open');
      release.setAttribute('aria-expanded', 'true');
      requestAnimationFrame(() => {
        panel.style.maxHeight = ttPanelHeight(panel);
      });
    } else {
      panel.style.maxHeight = ttPanelHeight(panel);
      requestAnimationFrame(() => {
        row.classList.remove('stmpe-tt-open');
        release.classList.remove('is-open');
        release.setAttribute('aria-expanded', 'false');
        panel.style.maxHeight = '0px';
      });
    }
  }

  function ttAttachReleaseToggle(row) {
    const release = ttReleaseRow(row);
    if (!release) return;
    release.classList.add('stmpe-tt-trigger');
    release.setAttribute('role', 'button');
    release.setAttribute('tabindex', '0');
    release.setAttribute('aria-expanded', 'false');
    release.setAttribute('aria-controls', row.id || '');
    if (release.dataset.stmpeTtToggle !== '1') {
      release.dataset.stmpeTtToggle = '1';
      const toggle = event => {
        if (event && event.target && event.target.closest('a,button,input,select,textarea,label')) return;
        ttSetOpen(row, !row.classList.contains('stmpe-tt-open'));
      };
      release.addEventListener('click', toggle);
      release.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        toggle(event);
      });
    }
    ttSetOpen(row, false);
  }

  function ttRelabelExternalSubtitles(row) {
    const add = row && row.querySelector('a[id^="addsubtitle_"]');
    const display = row && row.querySelector('[id^="subtitle_display_"]');
    const labelRow = add ? add.closest('tr') : (display && display.closest('tr') && display.closest('tr').previousElementSibling);
    const cell = labelRow && labelRow.cells && labelRow.cells[0];
    if (!cell || cell.dataset.stmpeTtSubtitleLabel === '1') return;
    const relabel = node => {
      if (!node) return false;
      if (node.nodeType === 3 && /\bSubtitles\b/i.test(node.nodeValue || '')) {
        node.parentNode.replaceChild(document.createTextNode((node.nodeValue || '').replace(/\bSubtitles\b/i, 'External Subtitle Files')), node);
        return true;
      }
      return [...(node.childNodes || [])].some(relabel);
    };
    if (relabel(cell)) cell.dataset.stmpeTtSubtitleLabel = '1';
  }

  function ttEnhanceTorrentRow(row) {
    if (!row) return false;
    if (row.dataset.stmpeTorrentTouchups === '1') {
      ttRelabelExternalSubtitles(row);
      ttEnsurePanel(row);
      ttAttachReleaseToggle(row);
      return false;
    }
    ttCss();
    const mediaInfo = ttFindMediaInfo(row);
    const fileTable = ttFindFileTable(row);
    const count = ttFileCount(fileTable);
    const mediaText = mediaInfo ? (mediaInfo.innerText || mediaInfo.textContent || '') : '';
    const data = mediaInfo ? (ttIsDiscInfoText(mediaText) ? ttParseDiscInfo(mediaText) : ttParseMediaInfo(mediaText)) : null;
    if (data && data.usable && !row.querySelector(':scope .stmpe-tt-summary')) {
      const summary = document.createElement('div');
      summary.innerHTML = ttSummaryHtml(data, count);
      const card = summary.firstElementChild;
      const anchor = fileTable || mediaInfo;
      if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(card, anchor);
    }
    if (fileTable) ttCollapseFileTable(row, fileTable);
    ttRelabelExternalSubtitles(row);
    if (mediaInfo) ttWrapRawMediaInfo(mediaInfo, row);
    row.dataset.stmpeTorrentTouchups = '1';
    row.classList.add('stmpe-tt-row');
    ttEnsurePanel(row);
    ttAttachReleaseToggle(row);
    return true;
  }

  function runTorrentTouchups() {
    const rows = [...document.querySelectorAll('tr[id^="torrent_"]')];
    let changed = false;
    rows.forEach(row => { changed = ttEnhanceTorrentRow(row) || changed; });
    return rows.length ? true : changed;
  }

  /* =========================================================================
   * FEATURE: Homepage Sonarr Calendar
   * =======================================================================*/
  const HOME_CAL_CACHE = 'btn_home_sonarr_calendar_cache_v1';
  const HOME_CAL_TTL = 1000 * 60 * 10;
  const HOME_CAL_DAYS = 2;

  function hcalCacheRead() {
    try { return JSON.parse(localStorage.getItem(HOME_CAL_CACHE) || '{}') || {}; }
    catch (e) { return {}; }
  }

  function hcalCacheWrite(cache) {
    try { localStorage.setItem(HOME_CAL_CACHE, JSON.stringify(cache)); } catch (e) {}
  }

  function hcalYmd(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }

  function hcalDateFromEpisode(ep) {
    const raw = ep.airDateUtc || ep.airDate || ep.releaseDate;
    if (!raw) return null;
    const d = new Date(raw);
    if (isNaN(d.getTime())) return null;
    return d;
  }

  function hcalShortDate(date) {
    try { return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }); }
    catch (e) { return hcalYmd(date); }
  }

  function hcalDayLabel(ymd) {
    const today = new Date();
    const tomorrow = new Date();
    tomorrow.setDate(today.getDate() + 1);
    if (ymd === hcalYmd(today)) return 'Today';
    if (ymd === hcalYmd(tomorrow)) return 'Tomorrow';
    const d = new Date(ymd + 'T12:00:00');
    return hcalShortDate(d);
  }

  function hcalTime(date) {
    if (!date) return '';
    try { return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }).replace(/^0/, ''); }
    catch (e) { return ''; }
  }

  function hcalEpisodeCode(ep) {
    const s = Number(ep.seasonNumber || 0);
    const e = Number(ep.episodeNumber || 0);
    if (!s || !e) return '';
    return 'S' + String(s).padStart(2, '0') + 'E' + String(e).padStart(2, '0');
  }

  function hcalSeriesTitle(ep) {
    return ((ep.series || {}).title || ep.seriesTitle || ep.showTitle || '').trim();
  }

  function hcalCacheKey(server, start, end) {
    return [server.id || '', normBase(server.url), start, end].join('|');
  }

  async function hcalFetchServer(server, start, end, cache) {
    const key = hcalCacheKey(server, start, end);
    const cached = cache[key];
    if (cached && cached.data && Date.now() - cached.t < HOME_CAL_TTL) return cached.data;
    const res = await SonarrAPI.calendar(server, start, end);
    const data = Array.isArray(res.data) ? res.data : [];
    cache[key] = { t: Date.now(), data };
    return data;
  }

  function hcalNormalizeEpisode(ep, server) {
    const date = hcalDateFromEpisode(ep);
    if (!date) return null;
    const title = hcalSeriesTitle(ep);
    if (!title) return null;
    const code = hcalEpisodeCode(ep);
    return {
      key: [
        ((ep.series || {}).tvdbId || (ep.series || {}).id || title).toString().toLowerCase(),
        ep.seasonNumber || '',
        ep.episodeNumber || '',
        hcalYmd(date)
      ].join('|'),
      ymd: hcalYmd(date),
      sort: date.getTime(),
      time: hcalTime(date),
      series: title,
      episode: ep.title || '',
      code,
      server: server.name || hostFrom(server.url),
      href: '/series.php?name=' + encodeURIComponent(title)
    };
  }

  function hcalGroupEpisodes(entries) {
    const deduped = {};
    entries.forEach(entry => {
      if (!entry) return;
      if (!deduped[entry.key]) deduped[entry.key] = Object.assign({}, entry, { servers: [entry.server] });
      else if (!deduped[entry.key].servers.includes(entry.server)) deduped[entry.key].servers.push(entry.server);
    });
    const days = {};
    Object.values(deduped).sort((a, b) => a.sort - b.sort).forEach(entry => {
      if (!days[entry.ymd]) days[entry.ymd] = [];
      days[entry.ymd].push(entry);
    });
    return days;
  }

  function hcalCss() {
    injectCss('snr-home-calendar-style', `
      #snr-home-calendar{ overflow:visible; }
      #snr-home-calendar>.head{ border-radius:var(--radius) var(--radius) 0 0; overflow:hidden; }
      #snr-home-calendar .hcal-body{ padding:13px 14px 14px; }
      #snr-home-calendar .hcal-summary{ display:flex; flex-direction:column; gap:12px; }
      #snr-home-calendar .hcal-sum-line{
        position:relative; padding:6px 0; cursor:default;
        color:var(--text-1,#cdd4de); font-size:12.5px; font-weight:500; line-height:1.4;
      }
      #snr-home-calendar .hcal-sum-line + .hcal-sum-line{ border-top:1px solid rgba(255,255,255,.06); }
      #snr-home-calendar .hcal-sum-line b{ color:var(--accent-bright,#3fc8ff); font-weight:800; }
      #snr-home-calendar .hcal-popover{
        position:absolute; top:calc(100% + 6px); left:0; min-width:260px; z-index:50;
        background:var(--bg-4,#20252d); border:1px solid var(--line-2,#2d333c); border-radius:12px;
        box-shadow:var(--shadow); padding:12px 14px;
        opacity:0; visibility:hidden; pointer-events:none; transform:translateY(-4px);
        transition:opacity .18s ease, transform .18s ease, visibility 0s linear .18s;
      }
      #snr-home-calendar .hcal-sum-line:hover .hcal-popover,
      #snr-home-calendar .hcal-sum-line:focus-within .hcal-popover{
        opacity:1; visibility:visible; pointer-events:auto; transform:translateY(0);
        transition:opacity .18s ease .1s, transform .18s ease .1s, visibility 0s linear .1s;
      }
      #snr-home-calendar .hcal-list{ list-style:none; padding:0; margin:0; display:grid; gap:7px; }
      #snr-home-calendar .hcal-item{ position:relative; padding-left:13px; color:var(--text-1,#cdd4de); font-size:11.5px; line-height:1.35; }
      #snr-home-calendar .hcal-item::before{ content:""; position:absolute; left:1px; top:.55em; width:4px; height:4px; border-radius:50%; background:var(--accent-bright,#3fc8ff); box-shadow:0 0 8px rgba(63,200,255,.45); }
      #snr-home-calendar .hcal-item a{ color:var(--text,#f4f7fb) !important; font-weight:800; text-decoration:none !important; }
      #snr-home-calendar .hcal-item a:hover{ color:var(--accent-bright,#3fc8ff) !important; }
      #snr-home-calendar .hcal-code{ color:var(--accent-bright,#3fc8ff); font-weight:800; white-space:nowrap; }
      #snr-home-calendar .hcal-ep{ color:var(--text-2,#9aa4b2); }
      #snr-home-calendar .hcal-meta{ display:block; color:var(--text-3,#7d8794); font-size:10.5px; margin-top:2px; }
      #snr-home-calendar .hcal-empty{ color:var(--text-2,#9aa4b2); font-size:12px; line-height:1.45; }
      #snr-home-calendar .hcal-error{ color:#ff9aa5; font-size:12px; line-height:1.45; }
    `);
  }

  function hcalRender(box, days) {
    const body = box.querySelector('.hcal-body');
    const keys = Object.keys(days).sort().slice(0, HOME_CAL_DAYS);
    if (!keys.length) {
      body.innerHTML = '<div class="hcal-empty">No upcoming episodes found in Sonarr for today or tomorrow.</div>';
      return;
    }
    const summaryLines = keys.map(ymd => {
      const list = days[ymd] || [];
      const n = list.length;
      const popover = '<ul class="hcal-list">' + list.map(item => {
        const meta = item.time || '';
        return '<li class="hcal-item">' +
          '<a href="' + escapeAttr(item.href) + '">' + escapeHtml(item.series) + '</a>' +
          (item.code ? ' <span class="hcal-code">' + escapeHtml(item.code) + '</span>' : '') +
          (item.episode ? ' <span class="hcal-ep">' + escapeHtml(item.episode) + '</span>' : '') +
          (meta ? '<span class="hcal-meta">' + escapeHtml(meta) + '</span>' : '') +
        '</li>';
      }).join('') + '</ul>';
      return '<div class="hcal-sum-line" tabindex="0">' +
        n + ' episode' + (n === 1 ? '' : 's') + ' <b>' + escapeHtml(hcalDayLabel(ymd).toLowerCase()) + '</b>' +
        '<div class="hcal-popover">' + popover + '</div>' +
      '</div>';
    }).join('');

    body.innerHTML = '<div class="hcal-summary">' + summaryLines + '</div>';
  }

  async function runHomeSonarrCalendar() {
    if (document.getElementById('snr-home-calendar')) return true;
    if (!isEnabled('sonarr')) return true;
    const server = loadServers().filter(s => s.url && s.url.trim() && s.apiKey && s.apiKey.trim())[0];
    if (!server) return true;
    const sidebar = document.querySelector('#content > div.thin > div.sidebar') || document.querySelector('.sidebar');
    if (!sidebar) return false;

    hcalCss();
    const box = document.createElement('div');
    box.className = 'box snr';
    box.id = 'snr-home-calendar';
    box.innerHTML = '<div class="head"><strong>Sonarr Calendar</strong></div><div class="hcal-body"><div class="hcal-empty">Loading upcoming episodes...</div></div>';
    const recentUploads = [...sidebar.querySelectorAll(':scope > .box, .box')]
      .find(b => /(?:last\s*5|latest|recent)\s+uploads/i.test(((b.querySelector(':scope > .head, .head') || {}).textContent || '').trim()));
    if (recentUploads && recentUploads.parentElement) recentUploads.insertAdjacentElement('afterend', box);
    else sidebar.insertBefore(box, sidebar.firstElementChild);

    const startDate = new Date();
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + HOME_CAL_DAYS);
    const start = hcalYmd(startDate);
    const end = hcalYmd(endDate);
    const cache = hcalCacheRead();

    try {
      const batches = [await hcalFetchServer(server, start, end, cache)
        .then(rows => ({ ok: true, rows: rows.map(row => hcalNormalizeEpisode(row, server)).filter(Boolean) }))
        .catch(() => ({ ok: false, rows: [] }))];
      hcalCacheWrite(cache);
      if (!batches.some(batch => batch.ok)) throw new Error('All Sonarr calendar requests failed');
      hcalRender(box, hcalGroupEpisodes([].concat(...batches.map(batch => batch.rows))));
    } catch (e) {
      const body = box.querySelector('.hcal-body');
      if (body) body.innerHTML = '<div class="hcal-error">Could not load the Sonarr calendar.</div>';
    }
    return true;
  }

  /* =========================================================================
   * FEATURE: Homepage Featured Cards (Featured Series + Featured Actor)
   * =======================================================================*/
  const BHF_CACHE = 'btn_home_featured_tmdb_cache_v1';
  const BHF_TTL = 1000 * 60 * 60 * 24 * 7;
  const BHF_IMG = 'https://image.tmdb.org/t/p/';

  function bhfCss() {
    injectCss('btn-home-featured-style', `
      .of_the_month.stmpe-home-featured{gap:22px;align-items:stretch;}
      .of_the_month.stmpe-home-featured>.box{position:relative;overflow:hidden;border-color:rgba(63,200,255,.20);}
      .of_the_month.stmpe-home-featured>.box::after{
        content:"";position:absolute;inset:0;pointer-events:none;
        background:
          linear-gradient(90deg,rgba(8,10,14,.96) 0%,rgba(8,10,14,.86) 38%,rgba(8,10,14,.60) 100%),
          var(--bhf-backdrop,linear-gradient(135deg,rgba(31,157,255,.08),rgba(255,255,255,.02)));
        background-size:cover;background-position:center;opacity:.34;z-index:0;
      }
      .of_the_month.stmpe-home-featured>.box>.head{position:relative;z-index:1;}
      .of_the_month .bhf-body{
        position:relative;z-index:1;display:grid !important;grid-template-columns:118px minmax(0,1fr);
        gap:16px;padding:0 !important;margin:0 !important;min-height:226px;list-style:none;align-items:stretch;
      }
      .of_the_month .bhf-body>li{display:block;margin:0;padding:0;border:0;list-style:none;}
      .of_the_month .bhf-poster{height:100%;min-height:226px;overflow:hidden;background:#000;}
      .of_the_month .bhf-poster a,.of_the_month .bhf-poster span{display:block;height:100%;}
      .of_the_month .bhf-poster img{width:100% !important;height:100% !important;max-width:none !important;object-fit:cover;object-position:center top;border:0 !important;border-radius:0 !important;box-shadow:none !important;}
      .of_the_month .bhf-main{display:flex !important;flex-direction:column;min-width:0;padding:18px 18px 16px 0 !important;}
      .of_the_month .bhf-kicker{color:var(--accent-bright);font-size:10.5px;font-weight:900;letter-spacing:.12em;text-transform:uppercase;margin-bottom:5px;}
      .of_the_month .bhf-title{color:#fff !important;font-family:var(--fd);font-size:22px;font-weight:800;line-height:1.08;margin:0 0 8px;text-decoration:none !important;}
      .of_the_month .bhf-title:hover{color:var(--accent-bright) !important;}
      .of_the_month .bhf-overview{color:var(--text-1);font-size:12.5px;line-height:1.48;margin:0 0 11px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;}
      .of_the_month .bhf-chips{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 11px;}
      .of_the_month .bhf-chip{display:inline-flex;align-items:center;min-height:24px;padding:3px 8px;border-radius:999px;background:rgba(255,255,255,.055);border:1px solid rgba(255,255,255,.09);color:var(--text-1);font-size:11px;font-weight:800;white-space:nowrap;}
      .of_the_month .bhf-chip.score{color:#06121d;background:var(--grad-accent);border-color:transparent;}
      .of_the_month .bhf-deck{margin-top:auto;display:grid;grid-template-columns:1fr 1fr;gap:10px;color:var(--text-2);font-size:11.5px;line-height:1.45;}
      .of_the_month .bhf-deck b{display:block;color:#fff;font-size:11px;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;}
      .of_the_month .bhf-deck a{display:block;color:var(--accent-bright) !important;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700;}
      .of_the_month .bhf-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;}
      .of_the_month .bhf-actions a{display:inline-flex !important;align-items:center;justify-content:center;padding:6px 10px;border:1px solid rgba(63,200,255,.18);border-radius:999px;background:rgba(255,255,255,.035);color:#dcecf8 !important;font-size:11.5px;font-weight:900;line-height:1;text-decoration:none !important;}
      .of_the_month .bhf-actions a:hover{border-color:var(--accent-bright);color:#fff !important;}
      .of_the_month .bhf-fallback{padding:15px 18px;color:var(--text-2);font-size:12.5px;}
      @media (max-width:1180px){.of_the_month.stmpe-home-featured{flex-direction:column;}.of_the_month .bhf-deck{grid-template-columns:1fr;}}
      @media (max-width:640px){.of_the_month .bhf-body{grid-template-columns:92px minmax(0,1fr);}.of_the_month .bhf-title{font-size:18px;}.of_the_month .bhf-poster{min-height:210px;}.of_the_month .bhf-main{padding-right:12px !important;}}
    `);
  }

  function bhfReadCache() {
    try { return JSON.parse(localStorage.getItem(BHF_CACHE) || '{}') || {}; }
    catch (e) { return {}; }
  }

  function bhfWriteCache(cache) {
    try { localStorage.setItem(BHF_CACHE, JSON.stringify(cache)); } catch (e) {}
  }

  async function bhfTmdb(path, params) {
    const key = (getKey('trending') || '').trim();
    if (!key) throw new Error('Missing TMDb API key');
    const qs = new URLSearchParams(Object.assign({ api_key: key, language: 'en-US' }, params || {}));
    const raw = await gmGet('https://api.themoviedb.org/3' + path + '?' + qs.toString());
    return JSON.parse(raw || '{}');
  }

  function bhfCleanName(name) {
    return String(name || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  }

  function bhfYear(iso) {
    return iso ? String(iso).slice(0, 4) : '';
  }

  function bhfDate(iso) {
    if (!iso) return '';
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d.getTime())) return iso;
    try { return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
    catch (e) { return iso; }
  }

  function bhfPickByName(name, results) {
    const clean = bhfCleanName(name);
    const rows = (results || []).filter(Boolean);
    return rows.find(r => bhfCleanName(r.name || r.original_name) === clean) || rows[0] || null;
  }

  function bhfImg(path, size) {
    return path ? BHF_IMG + size + path : '';
  }

  function bhfNativeTextFromBox(box) {
    const body = box.querySelector('ul.stats') || box;
    const bold = body.querySelector('li:nth-child(2) b, li:nth-child(2) strong, b, strong');
    return bold ? bold.textContent.replace(/\s+/g, ' ').trim() : '';
  }

  function bhfNativeSeries(box) {
    const body = box.querySelector('ul.stats') || box;
    const link = body.querySelector('a[href*="series.php"]');
    const poster = body.querySelector('img');
    return {
      title: bhfNativeTextFromBox(box) || (link ? link.textContent.trim() : ''),
      href: link ? link.getAttribute('href') : '',
      poster: poster ? (poster.currentSrc || poster.src || poster.getAttribute('src') || '') : '',
      btnRating: (body.querySelector('.month_rating') || {}).textContent || ''
    };
  }

  function bhfNativeActor(box) {
    const body = box.querySelector('ul.stats') || box;
    const links = [...body.querySelectorAll('li:nth-child(2) a[href*="series.php"], a[href*="series.php"]')];
    const actorLink = body.querySelector('a[href*="actor.php"]');
    const poster = body.querySelector('img');
    const name = bhfNativeTextFromBox(box) || (actorLink ? actorLink.textContent.trim() : '');
    return {
      name,
      href: actorLink ? actorLink.getAttribute('href') : ('/actor.php?name=' + encodeURIComponent(name)),
      poster: poster ? (poster.currentSrc || poster.src || poster.getAttribute('src') || '') : '',
      nativeCredits: links.map(a => ({ name: a.textContent.trim(), href: a.getAttribute('href') })).filter(x => x.name)
    };
  }

  async function bhfSeriesData(native, cache) {
    const key = 'tv:' + bhfCleanName(native.title);
    const cached = cache[key];
    if (cached && Date.now() - cached.t < BHF_TTL) return cached.data;
    const search = await bhfTmdb('/search/tv', { query: native.title, include_adult: 'false', page: '1' });
    const hit = bhfPickByName(native.title, search.results || []);
    if (!hit || !hit.id) return null;
    const tv = await bhfTmdb('/tv/' + encodeURIComponent(hit.id), { append_to_response: 'aggregate_credits,external_ids' });
    const cast = (((tv.aggregate_credits || {}).cast) || []).slice()
      .sort((a, b) => Number(b.total_episode_count || 0) - Number(a.total_episode_count || 0))
      .slice(0, 4)
      .map(c => c.name)
      .filter(Boolean);
    const data = {
      id: tv.id,
      name: tv.name || hit.name || native.title,
      overview: tv.overview || hit.overview || '',
      poster: bhfImg(tv.poster_path || hit.poster_path, 'w342') || native.poster,
      backdrop: bhfImg(tv.backdrop_path || hit.backdrop_path, 'w780'),
      rating: tv.vote_average ? Number(tv.vote_average).toFixed(1) : '',
      year: bhfYear(tv.first_air_date || hit.first_air_date),
      status: tv.status || '',
      network: ((tv.networks || [])[0] || {}).name || '',
      seasons: tv.number_of_seasons || '',
      episodes: tv.number_of_episodes || '',
      genres: (tv.genres || []).slice(0, 3).map(g => g.name).filter(Boolean),
      lastEpisode: tv.last_episode_to_air ? ((tv.last_episode_to_air.name || 'Latest episode') + ' • ' + bhfDate(tv.last_episode_to_air.air_date)) : '',
      nextEpisode: tv.next_episode_to_air ? ((tv.next_episode_to_air.name || 'Next episode') + ' • ' + bhfDate(tv.next_episode_to_air.air_date)) : '',
      cast,
      tmdbUrl: 'https://www.themoviedb.org/tv/' + encodeURIComponent(tv.id)
    };
    cache[key] = { t: Date.now(), data };
    return data;
  }

  async function bhfActorData(native, cache) {
    const key = 'person:' + bhfCleanName(native.name);
    const cached = cache[key];
    if (cached && Date.now() - cached.t < BHF_TTL) return cached.data;
    const search = await bhfTmdb('/search/person', { query: native.name, include_adult: 'false', page: '1' });
    const hit = bhfPickByName(native.name, search.results || []);
    if (!hit || !hit.id) return null;
    const person = await bhfTmdb('/person/' + encodeURIComponent(hit.id), { append_to_response: 'combined_credits,external_ids' });
    const credits = (((person.combined_credits || {}).cast) || [])
      .filter(c => c && c.media_type === 'tv' && c.name)
      .sort((a, b) => Number(b.episode_count || 0) - Number(a.episode_count || 0) || Number(b.popularity || 0) - Number(a.popularity || 0))
      .slice(0, 5)
      .map(c => ({ name: c.name, href: '/series.php?name=' + encodeURIComponent(c.name), role: c.character || '' }));
    const data = {
      id: person.id,
      name: person.name || hit.name || native.name,
      overview: person.biography || '',
      poster: bhfImg(person.profile_path || hit.profile_path, 'w342') || native.poster,
      backdrop: bhfImg((((person.combined_credits || {}).cast || []).find(c => c.backdrop_path) || {}).backdrop_path, 'w780'),
      birthday: bhfYear(person.birthday),
      place: person.place_of_birth || '',
      department: person.known_for_department || '',
      credits: credits.length ? credits : native.nativeCredits,
      tmdbUrl: 'https://www.themoviedb.org/person/' + encodeURIComponent(person.id)
    };
    cache[key] = { t: Date.now(), data };
    return data;
  }

  function bhfChip(text, cls) {
    return text ? '<span class="bhf-chip' + (cls ? ' ' + cls : '') + '">' + escapeHtml(text) + '</span>' : '';
  }

  function bhfSetBackdrop(box, url) {
    if (url) box.style.setProperty('--bhf-backdrop', 'url("' + String(url).replace(/"/g, '\\"') + '")');
  }

  function bhfRenderSeries(box, native, tv) {
    if (!box || !native || !tv) return;
    box.classList.add('stmpe-home-feature-card');
    bhfSetBackdrop(box, tv.backdrop);
    const body = box.querySelector('ul.stats');
    if (!body) return;
    body.className = 'stats bhf-body bhf-series';
    const btnHref = native.href || ('/series.php?name=' + encodeURIComponent(tv.name));
    body.innerHTML =
      '<li class="bhf-poster"><a href="' + escapeAttr(btnHref) + '"><img loading="lazy" alt="" src="' + escapeAttr(tv.poster || native.poster) + '"></a></li>' +
      '<li class="bhf-main">' +
      '<div class="bhf-kicker">Featured Series</div>' +
      '<a class="bhf-title" href="' + escapeAttr(btnHref) + '">' + escapeHtml(tv.name) + '</a>' +
      '<p class="bhf-overview">' + escapeHtml(tv.overview || 'No TMDb synopsis available yet.') + '</p>' +
      '<div class="bhf-chips">' +
        bhfChip(tv.rating ? 'TMDb ' + tv.rating : '', 'score') +
        bhfChip(native.btnRating ? 'BTN ' + native.btnRating.trim() : '') +
        bhfChip(tv.year) + bhfChip(tv.status) + bhfChip(tv.network) +
        bhfChip(tv.seasons ? tv.seasons + ' seasons' : '') + bhfChip(tv.episodes ? tv.episodes + ' eps' : '') +
        tv.genres.map(g => bhfChip(g)).join('') +
      '</div>' +
      '<div class="bhf-deck">' +
        '<div><b>Cast</b>' + (tv.cast.length ? tv.cast.map(escapeHtml).join(', ') : 'TMDb cast unavailable') + '</div>' +
        '<div><b>Episodes</b>' + escapeHtml(tv.nextEpisode || tv.lastEpisode || 'No episode date available') + '</div>' +
      '</div>' +
      '<div class="bhf-actions"><a href="' + escapeAttr(btnHref) + '">Open on BTN</a><a target="_blank" rel="noopener" href="' + escapeAttr(tv.tmdbUrl) + '">TMDb</a></div>' +
      '</li>';
  }

  function bhfRenderActor(box, native, actor) {
    if (!box || !native || !actor) return;
    box.classList.add('stmpe-home-feature-card');
    bhfSetBackdrop(box, actor.backdrop);
    const body = box.querySelector('ul.stats');
    if (!body) return;
    body.className = 'stats bhf-body bhf-actor';
    const actorHref = native.href || ('/actor.php?name=' + encodeURIComponent(actor.name));
    const credits = (actor.credits || []).slice(0, 5);
    body.innerHTML =
      '<li class="bhf-poster"><a href="' + escapeAttr(actorHref) + '"><img loading="lazy" alt="" src="' + escapeAttr(actor.poster || native.poster) + '"></a></li>' +
      '<li class="bhf-main">' +
      '<div class="bhf-kicker">Featured Actor</div>' +
      '<a class="bhf-title" href="' + escapeAttr(actorHref) + '">' + escapeHtml(actor.name) + '</a>' +
      '<p class="bhf-overview">' + escapeHtml(actor.overview || 'No TMDb biography available yet.') + '</p>' +
      '<div class="bhf-chips">' +
        bhfChip(actor.birthday ? 'Born ' + actor.birthday : '', 'score') +
        bhfChip(actor.department) + bhfChip(actor.place ? actor.place.split(',')[0] : '') +
      '</div>' +
      '<div class="bhf-deck">' +
        '<div><b>Known for</b>' + (credits.length ? credits.map(c => '<a href="' + escapeAttr(c.href || ('/series.php?name=' + encodeURIComponent(c.name))) + '">' + escapeHtml(c.name) + '</a>').join('') : 'TMDb credits unavailable') + '</div>' +
        '<div><b>Roles</b>' + (credits.length ? credits.map(c => escapeHtml(c.role || 'Cast')).slice(0, 4).join(', ') : 'No roles listed') + '</div>' +
      '</div>' +
      '<div class="bhf-actions"><a href="' + escapeAttr(actorHref) + '">Open on BTN</a><a target="_blank" rel="noopener" href="' + escapeAttr(actor.tmdbUrl) + '">TMDb</a></div>' +
      '</li>';
  }

  async function runHomeFeaturedCards() {
    const wrap = document.querySelector('.of_the_month');
    if (!wrap || wrap.dataset.stmpeHomeFeatured === '1') return !!wrap;
    const key = (getKey('trending') || '').trim();
    if (!key) return true;
    const boxes = [...wrap.querySelectorAll(':scope > .box')];
    const seriesBox = boxes.find(b => /featured\s+series/i.test((b.querySelector('.head') || {}).textContent || '')) || boxes[0];
    const actorBox = boxes.find(b => /featured\s+actor/i.test((b.querySelector('.head') || {}).textContent || '')) || boxes[1];
    if (!seriesBox && !actorBox) return false;
    wrap.dataset.stmpeHomeFeatured = '1';
    wrap.classList.add('stmpe-home-featured');
    bhfCss();
    const cache = bhfReadCache();
    try {
      if (seriesBox) {
        const native = bhfNativeSeries(seriesBox);
        if (native.title) {
          const tv = await bhfSeriesData(native, cache);
          if (tv) bhfRenderSeries(seriesBox, native, tv);
        }
      }
      if (actorBox) {
        const native = bhfNativeActor(actorBox);
        if (native.name) {
          const actor = await bhfActorData(native, cache);
          if (actor) bhfRenderActor(actorBox, native, actor);
        }
      }
      bhfWriteCache(cache);
    } catch (e) {
      console.warn('[STMPE] homepage featured cards failed', e);
    }
    return true;
  }

  /* =========================================================================
   * FEATURE: Collapse Old Seasons (series page)
   *   BTN's own (hide)/(show) links only flip their label on these discog-style
   *   season tables — they don't actually collapse the rows. We take over: wire
   *   each season's toggle to really show/hide its torrent rows, and collapse
   *   every season except the most recent (the first season table in the DOM).
   * =======================================================================*/
  function runSeasonCollapse() {
    // Season tables are .torrent_table blocks whose first row is a colhead_dark
    // header reading "Season N (hide)" / "Other (hide)".
    const seasonTables = [...document.querySelectorAll('.main_column .torrent_table')].filter(t => {
      const h = t.rows && t.rows[0];
      return h && /colhead/.test(h.className) && t.querySelector('tr.group_torrent');
    });
    if (seasonTables.length < 2) return true; // nothing worth collapsing

    seasonTables.forEach((table, idx) => {
      if (table.dataset.snrSeason) return; // already wired
      table.dataset.snrSeason = '1';
      const header = table.rows[0];
      const rows = () => [...table.querySelectorAll('tr.group_torrent')];

      const setCollapsed = (collapsed) => {
        rows().forEach(r => { r.style.display = collapsed ? 'none' : ''; });
        table.dataset.snrCollapsed = collapsed ? '1' : '0';
        // reflect state on the toggle link label
        const lnk = header.querySelector('a.toggle') || header.querySelector('a');
        if (lnk) lnk.textContent = collapsed ? 'show' : 'hide';
      };

      // Replace the toggle link with a clone to drop BTN's (no-op) handler,
      // then wire our own that genuinely toggles the rows.
      let link = header.querySelector('a.toggle') || header.querySelector('a');
      if (link) {
        const fresh = link.cloneNode(true);
        link.replaceWith(fresh);
        link = fresh;
        link.style.cursor = 'pointer';
        link.addEventListener('click', (e) => {
          e.preventDefault();
          setCollapsed(table.dataset.snrCollapsed !== '1');
        });
      }

      // Collapse everything except the most recent season (idx 0).
      setCollapsed(idx !== 0);
    });
    return true;
  }

  /* =========================================================================
   * FEATURE: Artwork Placeholders (all pages)
   *   BTN falls back to a set of shared imgur images for shows with no poster /
   *   banner / fan art. We detect those by id and swap in a clean themed SVG,
   *   choosing banner vs poster styling from the element's aspect ratio so it
   *   works for banners, sidebar posters AND torrent-table thumbnails alike.
   * =======================================================================*/
  const PLACEHOLDER_IDS = ['hIq9qAn', 'qHx6IsI', '55K4Dww']; // shared imgur No Banner / No Poster / No Fan Art
  // BTN's own default artwork (used in Last 5 Uploads / Snatches etc.), matched by URL fragment.
  const PLACEHOLDER_URLS = ['/common/posters/noposter', '/noposter.', '/nobanner.', '/noartwork', 'no_poster', 'no-image', 'noimage'];
  // BTN's default "no avatar" image (comment / forum poster sidebar). Handled as
  // a SQUARE placeholder rather than a tall poster so it matches the avatar column.
  const AVATAR_URLS = ['/avatars/default', 'avatars/default'];
  const PH_C = { bg1: '#141821', bg2: '#0a0c10', line: '#2b313b', accent: '#1f9dff', accentB: '#3fc8ff', text: '#e8edf4', muted: '#7d8794' };

  function phIsDefault(src) {
    if (!src) return false;
    if (PLACEHOLDER_IDS.some(id => src.indexOf('/' + id) !== -1)) return true;
    const low = src.toLowerCase();
    if (AVATAR_URLS.some(u => low.indexOf(u) !== -1)) return true;
    return PLACEHOLDER_URLS.some(u => low.indexOf(u) !== -1);
  }
  function phIsAvatar(src) {
    if (!src) return false;
    const low = src.toLowerCase();
    return AVATAR_URLS.some(u => low.indexOf(u) !== -1);
  }
  function phWrap(t, maxChars, maxLines) {
    const words = (t || '').replace(/\s*\(\d{4}\)\s*$/, '').split(/\s+/).filter(Boolean);
    const lines = []; let cur = '';
    for (const w of words) {
      const cand = cur ? cur + ' ' + w : w;
      if (cand.length > maxChars && cur) { lines.push(cur); cur = w; if (lines.length >= maxLines) break; }
      else cur = cand;
    }
    if (cur && lines.length < maxLines) lines.push(cur);
    if (lines.length === maxLines) {
      // if we ran out of room, mark truncation
      let joined = lines.join(' ');
      if (joined.length < (t || '').replace(/\s*\(\d{4}\)\s*$/, '').length) lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, '') + '…';
    }
    return lines;
  }
  function phEsc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
  function phDataUri(svg) { return 'data:image/svg+xml,' + encodeURIComponent(svg); }

  function phPosterSvg(title) {
    const lines = phWrap(title, 15, 3);
    const startY = 300;
    const tspans = lines.map((ln, i) =>
      `<text x='150' y='${startY + i * 26}' text-anchor='middle' font-family='Segoe UI,Roboto,Helvetica,Arial,sans-serif' font-size='19' font-weight='600' fill='${PH_C.text}'>${phEsc(ln)}</text>`
    ).join('');
    return phDataUri(
`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 300 450' preserveAspectRatio='xMidYMid slice'>
  <defs>
    <linearGradient id='g' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='${PH_C.bg1}'/><stop offset='1' stop-color='${PH_C.bg2}'/></linearGradient>
    <radialGradient id='glow' cx='0.5' cy='0.4' r='0.62'><stop offset='0' stop-color='${PH_C.accent}' stop-opacity='0.18'/><stop offset='1' stop-color='${PH_C.accent}' stop-opacity='0'/></radialGradient>
  </defs>
  <rect width='300' height='450' fill='url(#g)'/>
  <rect width='300' height='450' fill='url(#glow)'/>
  <rect x='6' y='6' width='288' height='438' rx='12' fill='none' stroke='${PH_C.line}' stroke-width='1.5'/>
  <g transform='translate(150,182)' fill='none' stroke='${PH_C.accentB}' stroke-opacity='0.6' stroke-width='7' stroke-linecap='round'>
    <path d='M 21 -36.4 A 42 42 0 1 1 -21 -36.4'/><line x1='0' y1='-50' x2='0' y2='-8'/>
  </g>
  <text x='150' y='258' text-anchor='middle' font-family='Segoe UI,Roboto,Helvetica,Arial,sans-serif' font-size='12' font-weight='700' letter-spacing='3' fill='${PH_C.muted}'>NO POSTER</text>
  ${tspans}
</svg>`);
  }

  function phBannerSvg(title) {
    const lines = phWrap(title, 34, 2);
    const tspans = lines.map((ln, i) =>
      `<text x='150' y='${lines.length === 1 ? 108 : 98 + i * 34}' font-family='Segoe UI,Roboto,Helvetica,Arial,sans-serif' font-size='30' font-weight='700' fill='${PH_C.text}'>${phEsc(ln)}</text>`
    ).join('');
    return phDataUri(
`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1114 206' preserveAspectRatio='xMidYMid slice'>
  <defs>
    <linearGradient id='gb' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='${PH_C.bg1}'/><stop offset='1' stop-color='${PH_C.bg2}'/></linearGradient>
    <radialGradient id='glb' cx='0.12' cy='0.5' r='0.5'><stop offset='0' stop-color='${PH_C.accent}' stop-opacity='0.2'/><stop offset='1' stop-color='${PH_C.accent}' stop-opacity='0'/></radialGradient>
  </defs>
  <rect width='1114' height='206' fill='url(#gb)'/>
  <rect width='1114' height='206' fill='url(#glb)'/>
  <g transform='translate(80,103)' fill='none' stroke='${PH_C.accentB}' stroke-opacity='0.6' stroke-width='6' stroke-linecap='round'>
    <path d='M 16 -27.7 A 32 32 0 1 1 -16 -27.7'/><line x1='0' y1='-38' x2='0' y2='-6'/>
  </g>
  ${tspans}
  <text x='150' y='${lines.length === 1 ? 134 : 150}' font-family='Segoe UI,Roboto,Helvetica,Arial,sans-serif' font-size='13' font-weight='600' letter-spacing='2' fill='${PH_C.muted}'>NO BANNER ARTWORK</text>
</svg>`);
  }

  function phAvatarSvg(name) {
    const lines = phWrap(name, 16, 2);
    const startY = 226;
    const tspans = lines.map((ln, i) =>
      `<text x='150' y='${startY + i * 24}' text-anchor='middle' font-family='Segoe UI,Roboto,Helvetica,Arial,sans-serif' font-size='17' font-weight='600' fill='${PH_C.text}'>${phEsc(ln)}</text>`
    ).join('');
    return phDataUri(
`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 300 300' preserveAspectRatio='xMidYMid slice'>
  <defs>
    <linearGradient id='ga' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='${PH_C.bg1}'/><stop offset='1' stop-color='${PH_C.bg2}'/></linearGradient>
    <radialGradient id='gla' cx='0.5' cy='0.4' r='0.6'><stop offset='0' stop-color='${PH_C.accent}' stop-opacity='0.18'/><stop offset='1' stop-color='${PH_C.accent}' stop-opacity='0'/></radialGradient>
  </defs>
  <rect width='300' height='300' fill='url(#ga)'/>
  <rect width='300' height='300' fill='url(#gla)'/>
  <rect x='6' y='6' width='288' height='288' rx='12' fill='none' stroke='${PH_C.line}' stroke-width='1.5'/>
  <g transform='translate(150,122)' fill='none' stroke='${PH_C.accentB}' stroke-opacity='0.6' stroke-width='7' stroke-linecap='round'>
    <path d='M 21 -36.4 A 42 42 0 1 1 -21 -36.4'/><line x1='0' y1='-50' x2='0' y2='-8'/>
  </g>
  <text x='150' y='194' text-anchor='middle' font-family='Segoe UI,Roboto,Helvetica,Arial,sans-serif' font-size='12' font-weight='700' letter-spacing='3' fill='${PH_C.muted}'>NO AVATAR</text>
  ${tspans}
</svg>`);
  }

  function phReplace(img) {
    try {
      if (!img || img.dataset.snrPh) return;
      const src = img.currentSrc || img.src || img.getAttribute('src') || '';
      if (!phIsDefault(src)) return;
      // Default "no avatar" → square themed placeholder sized to the avatar column.
      if (phIsAvatar(src)) {
        img.dataset.snrPh = '1';
        img.onerror = null; img.removeAttribute('onerror'); img.removeAttribute('srcset');
        const name = (img.alt || '').replace(/['’]s avatar$/i, '').trim();
        const side = parseInt(img.getAttribute('width'), 10) || img.offsetWidth || img.naturalWidth || 150;
        img.src = phAvatarSvg(name);
        img.removeAttribute('height');
        img.style.setProperty('width', side + 'px', 'important');
        img.style.setProperty('height', side + 'px', 'important');
        return;
      }
      let w = img.naturalWidth || 0, h = img.naturalHeight || 0;
      if (!w || !h) { w = w || parseInt(img.getAttribute('width'), 10) || 0; h = h || parseInt(img.getAttribute('height'), 10) || 0; }
      // Aspect ratio decides poster vs banner. If we can't tell yet (image not
      // loaded, no size attributes), wait for load rather than guess wrong.
      if ((!w || !h) && !img.complete) { img.addEventListener('load', () => phReplace(img), { once: true }); return; }
      const ratio = (w && h) ? (w / h) : 1;
      const title = (img.alt || img.title || '').trim();
      img.dataset.snrPh = '1';
      // Kill the site's onerror fallback + any srcset first, so the swap sticks.
      img.onerror = null; img.removeAttribute('onerror'); img.removeAttribute('srcset');
      img.src = ratio <= 0.85 ? phPosterSvg(title) : phBannerSvg(title);
    } catch (e) {}
  }

  function runPlaceholders() {
    const scan = (root) => {
      const list = (root && root.querySelectorAll) ? root.querySelectorAll('img') : [];
      list.forEach(phReplace);
      if (root && root.tagName === 'IMG') phReplace(root);
    };
    scan(document);
    // Some default imgs report naturalWidth 0 until they load — re-check on load.
    document.querySelectorAll('img').forEach(img => {
      if (img.dataset.snrPh) return;
      const src = img.currentSrc || img.src || '';
      if (phIsDefault(src) && !img.complete) img.addEventListener('load', () => phReplace(img), { once: true });
    });
    // Catch AJAX / cover-view / lazy content.
    try {
      const obs = new MutationObserver((muts) => {
        muts.forEach(m => m.addedNodes && m.addedNodes.forEach(n => {
          if (n.nodeType !== 1) return;
          if (n.tagName === 'IMG') phReplace(n);
          else if (n.querySelectorAll) n.querySelectorAll('img').forEach(phReplace);
        }));
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) {}
  }

  /* =========================================================================
   * FEATURE: Requests Panel (series page)
   *   The Requests block is a <table class="border"> whose header row is a
   *   colhead reading "Request Name … Requested on". When empty its body just
   *   says "Nothing found!" — hide the whole table (and any leading heading)
   *   then. When it holds open requests, redraw the rows as a native-looking
   *   .box/.head/.pad panel with the requests laid out as a 3-up card grid,
   *   instead of leaving the bare unstyled table in place.
   * =======================================================================*/
  function runRequestsPanel() {
    injectCss('snr-requests-style', `
      .snr-req-grid{ display:grid; grid-template-columns:repeat(3, 1fr); gap:12px; }
      .snr-req-card{
        position:relative; display:flex; flex-direction:column; align-items:center; gap:10px;
        padding:14px 16px 12px; text-align:center; background:var(--panel-2,var(--panel));
        border:1px solid var(--line); border-radius:var(--radius-sm);
        transition:border-color .15s, background .15s, transform .15s;
      }
      .snr-req-card::before{
        content:""; position:absolute; left:0; right:0; top:0; height:3px;
        border-radius:var(--radius-sm) var(--radius-sm) 0 0;
        background:var(--grad-accent); opacity:.85;
      }
      .snr-req-card:hover{
        border-color:var(--line-2); background:rgba(63,200,255,.05); transform:translateY(-1px);
      }
      .snr-req-name{ font-family:var(--fd); font-weight:600; font-size:13px; color:var(--text); line-height:1.4; }
      .snr-req-name a{ color:var(--accent-bright,#3fc8ff); }
      .snr-req-stats{ display:flex; flex-wrap:wrap; justify-content:center; gap:14px; }
      .snr-req-stat{ display:flex; flex-direction:column; align-items:center; gap:2px; }
      .snr-req-lbl{ font-size:10.5px; text-transform:uppercase; letter-spacing:.04em; color:var(--text-2); }
      .snr-req-val{ font-size:12.5px; font-weight:500; color:var(--text-1); }
      .snr-req-date{
        width:100%; margin-top:auto; padding-top:8px; border-top:1px solid var(--line-soft);
        font-size:11.5px; color:var(--text-2);
      }
      @media (max-width:900px){ .snr-req-grid{ grid-template-columns:repeat(2, 1fr); } }
      @media (max-width:600px){ .snr-req-grid{ grid-template-columns:1fr; } }
    `);

    let touched = false;
    document.querySelectorAll('.main_column table.border').forEach(t => {
      if (t.dataset.snrReq) return;
      const head = t.querySelector('tr.colhead_dark, tr.colhead');
      if (!head || !/request\s*name/i.test(head.textContent || '')) return;
      t.dataset.snrReq = '1';

      // a leading section heading, if one sits right before the table
      const prev = t.previousElementSibling;
      const hasPrevHead = prev && /request/i.test(prev.textContent || '') &&
        (prev.classList.contains('head') || /head/i.test(prev.className || ''));

      if (/nothing found/i.test(t.textContent || '')) {
        t.style.display = 'none';
        if (hasPrevHead) prev.style.display = 'none';
        touched = true;
        return;
      }

      const rows = Array.from(t.querySelectorAll('tr')).filter(r => r !== head);
      const cards = rows.map(r => {
        const c = r.querySelectorAll('td');
        if (c.length < 5) return '';
        return `<div class="snr-req-card">` +
          `<div class="snr-req-name">${c[0].innerHTML}</div>` +
          `<div class="snr-req-stats">` +
            `<div class="snr-req-stat"><span class="snr-req-lbl">Vote</span><span class="snr-req-val">${c[1].innerHTML}</span></div>` +
            `<div class="snr-req-stat"><span class="snr-req-lbl">Bounty</span><span class="snr-req-val">${c[2].innerHTML}</span></div>` +
            `<div class="snr-req-stat"><span class="snr-req-lbl">Comments</span><span class="snr-req-val">${c[3].innerHTML}</span></div>` +
          `</div>` +
          `<div class="snr-req-date">${c[4].innerHTML}</div>` +
        `</div>`;
      }).join('');
      if (!cards) return;

      const box = document.createElement('div');
      box.className = 'box snr-req-box';
      box.innerHTML =
        `<div class="head">${hasPrevHead ? prev.innerHTML : 'Requests'}</div>` +
        `<div class="pad snr-req-grid">${cards}</div>`;

      t.replaceWith(box);
      if (hasPrevHead) prev.remove();
      touched = true;
    });
    return touched;
  }

  /* =========================================================================
   * FEATURE: Series Action Glyph Bar (series page)
   *   The action row under the banner is a plain-text .linkbox
   *   ("[Notify of New Uploads]" etc, a direct child of .thin). Move it to
   *   the top of the sidebar, styled as a compact header bar, and redraw
   *   each link as an icon with a hover tooltip instead of bracketed text.
   *   A MutationObserver keeps re-labelling links whose text the site
   *   rewrites after an AJAX toggle (e.g. Favorite/Notify state changes).
   * =======================================================================*/
  const SNR_ACTION_GLYPHS = [
    [/notify/i, 'bell'],
    [/favorite/i, 'star'],
    [/autofill/i, 'wand'],
    [/^edit$/i, 'pencil'],
    [/history/i, 'clock']
  ];
  function snrRelabelAction(a) {
    const label = (a.textContent || '').replace(/[[\]]/g, '').trim();
    if (!label) return;
    a.title = label;
    a.setAttribute('aria-label', label);
    a.setAttribute('data-tip', label);
    const hit = SNR_ACTION_GLYPHS.find(([re]) => re.test(label));
    a.dataset.glyph = hit ? hit[1] : 'dot';
    a.textContent = '';
  }
  function runSeriesActionBar() {
    const linkbox = document.querySelector('#content .thin>.linkbox');
    const sidebar = document.querySelector('#content .thin>.sidebar');
    if (!linkbox || !sidebar || linkbox.dataset.snrBar) return false;
    const links = Array.from(linkbox.querySelectorAll('a'));
    if (!links.length) return false;
    linkbox.dataset.snrBar = '1';

    links.forEach(snrRelabelAction);
    linkbox.classList.add('snr-action-bar');
    sidebar.prepend(linkbox);
    // .linkbox no longer sits in the banner/table grid — collapse the row it left behind.
    document.body.classList.add('snr-actionbar-on');

    try {
      const mo = new MutationObserver(() => {
        links.forEach(a => { if (a.textContent) snrRelabelAction(a); });
      });
      mo.observe(linkbox, { childList: true, subtree: true, characterData: true });
    } catch (e) {}

    return true;
  }

  /* =========================================================================
   * FEATURE: Collage Action Glyph Bar (collage page)
   *   The action row above the two-column layout is a plain-text .linkbox
   *   ("[List of collages]" etc, a direct child of .thin, same shape as the
   *   series-page action row). Move it to the top of the sidebar and redraw
   *   it icon-only, same treatment as the Series Action Glyph Bar. Collage
   *   pages use an auto-row grid, so removing .linkbox leaves no gap to
   *   collapse (unlike the series page's fixed row template).
   * =======================================================================*/
  const SNR_COLLAGE_GLYPHS = [
    [/list of collages/i, 'list'],
    [/new collage/i, 'plus'],
    [/edit description/i, 'pencil'],
    [/manage torrents/i, 'sliders']
  ];
  function snrRelabelCollageAction(a) {
    const label = (a.textContent || '').replace(/[[\]]/g, '').trim();
    if (!label) return;
    a.title = label;
    a.setAttribute('aria-label', label);
    a.setAttribute('data-tip', label);
    const hit = SNR_COLLAGE_GLYPHS.find(([re]) => re.test(label));
    a.dataset.glyph = hit ? hit[1] : 'dot';
    a.textContent = '';
  }
  function runCollageActionBar() {
    const linkbox = document.querySelector('body#collages #content>.thin>.linkbox');
    const sidebar = document.querySelector('body#collages #content>.thin>.sidebar');
    if (!linkbox || !sidebar || linkbox.dataset.snrBar) return false;
    const links = Array.from(linkbox.querySelectorAll('a'));
    if (!links.length) return false;
    linkbox.dataset.snrBar = '1';

    links.forEach(snrRelabelCollageAction);
    linkbox.classList.add('snr-action-bar');
    sidebar.prepend(linkbox);

    try {
      const mo = new MutationObserver(() => {
        links.forEach(a => { if (a.textContent) snrRelabelCollageAction(a); });
      });
      mo.observe(linkbox, { childList: true, subtree: true, characterData: true });
    } catch (e) {}

    return true;
  }

  /* =========================================================================
   * FEATURE: Enhanced Series Hero (series page)
   *   Replace BTN's native graphical banner with a compact TMDb-backed hero,
   *   keeping the exact banner grid slot so the rest of the page does not move.
   * =======================================================================*/
  function heroYearRange(tv) {
    const y1 = (tv && tv.first_air_date || '').slice(0, 4);
    const y2 = (tv && tv.last_air_date || '').slice(0, 4);
    if (!y1) return '';
    if (!y2 || y2 === y1 || /return|airing|production/i.test(tv.status || '')) return y1 + '-';
    return y1 + '-' + y2;
  }

  function heroDate(iso) {
    if (!iso) return '';
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d.getTime())) return iso;
    try { return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
    catch (e) { return iso; }
  }

  function heroContentRating(tv) {
    const rows = (tv && tv.content_ratings && tv.content_ratings.results) || [];
    for (const cc of ['GB', 'US', 'CA', 'AU']) {
      const row = rows.find(r => r.iso_3166_1 === cc && r.rating);
      if (row) return row.rating;
    }
    return '';
  }

  function heroRuntime(tv) {
    const rt = (tv && tv.episode_run_time || []).find(n => Number(n) > 0);
    return rt ? rt + ' min eps' : '';
  }

  function heroEpisode(label, ep) {
    const box = document.createElement('div');
    box.className = 'hero-ep';
    const code = ep ? ('S' + String(ep.season_number || 0).padStart(2, '0') + 'E' + String(ep.episode_number || 0).padStart(2, '0')) : '';
    box.innerHTML =
      '<div class="lbl">' + escapeHtml(label) + '</div>' +
      '<div class="nm">' + escapeHtml((code ? code + ' - ' : '') + ((ep && ep.name) || 'Not available')) + '</div>' +
      '<div class="dt">' + escapeHtml(heroDate(ep && ep.air_date)) + '</div>';
    return box;
  }

  function heroChip(text, cls) {
    if (!text) return null;
    const s = document.createElement('span');
    s.className = 'hero-chip' + (cls ? ' ' + cls : '');
    s.textContent = text;
    return s;
  }

  function heroAction(label, href, cls) {
    const node = href ? document.createElement('a') : document.createElement('button');
    node.className = 'hero-action' + (cls ? ' ' + cls : '');
    node.textContent = label;
    if (href) {
      node.href = href;
      if (/^https?:\/\//i.test(href)) {
        node.target = '_blank';
        node.rel = 'noopener';
      }
    } else {
      node.type = 'button';
    }
    return node;
  }

  function heroNativeActions() {
    return [...document.querySelectorAll('#content .thin > .linkbox a')]
      .map(a => ({
        label: cleanText(a.textContent || '').replace(/^\[|\]$/g, ''),
        href: a.getAttribute('href') || a.href || ''
      }))
      .filter(a => a.label && a.href);
  }

  function heroSeasonEpisodes(season) {
    return ((season && season.episodes) || []).filter(ep => ep && Number(ep.episode_number) > 0);
  }

  function seasonEpisodeNativeCard() {
    return [...document.querySelectorAll('#content .thin .main_column .box, #content .thin > .box, #content .box')]
      .find(box => /^show\s+info$/i.test(cleanText(((box.querySelector(':scope > .head') || box.querySelector('.head')) || {}).textContent || '')));
  }

  function seasonEpisodeInsertTarget() {
    const native = seasonEpisodeNativeCard();
    if (native && native.parentNode) return { parent: native.parentNode, before: native, native };
    const table = document.querySelector('#content .thin .main_column table.torrent_table') ||
                  document.querySelector('#content .thin table.torrent_table');
    if (table && table.parentNode) return { parent: table.parentNode, before: table.nextSibling, native: null };
    const main = document.querySelector('#content .thin .main_column') || document.querySelector('#content .thin');
    return main ? { parent: main, before: null, native: null } : null;
  }

  function seasonEpisodeImage(path) {
    return path ? 'https://image.tmdb.org/t/p/w780' + path : '';
  }

  function seasonEpisodeCode(info, ep) {
    return 'S' + String((info && info.seasonNumber) || ep.season_number || 0).padStart(2, '0') +
      'E' + String(ep.episode_number || 0).padStart(2, '0');
  }

  function seasonEpisodeRating(ep) {
    const vote = Number(ep && ep.vote_average);
    return vote ? 'TMDb ' + vote.toFixed(1) : '';
  }

  function renderSeasonEpisodeCard(season, tv) {
    if (document.getElementById('snr-season-episode-card')) return true;
    const info = window.__btnSeries || seriesInfo();
    if (!info || !info.isSeasonPage) return false;
    const episodes = heroSeasonEpisodes(season);
    if (!episodes.length) return false;
    const target = seasonEpisodeInsertTarget();
    if (!target || !target.parent) return false;

    const card = document.createElement('section');
    card.id = 'snr-season-episode-card';
    card.className = 'snr';
    card.setAttribute('aria-label', 'Season episode information');
    card.innerHTML =
      '<div class="snr-sec-head">' +
        '<h2 class="snr-sec-title">Season Episodes</h2>' +
        '<span class="snr-sec-count">' + escapeHtml(episodes.length + ' episode' + (episodes.length === 1 ? '' : 's')) + '</span>' +
      '</div>' +
      '<div class="snr-sec-tabs" role="tablist" aria-label="Episodes"></div>' +
      '<div class="snr-sec-detail">' +
        '<div class="snr-sec-still"></div>' +
        '<div class="snr-sec-copy">' +
          '<div class="snr-sec-kicker"></div>' +
          '<h3 class="snr-sec-ep-title"></h3>' +
          '<div class="snr-sec-meta"></div>' +
          '<p class="snr-sec-overview"></p>' +
        '</div>' +
      '</div>';

    const tabs = card.querySelector('.snr-sec-tabs');
    const still = card.querySelector('.snr-sec-still');
    const kicker = card.querySelector('.snr-sec-kicker');
    const title = card.querySelector('.snr-sec-ep-title');
    const meta = card.querySelector('.snr-sec-meta');
    const overview = card.querySelector('.snr-sec-overview');

    const render = (ep, index) => {
      tabs.querySelectorAll('.snr-sec-tab').forEach((button, i) => {
        button.classList.toggle('active', i === index);
        button.setAttribute('aria-selected', i === index ? 'true' : 'false');
      });
      const code = seasonEpisodeCode(info, ep);
      const img = seasonEpisodeImage(ep.still_path);
      still.classList.toggle('is-empty', !img);
      still.innerHTML = img
        ? '<img loading="lazy" alt="" src="' + escapeAttr(img) + '">'
        : '<span>No still available</span>';
      kicker.textContent = code;
      title.textContent = ep.name || ('Episode ' + (ep.episode_number || index + 1));
      const chips = [
        heroDate(ep.air_date),
        ep.runtime ? ep.runtime + ' min' : heroRuntime(tv),
        seasonEpisodeRating(ep)
      ].filter(Boolean);
      meta.innerHTML = chips.map(chip => '<span class="snr-sec-chip">' + escapeHtml(chip) + '</span>').join('');
      overview.textContent = ep.overview || 'No episode synopsis is available from TMDb yet.';
    };

    episodes.forEach((ep, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'snr-sec-tab';
      button.setAttribute('role', 'tab');
      button.textContent = 'E' + String(ep.episode_number || index + 1).padStart(2, '0');
      button.title = (ep.name || 'Episode ' + (ep.episode_number || index + 1));
      button.addEventListener('click', () => render(ep, index));
      tabs.appendChild(button);
    });

    target.parent.insertBefore(card, target.before);
    if (target.native) target.native.setAttribute('data-snr-native-show-info', '1');
    document.body.classList.add('snr-season-episodes-on');
    render(episodes[0], 0);
    return true;
  }

  async function seriesHeroTmdb(path, key) {
    const url = 'https://api.themoviedb.org/3' + path + (path.indexOf('?') >= 0 ? '&' : '?') + 'api_key=' + encodeURIComponent(key);
    return fetch(url).then(r => r.json());
  }

  async function seriesHeroResolveTmdbId(info, key) {
    const findTv = async (ext, src) => {
      if (!ext) return null;
      try {
        const d = await seriesHeroTmdb('/find/' + encodeURIComponent(ext) + '?external_source=' + src, key);
        return (d && d.tv_results && d.tv_results[0] && d.tv_results[0].id) || null;
      } catch (e) { return null; }
    };
    let tmdbId = await findTv(info.imdbId, 'imdb_id');
    if (!tmdbId) tmdbId = await findTv(info.tvdbId, 'tvdb_id');
    if (!tmdbId && info.title) {
      try {
        const d = await seriesHeroTmdb('/search/tv?language=en-US&query=' + encodeURIComponent(info.title), key);
        tmdbId = (d && d.results && d.results[0] && d.results[0].id) || null;
      } catch (e) {}
    }
    return tmdbId;
  }

  // Once the TMDb hero header is up it repeats everything the native "Series
  // Summary" card shows (synopsis, rating/status/year/season chips, latest &
  // next episode, external links), so the card is just wasted space — hide it.
  function hideSeriesSummaryCard() {
    const sum = document.querySelector('#summary');
    let card = sum && sum.closest('.box');
    if (!card) {
      card = [...document.querySelectorAll('.main_column .box, #content .thin .box, #content .box')]
        .find(b => /series\s*summary|description/i.test(((b.querySelector('.head') || {}).textContent) || ''));
    }
    if (!card && sum) card = sum;
    if (card) { card.style.display = 'none'; card.setAttribute('data-snr-hidden-by-hero', '1'); }
  }

  function renderSeriesHero(tv, tmdbId, trailerKey, opts) {
    if (document.getElementById('snr-series-hero')) return true;
    const thin = document.querySelector('#content .thin');
    const options = opts || {};
    const info = window.__btnSeries || seriesInfo();
    const season = options.season || null;
    const isSeasonHero = !!(info && info.isSeasonPage);
    const native = isSeasonHero ? document.querySelector('#content .thin > h2') : document.querySelector('#content .thin > center');
    if (!thin || !native) return false;

    const banner = document.querySelector('#banner');
    const headingImg = document.querySelector('#content .thin > h2 img');
    const bannerSrc = banner ? (banner.src || banner.getAttribute('src') || '') : (headingImg ? (headingImg.src || headingImg.getAttribute('src') || '') : '');
    const showTitle = (tv && (tv.name || tv.original_name)) || info.title || 'Series';
    const title = isSeasonHero ? ((info.displayTitle || showTitle) + (info.seasonYear ? ' [' + info.seasonYear + ']' : '')) : showTitle;
    const back = tv && tv.backdrop_path ? 'https://image.tmdb.org/t/p/w1280' + tv.backdrop_path : bannerSrc;
    const hero = document.createElement('section');
    hero.id = 'snr-series-hero';
    hero.className = 'snr snr-series-hero';
    hero.setAttribute('aria-label', title + (isSeasonHero ? ' season details' : ' series details'));

    const bg = document.createElement('div');
    bg.className = 'hero-bg';
    if (back) bg.style.backgroundImage = 'url("' + String(back).replace(/"/g, '\\"') + '")';
    hero.appendChild(bg);
    hero.appendChild(document.createElement('div')).className = 'hero-shade';

    const inner = document.createElement('div');
    inner.className = 'hero-inner';
    const main = document.createElement('div');
    main.className = 'hero-main';
    main.innerHTML =
      '<div class="hero-kicker">' + (isSeasonHero ? 'Season Spotlight' : 'Series Spotlight') + '</div>' +
      '<h1 class="hero-title">' + escapeHtml(title) + '</h1>' +
      '<p class="hero-overview">' + escapeHtml((season && season.overview) || (tv && tv.overview) || 'Open the series summary for more details.') + '</p>';

    const chips = document.createElement('div');
    chips.className = 'hero-chips';
    const seasonEpisodes = heroSeasonEpisodes(season);
    const baseChips = isSeasonHero ? [
      heroChip(tv && tv.vote_average ? 'TMDb ' + Number(tv.vote_average).toFixed(1) : '', 'score'),
      heroChip(heroContentRating(tv)),
      heroChip(tv && tv.status, tv && /return|airing|production/i.test(tv.status || '') ? 'live' : ''),
      heroChip(info.seasonNumber ? 'Season ' + info.seasonNumber : ''),
      heroChip((season && season.air_date) ? heroDate(season.air_date) : (info.seasonYear || '')),
      heroChip((seasonEpisodes.length || Number(season && season.episode_count || 0)) ? ((seasonEpisodes.length || Number(season && season.episode_count || 0)) + ' eps') : ''),
      heroChip(heroRuntime(tv))
    ] : [
      heroChip(tv && tv.vote_average ? 'TMDb ' + Number(tv.vote_average).toFixed(1) : '', 'score'),
      heroChip(heroContentRating(tv)),
      heroChip(tv && tv.status, tv && /return|airing|production/i.test(tv.status || '') ? 'live' : ''),
      heroChip(heroYearRange(tv)),
      heroChip(heroRuntime(tv)),
      heroChip(tv && tv.number_of_seasons ? tv.number_of_seasons + ' season' + (tv.number_of_seasons === 1 ? '' : 's') : ''),
      heroChip(tv && tv.number_of_episodes ? tv.number_of_episodes + ' eps' : '')
    ];
    baseChips.forEach(c => { if (c) chips.appendChild(c); });
    ((tv && tv.genres) || []).slice(0, 4).forEach(g => chips.appendChild(heroChip(g.name)));
    ((tv && tv.networks) || []).slice(0, 1).forEach(n => chips.appendChild(heroChip(n.name)));
    main.appendChild(chips);

    const side = document.createElement('div');
    side.className = 'hero-side';
    const eps = document.createElement('div');
    eps.className = 'hero-episodes';
    if (isSeasonHero && seasonEpisodes.length) {
      eps.appendChild(heroEpisode('First', seasonEpisodes[0]));
      eps.appendChild(heroEpisode('Finale', seasonEpisodes[seasonEpisodes.length - 1]));
    } else {
      eps.appendChild(heroEpisode('Latest', tv && tv.last_episode_to_air));
      eps.appendChild(heroEpisode('Next', tv && tv.next_episode_to_air));
    }
    side.appendChild(eps);

    const actions = document.createElement('div');
    actions.className = 'hero-actions';
    const nativeTrailer = trailerBtnId();
    if (isEnabled('trailer') && (trailerKey || nativeTrailer)) {
      const trailer = heroAction('Play Trailer', '', 'trailer');
      trailer.addEventListener('click', e => {
        e.preventDefault();
        trailerOpen(trailerKey || nativeTrailer);
      });
      actions.appendChild(trailer);
    }
    const imdbId = (tv && tv.external_ids && tv.external_ids.imdb_id) || info.imdbId;
    const tvdbId = info.tvdbId;
    const tvdbHref = [...document.querySelectorAll('a[href*="thetvdb.com"]')]
      .map(a => a.href || '')
      .find(href => href && !/artworks\.thetvdb\.com|\/banners\//i.test(href));
    if (isSeasonHero) {
      heroNativeActions().forEach(action => actions.appendChild(heroAction(action.label, action.href, 'native')));
    }
    [
      ['Series', isSeasonHero && info.seriesHref ? info.seriesHref : ''],
      ['TMDb', tmdbId ? 'https://www.themoviedb.org/tv/' + encodeURIComponent(tmdbId) : ''],
      ['IMDb', imdbId ? 'https://www.imdb.com/title/' + encodeURIComponent(imdbId) + '/' : ''],
      ['TVDB', tvdbHref || (tvdbId ? 'https://thetvdb.com/?id=' + encodeURIComponent(tvdbId) + '&tab=series' : '')],
      ['Home', tv && tv.homepage],
      ['Trakt', imdbId ? 'https://trakt.tv/search/imdb/' + encodeURIComponent(imdbId) : '']
    ].forEach(([label, href]) => { if (href) actions.appendChild(heroAction(label, href)); });
    side.appendChild(actions);

    inner.appendChild(main);
    inner.appendChild(side);
    hero.appendChild(inner);
    if (isSeasonHero && info.seriesHref) {
      const titleEl = main.querySelector('.hero-title');
      if (titleEl) {
        titleEl.innerHTML = '<a href="' + escapeAttr(info.seriesHref) + '">' + escapeHtml(title) + '</a>';
      }
      main.classList.add('is-link');
      main.setAttribute('role', 'link');
      main.setAttribute('tabindex', '0');
      main.setAttribute('aria-label', 'Open ' + showTitle + ' series page');
      const openSeries = () => { location.href = info.seriesHref; };
      main.addEventListener('click', e => {
        if (e.target && e.target.closest && e.target.closest('a,button')) return;
        openSeries();
      });
      main.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openSeries();
        }
      });
    }
    thin.insertBefore(hero, native);
    document.body.classList.add(isSeasonHero ? 'snr-season-hero-on' : 'snr-series-hero-on');
    if (!isSeasonHero) hideSeriesSummaryCard();
    return true;
  }

  async function runSeriesHero() {
    if (document.getElementById('snr-series-hero')) return true;
    const info = window.__btnSeries || seriesInfo();
    const native = info.isSeasonPage ? document.querySelector('#content .thin > h2') : document.querySelector('#content .thin > center');
    if (!native) return false;
    const key = (getKey('trending') || '').trim();
    let tv = null, tmdbId = null, trailerKey = null, season = null;
    if (key) {
      try {
        tmdbId = await seriesHeroResolveTmdbId(info, key);
        if (tmdbId) {
          tv = await seriesHeroTmdb('/tv/' + encodeURIComponent(tmdbId) + '?language=en-US&append_to_response=content_ratings,external_ids,videos', key);
          window.__btnTmdbId = tmdbId;
          window.__btnTmdbTv = tv;
          const vids = ((tv && tv.videos && tv.videos.results) || []).filter(v => v.site === 'YouTube' && v.key);
          const pick = vids.find(v => v.type === 'Trailer' && v.official) ||
                       vids.find(v => v.type === 'Trailer') ||
                       vids.find(v => v.type === 'Teaser') || vids[0];
          trailerKey = pick ? pick.key : null;
          if (info.isSeasonPage && info.seasonNumber) {
            try {
              season = await seriesHeroTmdb('/tv/' + encodeURIComponent(tmdbId) + '/season/' + encodeURIComponent(info.seasonNumber) + '?language=en-US', key);
            } catch (e) {}
          }
        }
      } catch (e) {
        console.warn('[STMPE-Hero] TMDb hero details failed', e);
      }
    }
    const rendered = renderSeriesHero(tv, tmdbId, trailerKey, { season });
    if (info.isSeasonPage && season) renderSeasonEpisodeCard(season, tv);
    return rendered;
  }

  /* =========================================================================
   * FEATURE: Trailer Player (series page)
   *   BTN embeds trailers as a dead Flash <object>, and its page sets
   *   <meta name="referrer" content="never"> which strips the Referer and makes
   *   YouTube reject a normal embed (Error 153). We intercept the play button
   *   and open a clean pop-up iframe with referrerPolicy restored + an origin
   *   param, so it just plays. If BTN has no trailer we look one up on TMDb.
   * =======================================================================*/
  function trailerGrabId(s) {
    if (!s) return null;
    const m = String(s).match(/(?:\/v\/|\/embed\/|[?&]v=|youtu\.be\/)([\w-]{11})/);
    return m ? m[1] : null;
  }
  function trailerBtnId() {
    for (const el of document.querySelectorAll('object[data], object param[value], embed[src]')) {
      const v = el.getAttribute('data') || el.getAttribute('value') || el.getAttribute('src');
      const id = trailerGrabId(v);
      if (id) return id;
    }
    return null;
  }
  async function trailerFromTmdb() {
    const key = (getKey('trending') || '').trim(); // shared TMDb key
    if (!key) return null;
    const info = window.__btnSeries || seriesInfo();
    const findTv = async (ext, src) => {
      if (!ext) return null;
      try {
        const d = await fetch('https://api.themoviedb.org/3/find/' + encodeURIComponent(ext) +
          '?external_source=' + src + '&api_key=' + encodeURIComponent(key)).then(r => r.json());
        return (d && d.tv_results && d.tv_results[0] && d.tv_results[0].id) || null;
      } catch (e) { return null; }
    };
    try {
      let tmdbId = await findTv(info.imdbId, 'imdb_id');
      if (!tmdbId) tmdbId = await findTv(info.tvdbId, 'tvdb_id');
      if (!tmdbId) return null;
      const v = await fetch('https://api.themoviedb.org/3/tv/' + tmdbId + '/videos?api_key=' + encodeURIComponent(key)).then(r => r.json());
      const vids = (v.results || []).filter(x => x.site === 'YouTube');
      const pick = vids.find(x => x.type === 'Trailer' && x.official) ||
                   vids.find(x => x.type === 'Trailer') ||
                   vids.find(x => x.type === 'Teaser') || vids[0];
      return pick ? pick.key : null;
    } catch (e) { return null; }
  }

  let trailerEscBound = null;
  function trailerClose() {
    const ov = document.getElementById('snr-trailer-ov');
    if (ov) {
      ov.classList.remove('open');
      const f = ov.querySelector('iframe'); if (f) f.src = 'about:blank'; // stop playback
      setTimeout(() => ov.remove(), 160);
    }
    if (trailerEscBound) { document.removeEventListener('keydown', trailerEscBound); trailerEscBound = null; }
  }
  function trailerOpen(id) {
    trailerClose();
    const ov = document.createElement('div');
    ov.id = 'snr-trailer-ov'; ov.className = 'snr';
    ov.innerHTML = '<div class="snr-tr-box"><button class="snr-tr-x" title="Close (Esc)">×</button><div class="snr-tr-frame"></div></div>';
    document.body.appendChild(ov);
    const frame = ov.querySelector('.snr-tr-frame');
    if (id) {
      const ifr = document.createElement('iframe');
      // The key fix: restore a referrer (BTN forces none) + pass origin so YouTube accepts the embed.
      ifr.referrerPolicy = 'strict-origin-when-cross-origin';
      ifr.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen');
      ifr.allowFullscreen = true;
      ifr.src = 'https://www.youtube.com/embed/' + encodeURIComponent(id) +
        '?autoplay=1&rel=0&modestbranding=1&origin=' + encodeURIComponent(location.origin);
      frame.appendChild(ifr);
    } else {
      frame.innerHTML = '<div class="snr-tr-msg">No trailer found for this show.</div>';
    }
    ov.addEventListener('click', (e) => { if (e.target === ov) trailerClose(); });
    ov.querySelector('.snr-tr-x').addEventListener('click', trailerClose);
    trailerEscBound = (e) => { if (e.key === 'Escape') trailerClose(); };
    document.addEventListener('keydown', trailerEscBound);
    requestAnimationFrame(() => ov.classList.add('open'));
  }

  function runTrailer(pb) {
    if (!pb || pb.dataset.snrTrailerInit) return;
    pb.dataset.snrTrailerInit = '1';
    // BTN binds the trailer click on BOTH #banner and #playbutton (and delegates
    // on document), so we intercept any click inside the banner container. A
    // capture-phase listener on document runs before BTN's handlers, so its dead
    // Flash overlay never opens. The container only holds the banner + play
    // button, so blanket-intercepting clicks in it is safe.
    const box = pb.closest('center') || pb.closest('h2') || pb.parentElement;
    const bind = (id) => {
      document.addEventListener('click', function (e) {
        const t = e.target;
        const inBox = (box && box.contains(t)) ||
          (t && (t.id === 'banner' || t.id === 'playbutton' ||
                 (t.closest && t.closest('#banner, #playbutton'))));
        if (inBox) {
          e.preventDefault(); e.stopImmediatePropagation(); e.stopPropagation();
          trailerOpen(id);
        }
      }, true);
    };
    const btnId = trailerBtnId();
    if (btnId) { bind(btnId); return; }
    // No BTN trailer — look one up on TMDb; only hook if we actually find one,
    // so shows with no trailer keep their normal "add a trailer" behaviour.
    trailerFromTmdb().then(id => { if (id) bind(id); }).catch(() => {});
  }

  /* =========================================================================
   * FEATURE: Cast Row (series page)
   *   Save the actor links out of BTN's plain sidebar list, remove that list,
   *   and build a horizontal TMDb-powered cast row (photos + character names)
   *   above the Fan Art in the main column. Each card links to BTN's actor
   *   search page by name; the native actor-id route is deliberately avoided.
   * =======================================================================*/
  function castNorm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ''); }
  function castInitials(n) { const p = String(n || '').trim().split(/\s+/); return (((p[0] || '')[0]) || '').toUpperCase() + (((p[p.length - 1] || '')[0]) || '').toUpperCase(); }

  async function runActors() {
    if (window.__snrActors || document.getElementById('snr-cast')) return true;
    window.__snrActors = true;
    const main = document.querySelector('.main_column');
    if (!main) { window.__snrActors = false; return false; }

    // 1. Save BTN's actor names before we remove the panel. We deliberately do
    // not preserve BTN's native actor hrefs because the actor-id route is broken.
    const actorBox = [...document.querySelectorAll('.sidebar .box')]
      .find(b => /actors?/i.test((b.querySelector('.head') && b.querySelector('.head').textContent) || ''));
    const btnList = [];
    if (actorBox) {
      [...actorBox.querySelectorAll('a')].forEach(a => {
        const name = a.textContent.trim();
        if (name) btnList.push({ name });
      });
    }

    // 2. Fetch the TMDb cast (photos, character, billing order).
    let cast = [];
    const key = (getKey('trending') || '').trim();
    if (key) {
      try {
        const info = window.__btnSeries || seriesInfo();
        const findTv = async (ext, src) => {
          if (!ext) return null;
          try {
            const d = await fetch('https://api.themoviedb.org/3/find/' + encodeURIComponent(ext) +
              '?external_source=' + src + '&api_key=' + encodeURIComponent(key)).then(r => r.json());
            return (d && d.tv_results && d.tv_results[0] && d.tv_results[0].id) || null;
          } catch (e) { return null; }
        };
        let tvId = await findTv(info.imdbId, 'imdb_id');
        if (!tvId) tvId = await findTv(info.tvdbId, 'tvdb_id');
        if (tvId) {
          const c = await fetch('https://api.themoviedb.org/3/tv/' + tvId + '/credits?api_key=' + encodeURIComponent(key)).then(r => r.json());
          cast = (c && c.cast) || [];
        }
      } catch (e) { cast = []; }
    }

    // 3. Build display entries — TMDb cast if we got it, else fall back to the
    //    plain BTN list so removing the panel never leaves the user with nothing.
    let entries = [];
    if (cast.length) {
      entries = cast.slice(0, 20).map(p => ({
        name: p.name, character: p.character || '',
        photo: p.profile_path ? ('https://image.tmdb.org/t/p/w185' + p.profile_path) : null,
        href: '/actor.php?name=' + encodeURIComponent(p.name), external: false
      }));
    } else if (btnList.length) {
      entries = btnList.map(a => ({ name: a.name, character: '', photo: null, href: '/actor.php?name=' + encodeURIComponent(a.name), external: false }));
    }
    if (!entries.length) { return true; } // nothing to show; leave the page as-is

    // 4. Remove BTN's sidebar panel and build our row.
    if (actorBox) actorBox.remove();
    const box = document.createElement('div');
    box.className = 'box snr'; box.id = 'snr-cast';
    box.innerHTML = '<div class="head"><strong>Cast</strong></div>';
    const row = document.createElement('div'); row.className = 'snr-cast-row'; box.appendChild(row);
    entries.forEach(e => {
      const a = document.createElement('a');
      a.className = 'snr-cast-card'; a.href = e.href;
      a.title = e.name;
      const av = document.createElement('div'); av.className = 'snr-cast-av';
      if (e.photo) { const im = document.createElement('img'); im.loading = 'lazy'; im.alt = e.name; im.src = e.photo; av.appendChild(im); }
      else { av.textContent = castInitials(e.name); }
      const nm = document.createElement('div'); nm.className = 'snr-cast-name'; nm.textContent = e.name;
      a.appendChild(av); a.appendChild(nm);
      if (e.character) { const ch = document.createElement('div'); ch.className = 'snr-cast-char'; ch.textContent = e.character; a.appendChild(ch); }
      row.appendChild(a);
    });

    // 5. Place it above the Fan Art box (or at the end of the main column).
    const fanBox = [...main.querySelectorAll('.box')]
      .find(b => /fan\s*art/i.test((b.querySelector('.head') && b.querySelector('.head').textContent) || ''));
    if (fanBox) main.insertBefore(box, fanBox); else main.appendChild(box);
    return true;
  }

  /* =========================================================================
   * FEATURE: Season Browser (series page)
   *   A horizontal season-poster row directly below Cast. Clicking a season
   *   opens one animated episode table below the row, populated from TMDb.
   *   Season posters prefer TMDb and fall back to fanart.tv seasonposter art.
   * =======================================================================*/
  const SEASON_BROWSER_CACHE = 'btn_season_browser_cache_v1';
  const SEASON_BROWSER_TTL = 1000 * 60 * 60 * 24 * 7;

  function sbReadCache() {
    try { return JSON.parse(localStorage.getItem(SEASON_BROWSER_CACHE) || '{}') || {}; }
    catch (e) { return {}; }
  }

  function sbWriteCache(cache) {
    try { localStorage.setItem(SEASON_BROWSER_CACHE, JSON.stringify(cache)); } catch (e) {}
  }

  function sbImg(path, size) {
    return path ? 'https://image.tmdb.org/t/p/' + (size || 'w342') + path : '';
  }

  function sbDate(iso) {
    if (!iso) return '';
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d.getTime())) return iso;
    try { return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
    catch (e) { return iso; }
  }

  function sbRuntime(ep) {
    const mins = Number(ep && ep.runtime);
    return mins ? mins + ' min' : '';
  }

  function sbSeasonTitle(season) {
    if (!season) return 'Season';
    const num = Number(season.season_number || 0);
    const name = String(season.name || '').trim();
    if (name && !/^season\s+\d+$/i.test(name)) return name;
    return 'Season ' + num;
  }

  function sbSeasonCode(season) {
    return 'S' + String(Number(season && season.season_number || 0)).padStart(2, '0');
  }

  function sbPosterFallback(title, code) {
    const t = encodeURIComponent(String(title || 'Season').slice(0, 32));
    const c = encodeURIComponent(String(code || '').slice(0, 12));
    return 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 342 513%22%3E%3Cdefs%3E%3ClinearGradient id=%22g%22 x1=%220%22 x2=%221%22 y1=%220%22 y2=%221%22%3E%3Cstop stop-color=%22%23141b24%22/%3E%3Cstop offset=%221%22 stop-color=%22%23070a0e%22/%3E%3C/linearGradient%3E%3CradialGradient id=%22r%22 cx=%22.5%22 cy=%22.38%22 r=%22.58%22%3E%3Cstop stop-color=%22%233fc8ff%22 stop-opacity=%22.18%22/%3E%3Cstop offset=%221%22 stop-color=%22%233fc8ff%22 stop-opacity=%220%22/%3E%3C/radialGradient%3E%3C/defs%3E%3Crect width=%22342%22 height=%22513%22 fill=%22url(%23g)%22/%3E%3Crect width=%22342%22 height=%22513%22 fill=%22url(%23r)%22/%3E%3Crect x=%2210%22 y=%2210%22 width=%22322%22 height=%22493%22 rx=%2218%22 fill=%22none%22 stroke=%22%233a4553%22 stroke-width=%222%22/%3E%3Ctext x=%22171%22 y=%22236%22 text-anchor=%22middle%22 font-family=%22Arial,sans-serif%22 font-size=%2228%22 font-weight=%22700%22 fill=%22%23f4f7fb%22%3E' + t + '%3C/text%3E%3Ctext x=%22171%22 y=%22278%22 text-anchor=%22middle%22 font-family=%22Arial,sans-serif%22 font-size=%2218%22 font-weight=%22700%22 letter-spacing=%224%22 fill=%22%233fc8ff%22%3E' + c + '%3C/text%3E%3C/svg%3E';
  }

  async function sbTmdb(path, params) {
    const key = (getKey('trending') || '').trim();
    if (!key) throw new Error('Missing TMDb API key');
    const qs = new URLSearchParams(Object.assign({ api_key: key, language: 'en-US' }, params || {}));
    const raw = await gmGet('https://api.themoviedb.org/3' + path + '?' + qs.toString());
    return JSON.parse(raw || '{}');
  }

  async function sbTmdbId() {
    const key = (getKey('trending') || '').trim();
    if (!key) return null;
    const info = window.__btnSeries || seriesInfo();
    return seriesHeroResolveTmdbId(info, key);
  }

  /* =========================================================================
   * FEATURE: Latest Season Synopsis (series page)
   *   Quiet sidebar card under the poster. Uses TMDb's season overview when
   *   the latest real season has one, and stays hidden when TMDb is blank.
   * =======================================================================*/
  function lssLatestSeason(show) {
    const seasons = (show && show.seasons || [])
      .filter(s => Number(s && s.season_number) > 0 && Number(s && s.episode_count) > 0)
      .sort((a, b) => Number(b.season_number || 0) - Number(a.season_number || 0));
    return seasons[0] || null;
  }

  async function lssLoadShow() {
    if (window.__btnTmdbTv && Array.isArray(window.__btnTmdbTv.seasons)) {
      return window.__btnTmdbTv;
    }
    const tvId = await sbTmdbId();
    if (!tvId) return null;
    const cacheKey = 'tv:' + tvId + ':latest-season-synopsis';
    const cache = sbReadCache();
    const cached = cache[cacheKey];
    if (cached && cached.data && Date.now() - cached.t < SEASON_BROWSER_TTL) return cached.data;
    const show = await sbTmdb('/tv/' + encodeURIComponent(tvId));
    cache[cacheKey] = { t: Date.now(), data: show };
    sbWriteCache(cache);
    return show;
  }

  function lssFindPosterCard(sidebar) {
    const info = window.__btnSeries || seriesInfo();
    const title = String((info && info.title) || '').trim().toLowerCase();
    const boxes = [...sidebar.querySelectorAll(':scope > .box')]
      .filter(b => b && b.id !== 'snr-fanart-logo' && b.id !== 'snr-inline' && b.id !== 'snr-latest-season-synopsis');
    const isExcluded = text => /sonarr|series info|latest episode|next episode|genres|fan art|buy stamps|parents guide/i.test(text || '');
    const isPosterish = box => {
      const head = (box.querySelector('.head') || {}).textContent || '';
      if (isExcluded(head)) return false;
      const img = box.querySelector('img');
      if (!img) return false;
      const src = img.currentSrc || img.src || img.getAttribute('src') || '';
      const w = Number(img.getAttribute('width') || img.naturalWidth || img.offsetWidth || 0);
      const h = Number(img.getAttribute('height') || img.naturalHeight || img.offsetHeight || 0);
      return /\/(?:posters?|v4\/series)\//i.test(src) || (h && w && h > w * 1.15) || (title && head.toLowerCase().includes(title));
    };
    return boxes.find(isPosterish) || boxes.find(b => b.querySelector('img') && !isExcluded((b.querySelector('.head') || {}).textContent || '')) || null;
  }

  function lssInsert(box) {
    const sidebar = document.querySelector('#content > div.thin > div.sidebar') || document.querySelector('div.sidebar') || document.querySelector('.sidebar');
    if (!sidebar) return false;
    const poster = lssFindPosterCard(sidebar);
    if (poster && poster.parentElement) poster.insertAdjacentElement('afterend', box);
    else {
      const anchor = snrSidebarPinnedAnchor(sidebar);
      if (anchor) anchor.insertAdjacentElement('afterend', box);
      else sidebar.insertBefore(box, sidebar.firstElementChild);
    }
    return true;
  }

  function lssCss() {
    injectCss('snr-latest-season-synopsis-style', `
      #snr-latest-season-synopsis{
        position:relative; overflow:hidden; cursor:pointer;
        background:linear-gradient(180deg,rgba(18,23,31,.96),rgba(7,10,14,.94));
      }
      #snr-latest-season-synopsis::before{
        content:""; position:absolute; left:0; top:0; bottom:0; width:3px;
        background:linear-gradient(180deg,#7fdcff,#3fc8ff 54%,#1f9dff);
        box-shadow:0 0 18px rgba(63,200,255,.42);
        z-index:2; pointer-events:none;
      }
      #snr-latest-season-synopsis .snr-lss-head{
        position:relative; display:block; padding:13px 40px 13px 18px;
        border-bottom:0; background:linear-gradient(180deg,rgba(255,255,255,.035),rgba(255,255,255,0));
        user-select:none;
      }
      #snr-latest-season-synopsis .snr-lss-kicker{
        margin:0 0 5px; color:var(--accent-bright,#3fc8ff); font-size:10px; line-height:1;
        font-weight:850; letter-spacing:.14em; text-transform:uppercase;
      }
      #snr-latest-season-synopsis .snr-lss-title{
        margin:0 0 8px; color:var(--text,#f4f7fb); font-family:var(--fd,inherit);
        font-size:14px; font-weight:850; line-height:1.25;
      }
      #snr-latest-season-synopsis .snr-lss-meta{
        color:var(--text-3,#7d8794); font-size:11px; font-weight:700; margin-left:4px;
      }
      #snr-latest-season-synopsis .snr-lss-toggle{
        position:absolute; right:15px; top:50%; transform:translateY(-50%) rotate(0deg);
        color:var(--accent-bright,#3fc8ff); font-size:14px; line-height:1;
        transition:transform .22s ease, color .16s ease;
      }
      #snr-latest-season-synopsis.open .snr-lss-toggle{ transform:translateY(-50%) rotate(90deg); color:#fff; }
      #snr-latest-season-synopsis .snr-lss-panel{
        max-height:0; opacity:0; overflow:hidden; border-top:1px solid transparent;
        transition:max-height .28s ease, opacity .18s ease, border-color .18s ease;
      }
      #snr-latest-season-synopsis.open .snr-lss-panel{
        max-height:420px; opacity:1; border-top-color:rgba(255,255,255,.07);
      }
      #snr-latest-season-synopsis .snr-lss-body{ padding:13px 16px 15px 18px; }
      #snr-latest-season-synopsis .snr-lss-copy{
        margin:0; color:var(--text-2,#9aa4b2); font-size:12px; line-height:1.5;
      }
      #snr-latest-season-synopsis:hover .snr-lss-title{ color:#fff; }
    `);
  }

  async function runLatestSeasonSynopsis() {
    if (window.__snrLatestSeasonSynopsis || document.getElementById('snr-latest-season-synopsis')) return true;
    const sidebar = document.querySelector('#content > div.thin > div.sidebar') || document.querySelector('div.sidebar') || document.querySelector('.sidebar');
    if (!sidebar) return false;
    window.__snrLatestSeasonSynopsis = true;
    const key = (getKey('trending') || '').trim();
    if (!key) return true;
    let show = null;
    try { show = await lssLoadShow(); }
    catch (e) { console.warn('[STMPE-LatestSeason] synopsis failed', e); return true; }
    const season = lssLatestSeason(show);
    const overview = String((season && season.overview) || '').trim();
    if (!season || !overview) return true;

    lssCss();
    const box = document.createElement('div');
    box.className = 'box snr';
    box.id = 'snr-latest-season-synopsis';
    box.innerHTML =
      '<div class="head snr-lss-head" role="button" tabindex="0" aria-expanded="false">' +
        '<div class="snr-lss-kicker">Latest Season</div>' +
        '<div class="snr-lss-title">' + escapeHtml(sbSeasonTitle(season)) +
          '<span class="snr-lss-meta">' + escapeHtml([sbDate(season.air_date), Number(season.episode_count || 0) ? Number(season.episode_count || 0) + ' eps' : ''].filter(Boolean).join(' · ')) + '</span></div>' +
        '<span class="snr-lss-toggle" aria-hidden="true">›</span>' +
      '</div>' +
      '<div class="snr-lss-panel">' +
        '<div class="snr-lss-body"><p class="snr-lss-copy">' + escapeHtml(overview) + '</p></div>' +
      '</div>';
    const toggle = () => {
      const open = box.classList.toggle('open');
      const head = box.querySelector('.snr-lss-head');
      if (head) head.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    box.addEventListener('click', toggle);
    box.querySelector('.snr-lss-head').addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      e.stopPropagation();
      toggle();
    });
    return lssInsert(box);
  }

  function sbFanartSeasonPosters(data) {
    const map = {};
    const rows = (data && data.seasonposter) || [];
    rows.filter(Boolean).forEach(item => {
      const n = String(item.season || '').replace(/^0+/, '') || String(item.season || '');
      if (!n || !item.url) return;
      const cur = map[n];
      const score = (item.lang === 'en' ? 10000 : item.lang === '00' ? 9000 : 0) + Number(item.likes || 0);
      if (!cur || score > cur.score) map[n] = { url: item.url, score };
    });
    Object.keys(map).forEach(k => { map[k] = map[k].url; });
    return map;
  }

  async function sbLoadFanartPosters() {
    const key = (getKey('fanart') || '').trim();
    if (!key) return {};
    let tvdbId = null;
    try { tvdbId = await resolveTvdbId(); } catch (e) {}
    if (!tvdbId) return {};
    try {
      const raw = await gmGet('https://webservice.fanart.tv/v3/tv/' + encodeURIComponent(tvdbId) + '?api_key=' + encodeURIComponent(key));
      return sbFanartSeasonPosters(JSON.parse(raw || '{}'));
    } catch (e) { return {}; }
  }

  async function sbLoadShow() {
    const tvId = await sbTmdbId();
    if (!tvId) return null;
    const key = 'tv:' + tvId;
    const cache = sbReadCache();
    const cached = cache[key];
    if (cached && cached.data && Date.now() - cached.t < SEASON_BROWSER_TTL) return cached.data;
    const show = await sbTmdb('/tv/' + encodeURIComponent(tvId), { append_to_response: 'external_ids' });
    const fanartPosters = await sbLoadFanartPosters();
    const seasons = (show.seasons || [])
      .filter(s => Number(s.season_number) > 0 && Number(s.episode_count) > 0)
      .map(s => {
        const n = String(Number(s.season_number));
        return {
          season_number: Number(s.season_number),
          name: s.name || ('Season ' + n),
          overview: s.overview || '',
          air_date: s.air_date || '',
          episode_count: Number(s.episode_count || 0),
          poster: sbImg(s.poster_path, 'w342') || fanartPosters[n] || ''
        };
      });
    if (seasons.length < 1) return null;
    const data = {
      id: show.id || tvId,
      name: show.name || show.original_name || '',
      seasons
    };
    cache[key] = { t: Date.now(), data };
    sbWriteCache(cache);
    return data;
  }

  async function sbLoadEpisodes(tvId, seasonNumber) {
    const key = 'tv:' + tvId + ':s:' + seasonNumber;
    const cache = sbReadCache();
    const cached = cache[key];
    if (cached && cached.data && Date.now() - cached.t < SEASON_BROWSER_TTL) return cached.data;
    const s = await sbTmdb('/tv/' + encodeURIComponent(tvId) + '/season/' + encodeURIComponent(seasonNumber));
    const data = {
      season_number: Number(s.season_number || seasonNumber),
      name: s.name || ('Season ' + seasonNumber),
      overview: s.overview || '',
      air_date: s.air_date || '',
      poster: sbImg(s.poster_path, 'w342'),
      episodes: (s.episodes || []).map(ep => ({
        episode_number: Number(ep.episode_number || 0),
        name: ep.name || '',
        air_date: ep.air_date || '',
        runtime: ep.runtime || '',
        vote_average: ep.vote_average || 0,
        overview: ep.overview || ''
      }))
    };
    cache[key] = { t: Date.now(), data };
    sbWriteCache(cache);
    return data;
  }

  function sbInsertAfterCast(box) {
    const main = document.querySelector('.main_column');
    if (!main) return false;
    const castBox = document.getElementById('snr-cast');
    if (castBox && castBox.parentElement) {
      castBox.insertAdjacentElement('afterend', box);
      return true;
    }
    const fanBox = [...main.querySelectorAll('.box')]
      .find(b => /fan\s*art/i.test((b.querySelector('.head') && b.querySelector('.head').textContent) || ''));
    if (fanBox) main.insertBefore(box, fanBox);
    else main.appendChild(box);
    return true;
  }

  function sbCss() {
    injectCss('snr-season-browser-style', `
      #snr-season-browser .snr-sb-body{ padding:14px 16px 16px; }
      #snr-season-browser .snr-sb-row{ display:flex; gap:14px; overflow-x:auto; padding:0 0 12px; scrollbar-width:thin; scrollbar-color:var(--line-2,#2d333c) transparent; }
      #snr-season-browser .snr-sb-row::-webkit-scrollbar{ height:8px; }
      #snr-season-browser .snr-sb-row::-webkit-scrollbar-thumb{ background:var(--line-2,#2d333c); border-radius:4px; }
      #snr-season-browser .snr-sb-season{ flex:0 0 118px; width:118px; padding:0; color:var(--text-1,#cdd4de); background:transparent; border:0; text-align:left; cursor:pointer; }
      #snr-season-browser .snr-sb-season:focus{ outline:none; }
      #snr-season-browser .snr-sb-poster{ width:118px; height:177px; border-radius:9px; overflow:hidden; background:var(--bg-3,#181c22); border:1px solid var(--line,#232830); box-shadow:0 4px 12px rgba(0,0,0,.38); transition:transform .14s, border-color .14s, box-shadow .14s; }
      #snr-season-browser .snr-sb-poster img{ display:block; width:100%; height:100%; object-fit:cover; }
      #snr-season-browser .snr-sb-season:hover .snr-sb-poster,
      #snr-season-browser .snr-sb-season.active .snr-sb-poster{ transform:translateY(-3px); border-color:var(--accent,#1f9dff); box-shadow:0 12px 26px rgba(0,0,0,.55); }
      #snr-season-browser .snr-sb-title{ margin-top:8px; color:var(--text,#f4f7fb); font-size:12px; font-weight:700; line-height:1.25; overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }
      #snr-season-browser .snr-sb-meta{ margin-top:3px; color:var(--text-3,#7d8794); font-size:11px; line-height:1.25; }
      #snr-season-browser .snr-sb-season:hover .snr-sb-title,
      #snr-season-browser .snr-sb-season.active .snr-sb-title{ color:var(--accent-bright,#3fc8ff); }
      #snr-season-browser .snr-sb-panel{ max-height:0; opacity:0; overflow:hidden; border-top:1px solid transparent; transition:max-height .28s ease, opacity .18s ease, border-color .18s ease, margin-top .18s ease; }
      #snr-season-browser .snr-sb-panel.open{ max-height:760px; opacity:1; margin-top:2px; border-top-color:var(--line,#232830); }
      #snr-season-browser .snr-sb-detail{ padding-top:14px; }
      #snr-season-browser .snr-sb-detail-head{ display:flex; align-items:flex-end; justify-content:space-between; gap:14px; margin-bottom:10px; }
      #snr-season-browser .snr-sb-detail-title{ color:#fff; font-family:var(--fd,inherit); font-size:15px; font-weight:800; line-height:1.2; }
      #snr-season-browser .snr-sb-detail-sub{ color:var(--text-3,#7d8794); font-size:11.5px; margin-top:3px; }
      #snr-season-browser .snr-sb-close{ flex:0 0 auto; width:28px; height:28px; border-radius:8px; border:1px solid var(--line-2,#2d333c); background:rgba(255,255,255,.035); color:var(--accent-bright,#3fc8ff); cursor:pointer; line-height:1; }
      #snr-season-browser .snr-sb-close:hover{ color:#fff; border-color:var(--accent,#1f9dff); }
      #snr-season-browser .snr-sb-table-wrap{ max-height:560px; overflow:auto; border:1px solid var(--line,#232830); border-radius:10px; background:rgba(255,255,255,.018); }
      #snr-season-browser table.snr-sb-table{ width:100%; border-collapse:collapse; table-layout:auto; }
      #snr-season-browser .snr-sb-table th,
      #snr-season-browser .snr-sb-table td{ padding:9px 10px; border-bottom:1px solid rgba(255,255,255,.06); vertical-align:top; color:var(--text-1,#cdd4de); font-size:12px; line-height:1.4; }
      #snr-season-browser .snr-sb-table tr:last-child td{ border-bottom:0; }
      #snr-season-browser .snr-sb-table th{ color:var(--text,#f4f7fb); font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:.06em; background:rgba(255,255,255,.025); }
      #snr-season-browser .snr-sb-table th:first-child,
      #snr-season-browser .snr-sb-table td:first-child{ width:1%; padding-left:14px; padding-right:26px; text-align:left; white-space:nowrap; }
      #snr-season-browser .snr-sb-table th:nth-child(2),
      #snr-season-browser .snr-sb-table td:nth-child(2){ width:auto; text-align:left; }
      #snr-season-browser .snr-sb-table th:nth-child(3),
      #snr-season-browser .snr-sb-table td:nth-child(3),
      #snr-season-browser .snr-sb-table th:nth-child(4),
      #snr-season-browser .snr-sb-table td:nth-child(4){ width:1%; padding-left:28px; padding-right:16px; text-align:right; white-space:nowrap; }
      #snr-season-browser .snr-sb-epno{ color:var(--accent-bright,#3fc8ff) !important; font-weight:800; }
      #snr-season-browser .snr-sb-date{ color:var(--text-2,#9aa4b2) !important; }
      #snr-season-browser .snr-sb-runtime{ color:var(--text-3,#7d8794) !important; }
      #snr-season-browser .snr-sb-epname{ color:#fff !important; font-weight:700; }
      #snr-season-browser .snr-sb-overview{ margin-top:3px; color:var(--text-2,#9aa4b2); font-size:11.5px; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
      #snr-season-browser .snr-sb-status{ padding:14px; color:var(--text-2,#9aa4b2); font-size:12.5px; }
      @media (max-width:760px){
        #snr-season-browser .snr-sb-season{ flex-basis:96px; width:96px; }
        #snr-season-browser .snr-sb-poster{ width:96px; height:144px; }
        #snr-season-browser .snr-sb-date,
        #snr-season-browser .snr-sb-runtime{ display:none; }
      }
    `);
  }

  function sbEpisodeRow(ep, seasonNumber) {
    const se = 'S' + String(seasonNumber).padStart(2, '0') + 'E' + String(ep.episode_number || 0).padStart(2, '0');
    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td class="snr-sb-epno">' + escapeHtml(se) + '</td>' +
      '<td><div class="snr-sb-epname">' + escapeHtml(ep.name || 'Episode ' + ep.episode_number) + '</div>' +
        (ep.overview ? '<div class="snr-sb-overview">' + escapeHtml(ep.overview) + '</div>' : '') + '</td>' +
      '<td class="snr-sb-date">' + escapeHtml(sbDate(ep.air_date)) + '</td>' +
      '<td class="snr-sb-runtime">' + escapeHtml(sbRuntime(ep)) + '</td>';
    return tr;
  }

  function sbRenderEpisodes(panel, show, season, data) {
    const title = sbSeasonTitle(season);
    panel.innerHTML =
      '<div class="snr-sb-detail">' +
        '<div class="snr-sb-detail-head">' +
          '<div><div class="snr-sb-detail-title">' + escapeHtml(title) + '</div>' +
          '<div class="snr-sb-detail-sub">' + escapeHtml([sbDate(data.air_date || season.air_date), (data.episodes || []).length + ' episodes'].filter(Boolean).join(' · ')) + '</div></div>' +
          '<button type="button" class="snr-sb-close" title="Close">×</button>' +
        '</div>' +
        '<div class="snr-sb-table-wrap"><table class="snr-sb-table"><thead><tr><th>Episode</th><th>Title</th><th>Air date</th><th>Runtime</th></tr></thead><tbody></tbody></table></div>' +
      '</div>';
    const tbody = panel.querySelector('tbody');
    const episodes = data.episodes || [];
    if (episodes.length) episodes.forEach(ep => tbody.appendChild(sbEpisodeRow(ep, season.season_number)));
    else tbody.innerHTML = '<tr><td colspan="4" class="snr-sb-status">No episodes listed for this season.</td></tr>';
    panel.querySelector('.snr-sb-close').addEventListener('click', () => {
      panel.classList.remove('open');
      panel.closest('#snr-season-browser')?.querySelectorAll('.snr-sb-season.active').forEach(b => b.classList.remove('active'));
    });
  }

  async function runSeasonBrowser() {
    if (window.__snrSeasonBrowser || document.getElementById('snr-season-browser')) return true;
    const main = document.querySelector('.main_column');
    if (!main) return false;
    if (isEnabled('actors') && !document.getElementById('snr-cast')) {
      window.__snrSeasonBrowserWaits = (window.__snrSeasonBrowserWaits || 0) + 1;
      if (window.__snrSeasonBrowserWaits < 20) { setTimeout(runSeasonBrowser, 300); return true; }
    }

    window.__snrSeasonBrowser = true;
    const key = (getKey('trending') || '').trim();
    if (!key) return true;

    let show = null;
    try { show = await sbLoadShow(); }
    catch (e) { console.warn('[STMPE-Seasons] season browser failed', e); return true; }
    if (!show || !show.seasons || !show.seasons.length) return true;

    sbCss();
    const box = document.createElement('div');
    box.className = 'box snr';
    box.id = 'snr-season-browser';
    box.innerHTML = '<div class="head"><strong>Seasons Browser</strong></div><div class="snr-sb-body"><div class="snr-sb-row"></div><div class="snr-sb-panel"></div></div>';
    const row = box.querySelector('.snr-sb-row');
    const panel = box.querySelector('.snr-sb-panel');

    show.seasons.forEach(season => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'snr-sb-season';
      btn.innerHTML =
        '<div class="snr-sb-poster"><img loading="lazy" alt="" src="' + escapeAttr(season.poster || sbPosterFallback(sbSeasonTitle(season), sbSeasonCode(season))) + '"></div>' +
        '<div class="snr-sb-title">' + escapeHtml(sbSeasonTitle(season)) + '</div>' +
        '<div class="snr-sb-meta">' + escapeHtml([season.episode_count + ' eps', sbDate(season.air_date)].filter(Boolean).join(' · ')) + '</div>';
      btn.addEventListener('click', async () => {
        const wasActive = btn.classList.contains('active') && panel.classList.contains('open');
        row.querySelectorAll('.snr-sb-season.active').forEach(b => b.classList.remove('active'));
        if (wasActive) { panel.classList.remove('open'); return; }
        btn.classList.add('active');
        panel.innerHTML = '<div class="snr-sb-status">Loading ' + escapeHtml(sbSeasonTitle(season)) + '…</div>';
        panel.classList.add('open');
        try {
          const data = await sbLoadEpisodes(show.id, season.season_number);
          sbRenderEpisodes(panel, show, season, data);
          panel.classList.add('open');
        } catch (e) {
          panel.innerHTML = '<div class="snr-sb-status">Could not load episodes for this season.</div>';
          panel.classList.add('open');
        }
      });
      row.appendChild(btn);
    });

    return sbInsertAfterCast(box);
  }

  /* =========================================================================
   * FEATURE: Similar Shows (series page)
   *   A horizontal poster row (TMDb recommendations, falling back to /similar)
   *   in a card placed directly BELOW the Cast card. Every poster links to a
   *   BTN series search by NAME via /series.php?name= — the ID route is
   *   deliberately avoided because TMDb ↔ BTN ids don't reliably line up.
   * =======================================================================*/
  function similarSearchHref(d) {
    const name = d.name || d.original_name || '';
    return '/series.php?name=' + encodeURIComponent(name);
  }

  async function runSimilar() {
    if (window.__snrSimilar || document.getElementById('snr-similar')) return;
    const main = document.querySelector('.main_column');
    if (!main) return;

    // Prefer to sit directly below the Cast card. If the cast row is enabled but
    // hasn't been built yet, self-reschedule a few times so we land below it
    // rather than above — but never wait forever.
    if (isEnabled('actors') && !document.getElementById('snr-cast')) {
      window.__snrSimilarWaits = (window.__snrSimilarWaits || 0) + 1;
      if (window.__snrSimilarWaits < 20) { setTimeout(runSimilar, 300); return; }
    }

    window.__snrSimilar = true; // claim the slot so we don't double-run

    const key = (getKey('trending') || '').trim();
    if (!key) return; // needs the TMDb key

    let shows = [];
    try {
      const info = window.__btnSeries || seriesInfo();
      const findTv = async (ext, src) => {
        if (!ext) return null;
        try {
          const d = await fetch('https://api.themoviedb.org/3/find/' + encodeURIComponent(ext) +
            '?external_source=' + src + '&api_key=' + encodeURIComponent(key)).then(r => r.json());
          return (d && d.tv_results && d.tv_results[0] && d.tv_results[0].id) || null;
        } catch (e) { return null; }
      };
      let tvId = await findTv(info.imdbId, 'imdb_id');
      if (!tvId) tvId = await findTv(info.tvdbId, 'tvdb_id');
      if (!tvId) return true;

      const grab = async (kind) => {
        try {
          const d = await fetch('https://api.themoviedb.org/3/tv/' + tvId + '/' + kind +
            '?api_key=' + encodeURIComponent(key) + '&language=en-US&page=1').then(r => r.json());
          return (d && d.results) || [];
        } catch (e) { return []; }
      };
      // Recommendations are usually the closest match; fall back to /similar.
      shows = await grab('recommendations');
      if (!shows.length) shows = await grab('similar');
    } catch (e) { shows = []; }

    // Keep entries that have a poster + a title; dedupe by name; cap the row.
    const seen = {};
    shows = shows
      .filter(d => d && d.poster_path && (d.name || d.original_name))
      .filter(d => { const k = (d.name || d.original_name).toLowerCase(); if (seen[k]) return false; seen[k] = 1; return true; })
      .slice(0, 18);
    if (!shows.length) return true; // nothing worth showing

    injectCss('snr-similar-style', `
      #snr-similar .snr-sim-row{ display:flex; gap:14px; overflow-x:auto; padding:14px 16px 16px; scrollbar-width:thin; scrollbar-color:var(--line-2,#2d333c) transparent; }
      #snr-similar .snr-sim-row::-webkit-scrollbar{ height:8px; }
      #snr-similar .snr-sim-row::-webkit-scrollbar-thumb{ background:var(--line-2,#2d333c); border-radius:4px; }
      #snr-similar a.snr-sim-card{ flex:0 0 auto; width:104px; text-align:center; text-decoration:none; color:var(--text-1,#cdd4de); }
      #snr-similar .snr-sim-poster{ width:104px; height:156px; border-radius:8px; background:var(--bg-3,#181c22); border:1px solid var(--line,#232830); overflow:hidden; box-shadow:0 3px 10px rgba(0,0,0,.4); transition:transform .14s, box-shadow .14s, border-color .14s; }
      #snr-similar .snr-sim-poster img{ width:100%; height:100%; object-fit:cover; display:block; }
      #snr-similar a.snr-sim-card:hover .snr-sim-poster{ transform:translateY(-3px); border-color:var(--accent,#1f9dff); box-shadow:0 10px 24px rgba(0,0,0,.55); }
      #snr-similar .snr-sim-name{ font-size:12px; font-weight:600; line-height:1.25; margin-top:8px; overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }
      #snr-similar a.snr-sim-card:hover .snr-sim-name{ color:var(--accent-bright,#3fc8ff); }
      #snr-similar .snr-sim-year{ font-size:11px; color:var(--text-3,#7d8794); line-height:1.2; margin-top:2px; }
    `);

    const box = document.createElement('div');
    box.className = 'box snr'; box.id = 'snr-similar';
    box.innerHTML = '<div class="head"><strong>Similar Shows</strong></div>';
    const row = document.createElement('div'); row.className = 'snr-sim-row'; box.appendChild(row);

    shows.forEach(d => {
      const a = document.createElement('a');
      a.className = 'snr-sim-card';
      a.href = similarSearchHref(d);           // BTN search by NAME, not id
      a.title = (d.name || d.original_name || '') + ' — search on BTN';
      const pv = document.createElement('div'); pv.className = 'snr-sim-poster';
      const im = document.createElement('img');
      im.loading = 'lazy'; im.alt = d.name || d.original_name || '';
      im.src = 'https://image.tmdb.org/t/p/w342' + d.poster_path;
      pv.appendChild(im);
      const nm = document.createElement('div'); nm.className = 'snr-sim-name'; nm.textContent = d.name || d.original_name || '';
      a.appendChild(pv); a.appendChild(nm);
      const yr = (d.first_air_date || '').slice(0, 4);
      if (yr) { const ys = document.createElement('div'); ys.className = 'snr-sim-year'; ys.textContent = yr; a.appendChild(ys); }
      row.appendChild(a);
    });

    // Place after the Cast/Seasons stack when present; otherwise above Fan Art.
    const seasonBox = document.getElementById('snr-season-browser');
    const castBox = document.getElementById('snr-cast');
    if (seasonBox) {
      seasonBox.insertAdjacentElement('afterend', box);
    } else if (castBox) {
      castBox.insertAdjacentElement('afterend', box);
    } else {
      const fanBox = [...main.querySelectorAll('.box')]
        .find(b => /fan\s*art/i.test((b.querySelector('.head') && b.querySelector('.head').textContent) || ''));
      if (fanBox) main.insertBefore(box, fanBox); else main.appendChild(box);
    }
    return true;
  }

  /* =========================================================================
   * FEATURE: Recommendation Info Modal (recommend.php)
   *   Hijack BTN's sparse info popup and replace it with a richer TMDb card.
   * =======================================================================*/
  const REC_MODAL_CACHE = 'btn_recommend_modal_cache_v1';
  const REC_MODAL_TTL = 1000 * 60 * 60 * 24 * 7;

  function recReadCache() {
    try { return JSON.parse(localStorage.getItem(REC_MODAL_CACHE) || '{}') || {}; }
    catch (e) { return {}; }
  }

  function recWriteCache(cache) {
    try { localStorage.setItem(REC_MODAL_CACHE, JSON.stringify(cache)); } catch (e) {}
  }

  function recAbs(url) {
    if (!url) return '';
    if (/^\/\//.test(url)) return location.protocol + url;
    try { return new URL(url, location.origin).href; } catch (e) { return url; }
  }

  function recTvdbFromSrc(src) {
    return ((src || '').match(/\/v4\/series\/(\d+)\//) || [])[1] ||
      ((src || '').match(/\/series\/(\d+)\//) || [])[1] ||
      ((src || '').match(/\/graphical\/(\d+)-/) || [])[1] ||
      ((src || '').match(/\/(?:posters|fanart|seasons|banners)\/(\d+)-/) || [])[1] || '';
  }

  function recExtractNative(btn) {
    const row = btn && btn.closest('tr');
    if (!row) return null;
    const cells = [...row.children];
    const titleA = row.querySelector('a[href*="series.php"]');
    const banner = [...row.querySelectorAll('img')]
      .find(img => img !== btn && !/^info_button_/i.test(img.id || ''));
    const bannerSrc = banner ? recAbs(banner.getAttribute('src') || banner.src || '') : '';
    const title = (titleA && titleA.textContent || banner && banner.getAttribute('title') || '').replace(/\s+/g, ' ').trim();
    const href = titleA ? recAbs(titleA.getAttribute('href') || '') : '';
    return {
      title,
      href,
      seriesId: ((href.match(/[?&]id=(\d+)/i) || [])[1] || ''),
      tvdbId: recTvdbFromSrc(bannerSrc),
      banner: bannerSrc,
      tags: [...row.querySelectorAll('.tags a')].map(a => a.textContent.trim()).filter(Boolean),
      addedBy: (cells[4] && cells[4].textContent || '').replace(/\s+/g, ' ').trim(),
      votes: (cells[5] && cells[5].textContent || '').replace(/\s+/g, ' ').trim(),
      btnRating: (cells[6] && cells[6].textContent || '').replace(/\s+/g, ' ').trim()
    };
  }

  async function recTmdb(path, params) {
    const key = (getKey('trending') || '').trim();
    if (!key) throw new Error('Missing TMDb API key');
    const qs = new URLSearchParams(Object.assign({ api_key: key, language: 'en-US' }, params || {}));
    const raw = await gmGet('https://api.themoviedb.org/3' + path + '?' + qs.toString());
    return JSON.parse(raw || '{}');
  }

  async function recExternalIds(native) {
    const ids = { tvdbId: native.tvdbId || '', imdbId: '' };
    if (!native.href) return ids;
    try {
      const html = await gmGet(native.href);
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const banner = doc.querySelector('#banner, img[src*="/v4/series/"], img[src*="/graphical/"]');
      const src = banner ? (banner.getAttribute('src') || '') : '';
      ids.tvdbId = ids.tvdbId || recTvdbFromSrc(src);
      const imdb = doc.querySelector('a[href*="imdb.com/title/"]');
      ids.imdbId = imdb ? ((imdb.href.match(/title\/(tt\d+)/i) || [])[1] || '') : '';
    } catch (e) {}
    return ids;
  }

  async function recResolveTmdbId(native) {
    const ids = await recExternalIds(native);
    const findTv = async (ext, src) => {
      if (!ext) return null;
      try {
        const d = await recTmdb('/find/' + encodeURIComponent(ext), { external_source: src });
        return (d && d.tv_results && d.tv_results[0] && d.tv_results[0].id) || null;
      } catch (e) { return null; }
    };
    let tmdbId = await findTv(ids.imdbId, 'imdb_id');
    if (!tmdbId) tmdbId = await findTv(ids.tvdbId, 'tvdb_id');
    if (!tmdbId && native.title) {
      try {
        const d = await recTmdb('/search/tv', { query: native.title, include_adult: 'false', page: '1' });
        const hit = bhfPickByName(native.title, d.results || []);
        tmdbId = hit && hit.id;
      } catch (e) {}
    }
    return { tmdbId, tvdbId: ids.tvdbId, imdbId: ids.imdbId };
  }

  function recRuntime(tv) {
    const rt = (tv && tv.episode_run_time || []).find(n => Number(n) > 0);
    return rt ? rt + ' min eps' : '';
  }

  function recContentRating(tv) {
    const rows = (tv && tv.content_ratings && tv.content_ratings.results) || [];
    for (const cc of ['GB', 'US', 'CA', 'AU']) {
      const row = rows.find(r => r.iso_3166_1 === cc && r.rating);
      if (row) return row.rating;
    }
    return '';
  }

  function recEpisodeLine(label, ep) {
    if (!ep) return '';
    const code = 'S' + String(ep.season_number || 0).padStart(2, '0') + 'E' + String(ep.episode_number || 0).padStart(2, '0');
    return '<div class="recm-ep"><b>' + escapeHtml(label) + '</b><span>' + escapeHtml(code + ' - ' + (ep.name || 'Episode')) + '</span><em>' + escapeHtml(heroDate(ep.air_date)) + '</em></div>';
  }

  async function recLoadDetails(native) {
    const cacheKey = native.seriesId ? 'series:' + native.seriesId : 'title:' + bhfCleanName(native.title);
    const cache = recReadCache();
    const cached = cache[cacheKey];
    if (cached && cached.data && Date.now() - cached.t < REC_MODAL_TTL) return cached.data;
    const ids = await recResolveTmdbId(native);
    if (!ids.tmdbId) throw new Error('No TMDb match found.');
    const tv = await recTmdb('/tv/' + encodeURIComponent(ids.tmdbId), {
      append_to_response: 'aggregate_credits,external_ids,content_ratings'
    });
    const cast = (((tv.aggregate_credits || {}).cast) || []).slice()
      .sort((a, b) => Number(b.total_episode_count || 0) - Number(a.total_episode_count || 0))
      .slice(0, 6)
      .map(c => ({
        name: c.name || '',
        role: (((c.roles || [])[0] || {}).character) || '',
        photo: c.profile_path ? 'https://image.tmdb.org/t/p/w185' + c.profile_path : ''
      }))
      .filter(c => c.name);
    const data = {
      title: tv.name || tv.original_name || native.title,
      overview: tv.overview || '',
      poster: tv.poster_path ? 'https://image.tmdb.org/t/p/w342' + tv.poster_path : '',
      backdrop: tv.backdrop_path ? 'https://image.tmdb.org/t/p/w1280' + tv.backdrop_path : '',
      rating: tv.vote_average ? Number(tv.vote_average).toFixed(1) : '',
      year: heroYearRange(tv),
      status: tv.status || '',
      runtime: recRuntime(tv),
      contentRating: recContentRating(tv),
      network: ((tv.networks || [])[0] || {}).name || '',
      seasons: tv.number_of_seasons || '',
      episodes: tv.number_of_episodes || '',
      genres: (tv.genres || []).slice(0, 4).map(g => g.name).filter(Boolean),
      latest: tv.last_episode_to_air || null,
      next: tv.next_episode_to_air || null,
      cast,
      tmdbUrl: 'https://www.themoviedb.org/tv/' + encodeURIComponent(ids.tmdbId),
      imdbUrl: ((tv.external_ids || {}).imdb_id || ids.imdbId) ? 'https://www.imdb.com/title/' + encodeURIComponent((tv.external_ids || {}).imdb_id || ids.imdbId) + '/' : '',
      tvdbUrl: ((tv.external_ids || {}).tvdb_id || ids.tvdbId) ? 'https://thetvdb.com/dereferrer/series/' + encodeURIComponent((tv.external_ids || {}).tvdb_id || ids.tvdbId) : ''
    };
    cache[cacheKey] = { t: Date.now(), data };
    recWriteCache(cache);
    return data;
  }

  function recModalCss() {
    injectCss('btn-recommend-modal-style', `
      #btn-rec-modal-ov{ position:fixed; inset:0; z-index:2147483000; display:none; align-items:center; justify-content:center; padding:24px; background:rgba(4,7,11,.78); backdrop-filter:blur(5px); -webkit-backdrop-filter:blur(5px); animation:recmfade .16s ease both; }
      #btn-rec-modal-ov.open{ display:flex; }
      #btn-rec-modal{ position:relative; width:min(920px,94vw); max-height:86vh; overflow:hidden; border:1px solid rgba(63,200,255,.22); border-radius:14px; background:var(--bg-2,#12151a); color:var(--text-1,#cdd4de); box-shadow:0 28px 90px rgba(0,0,0,.75); animation:recmrise .18s ease both; }
      #btn-rec-modal .recm-bg{ position:absolute; inset:0; background-size:cover; background-position:center; opacity:.32; filter:saturate(.95) contrast(1.05); }
      #btn-rec-modal .recm-shade{ position:absolute; inset:0; background:linear-gradient(90deg,rgba(6,8,12,.98) 0%,rgba(6,8,12,.9) 44%,rgba(6,8,12,.68) 100%),linear-gradient(0deg,rgba(6,8,12,.92),rgba(6,8,12,.22)); }
      #btn-rec-modal .recm-x{ position:absolute; z-index:4; right:12px; top:12px; width:34px; height:34px; border-radius:10px; border:1px solid rgba(255,255,255,.14); background:rgba(0,0,0,.42); color:#dcecf8; font-size:20px; line-height:1; cursor:pointer; }
      #btn-rec-modal .recm-x:hover{ color:#fff; border-color:var(--accent-bright,#3fc8ff); background:rgba(31,157,255,.18); }
      #btn-rec-modal .recm-inner{ position:relative; z-index:2; display:grid; grid-template-columns:178px minmax(0,1fr); gap:20px; padding:24px; overflow:auto; max-height:86vh; }
      #btn-rec-modal .recm-poster{ width:178px; aspect-ratio:2/3; border-radius:10px; overflow:hidden; border:1px solid rgba(255,255,255,.14); background:rgba(0,0,0,.36); box-shadow:0 16px 36px rgba(0,0,0,.48); }
      #btn-rec-modal .recm-poster img{ width:100%; height:100%; object-fit:cover; display:block; }
      #btn-rec-modal .recm-kicker{ color:var(--accent-bright,#3fc8ff); font-size:10.5px; line-height:1; font-weight:900; letter-spacing:.14em; text-transform:uppercase; margin:2px 0 8px; }
      #btn-rec-modal .recm-title{ margin:0 42px 8px 0; color:#fff; font-family:var(--fd,inherit); font-size:30px; font-weight:850; line-height:1.05; letter-spacing:0; }
      #btn-rec-modal .recm-overview{ margin:0 0 13px; max-width:78ch; color:#dce6ef; font-size:13px; line-height:1.55; }
      #btn-rec-modal .recm-chips{ display:flex; flex-wrap:wrap; gap:6px; margin:0 0 15px; }
      #btn-rec-modal .recm-chip{ display:inline-flex; align-items:center; min-height:24px; padding:3px 9px; border-radius:999px; border:1px solid rgba(255,255,255,.12); background:rgba(255,255,255,.065); color:#e6edf5; font-size:11.5px; font-weight:800; }
      #btn-rec-modal .recm-chip.score{ color:#06121d; background:linear-gradient(135deg,#7fdcff,#1f9dff); border-color:transparent; }
      #btn-rec-modal .recm-stats{ display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; margin:0 0 15px; }
      #btn-rec-modal .recm-stat{ min-width:0; padding:9px 10px; border-radius:10px; border:1px solid rgba(255,255,255,.09); background:rgba(255,255,255,.04); }
      #btn-rec-modal .recm-stat b{ display:block; color:#fff; font-size:11px; text-transform:uppercase; letter-spacing:.06em; margin-bottom:3px; }
      #btn-rec-modal .recm-stat span{ color:var(--text-2,#9aa4b2); font-size:12px; font-weight:700; }
      #btn-rec-modal .recm-eps{ display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; margin:0 0 15px; }
      #btn-rec-modal .recm-ep{ min-width:0; padding:10px; border-radius:10px; border:1px solid rgba(255,255,255,.09); background:rgba(0,0,0,.22); }
      #btn-rec-modal .recm-ep b{ display:block; color:var(--accent-bright,#3fc8ff); font-size:10.5px; text-transform:uppercase; letter-spacing:.08em; margin-bottom:5px; }
      #btn-rec-modal .recm-ep span{ display:block; color:#fff; font-weight:800; font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      #btn-rec-modal .recm-ep em{ display:block; margin-top:3px; color:var(--text-3,#7d8794); font-style:normal; font-size:11px; }
      #btn-rec-modal .recm-cast{ display:flex; gap:10px; overflow-x:auto; padding:0 0 4px; margin:0 0 15px; scrollbar-width:thin; }
      #btn-rec-modal .recm-person{ flex:0 0 76px; text-align:center; }
      #btn-rec-modal .recm-face{ width:58px; height:58px; border-radius:50%; margin:0 auto 6px; overflow:hidden; border:1px solid rgba(255,255,255,.14); background:rgba(255,255,255,.06); display:flex; align-items:center; justify-content:center; color:var(--text-3,#7d8794); font-weight:850; }
      #btn-rec-modal .recm-face img{ width:100%; height:100%; object-fit:cover; display:block; }
      #btn-rec-modal .recm-person b{ display:block; color:#fff; font-size:11px; line-height:1.2; overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }
      #btn-rec-modal .recm-person span{ display:block; color:var(--text-3,#7d8794); font-size:10.5px; line-height:1.2; margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      #btn-rec-modal .recm-actions{ display:flex; flex-wrap:wrap; gap:8px; }
      #btn-rec-modal .recm-actions a{ display:inline-flex; align-items:center; justify-content:center; min-height:30px; padding:7px 11px; border-radius:999px; border:1px solid rgba(63,200,255,.22); background:rgba(255,255,255,.045); color:#dcecf8 !important; text-decoration:none !important; font-size:12px; font-weight:900; }
      #btn-rec-modal .recm-actions a:hover{ color:#fff !important; border-color:var(--accent-bright,#3fc8ff); background:rgba(31,157,255,.14); }
      #btn-rec-modal .recm-status{ position:relative; z-index:2; padding:28px; color:var(--text-2,#9aa4b2); font-size:13px; }
      #btn-rec-modal .recm-spin{ display:inline-block; width:15px; height:15px; margin-right:8px; border:2px solid rgba(255,255,255,.25); border-top-color:#fff; border-radius:50%; vertical-align:-3px; animation:snrspin .7s linear infinite; }
      @keyframes recmfade{ from{ opacity:0; } to{ opacity:1; } }
      @keyframes recmrise{ from{ opacity:0; transform:translateY(10px) scale(.985); } to{ opacity:1; transform:translateY(0) scale(1); } }
      @media (max-width:720px){ #btn-rec-modal .recm-inner{ grid-template-columns:104px minmax(0,1fr); gap:14px; padding:16px; } #btn-rec-modal .recm-poster{ width:104px; } #btn-rec-modal .recm-title{ font-size:22px; } #btn-rec-modal .recm-stats,#btn-rec-modal .recm-eps{ grid-template-columns:1fr; } }
    `);
  }

  function recEnsureModal() {
    recModalCss();
    let ov = document.getElementById('btn-rec-modal-ov');
    if (ov) return ov;
    ov = document.createElement('div');
    ov.id = 'btn-rec-modal-ov';
    ov.className = 'snr';
    ov.innerHTML = '<div id="btn-rec-modal" role="dialog" aria-modal="true"><button type="button" class="recm-x" title="Close">×</button><div class="recm-slot"></div></div>';
    document.body.appendChild(ov);
    const close = () => ov.classList.remove('open');
    ov.addEventListener('click', e => { if (e.target === ov) close(); });
    ov.querySelector('.recm-x').addEventListener('click', close);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && ov.classList.contains('open')) close(); });
    return ov;
  }

  function recCloseNativeDialog() {
    try {
      if (window.jQuery && jQuery('#info_dialog').length) jQuery('#info_dialog').dialog('close');
    } catch (e) {}
    document.querySelectorAll('.ui-dialog[aria-labelledby="ui-dialog-title-info_dialog"]').forEach(el => { el.style.display = 'none'; });
  }

  function recChip(text, cls) {
    return text ? '<span class="recm-chip' + (cls ? ' ' + cls : '') + '">' + escapeHtml(text) + '</span>' : '';
  }

  function recRender(native, tv) {
    const poster = tv.poster || native.banner || '';
    const bg = tv.backdrop || native.banner || '';
    const chips = [
      recChip(tv.rating ? 'TMDb ' + tv.rating : '', 'score'),
      recChip(tv.contentRating),
      recChip(tv.year),
      recChip(tv.status),
      recChip(tv.runtime),
      recChip(tv.seasons ? tv.seasons + ' season' + (Number(tv.seasons) === 1 ? '' : 's') : ''),
      recChip(tv.episodes ? tv.episodes + ' eps' : ''),
      recChip(tv.network)
    ].concat((tv.genres || native.tags || []).slice(0, 5).map(g => recChip(g))).join('');
    const stats = [
      ['BTN Rating', native.btnRating || 'Not rated'],
      ['Votes', native.votes || '0'],
      ['Added By', native.addedBy || 'Unknown']
    ].map(([k, v]) => '<div class="recm-stat"><b>' + escapeHtml(k) + '</b><span>' + escapeHtml(v) + '</span></div>').join('');
    const eps = [recEpisodeLine('Latest', tv.latest), recEpisodeLine('Next', tv.next)].filter(Boolean).join('');
    const cast = (tv.cast || []).map(c =>
      '<div class="recm-person"><div class="recm-face">' + (c.photo ? '<img loading="lazy" alt="" src="' + escapeAttr(c.photo) + '">' : escapeHtml((c.name || '?').slice(0, 1))) + '</div><b>' +
      escapeHtml(c.name) + '</b>' + (c.role ? '<span>' + escapeHtml(c.role) + '</span>' : '') + '</div>'
    ).join('');
    const actions = [
      ['Open on BTN', native.href],
      ['TMDb', tv.tmdbUrl],
      ['IMDb', tv.imdbUrl],
      ['TVDB', tv.tvdbUrl]
    ].filter(a => a[1]).map(([label, href]) => {
      let external = true;
      try { external = new URL(href, location.origin).origin !== location.origin; } catch (e) {}
      return '<a href="' + escapeAttr(href) + '" target="' + (external ? '_blank' : '_self') + '" rel="noopener">' + escapeHtml(label) + '</a>';
    }).join('');
    return '<div class="recm-bg" style="background-image:url(&quot;' + escapeAttr(bg) + '&quot;)"></div><div class="recm-shade"></div>' +
      '<div class="recm-inner">' +
        '<div class="recm-poster">' + (poster ? '<img loading="lazy" alt="" src="' + escapeAttr(poster) + '">' : '') + '</div>' +
        '<div class="recm-main">' +
          '<div class="recm-kicker">Recommended Series</div>' +
          '<h2 class="recm-title">' + escapeHtml(tv.title || native.title || 'Series') + '</h2>' +
          '<p class="recm-overview">' + escapeHtml(tv.overview || 'TMDb does not have a synopsis for this show yet.') + '</p>' +
          '<div class="recm-chips">' + chips + '</div>' +
          '<div class="recm-stats">' + stats + '</div>' +
          (eps ? '<div class="recm-eps">' + eps + '</div>' : '') +
          (cast ? '<div class="recm-cast">' + cast + '</div>' : '') +
          '<div class="recm-actions">' + actions + '</div>' +
        '</div>' +
      '</div>';
  }

  async function recOpen(native) {
    const ov = recEnsureModal();
    const slot = ov.querySelector('.recm-slot');
    ov.classList.add('open');
    slot.innerHTML = '<div class="recm-status"><span class="recm-spin"></span>Loading TMDb details for ' + escapeHtml((native && native.title) || 'this show') + '...</div>';
    recCloseNativeDialog();
    try {
      const tv = await recLoadDetails(native);
      slot.innerHTML = recRender(native, tv);
    } catch (e) {
      slot.innerHTML = '<div class="recm-status">Could not load TMDb details. ' +
        (native && native.href ? '<a href="' + escapeAttr(native.href) + '">Open on BTN</a>' : '') + '</div>';
    }
  }

  function runRecommendModal() {
    if (window.__btnRecommendModal) return true;
    const icons = document.querySelectorAll('img[id^="info_button_"]');
    if (!icons.length) return false;
    window.__btnRecommendModal = true;
    icons.forEach(img => {
      img.style.cursor = 'pointer';
      img.title = 'Show rich series info';
    });
    document.addEventListener('click', e => {
      const btn = e.target && e.target.closest ? e.target.closest('img[id^="info_button_"]') : null;
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      const native = recExtractNative(btn);
      if (native) recOpen(native);
    }, true);
    return true;
  }

  /* =========================================================================
   * FEATURE: Enhanced Series Summary (series page)
   *   Fold the sidebar Latest Episode / Next Episode / Genres panels into the
   *   Series Summary card, enriched with TMDb (rating, status, network, run,
   *   episode stills + dates). The existing description and external-link icons
   *   are left untouched, and the broken YouTube/Flash sidebar card is hidden.
   * =======================================================================*/
  function essSidebarBox(re) {
    return [...document.querySelectorAll('.sidebar .box')]
      .find(b => re.test((b.querySelector('.head') && b.querySelector('.head').textContent) || ''));
  }
  function essFmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d.getTime())) return iso;
    try { return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
    catch (e) { return iso; }
  }
  function essCountdown(iso) {
    if (!iso) return '';
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d.getTime())) return '';
    const days = Math.ceil((d.getTime() - Date.now()) / 86400000);
    if (days < 0) return 'aired';
    if (days === 0) return 'today';
    if (days === 1) return 'tomorrow';
    return 'in ' + days + ' days';
  }
  function essEpCard(label, ep, fallbackText) {
    if (!ep) {
      const txt = (fallbackText && !/not available/i.test(fallbackText)) ? escapeHtml(fallbackText) : '—';
      return '<div class="ess-ep"><div class="who"><div class="lbl">' + label + '</div>' +
        '<div class="nm" style="color:var(--text-3,#7d8794)">' + txt + '</div></div></div>';
    }
    const still = ep.still_path ? ('<img class="thumb" loading="lazy" src="https://image.tmdb.org/t/p/w300' + ep.still_path + '">') : '';
    const se = 'S' + String(ep.season_number).padStart(2, '0') + 'E' + String(ep.episode_number).padStart(2, '0');
    const cd = essCountdown(ep.air_date);
    return '<div class="ess-ep">' + still + '<div class="who"><div class="lbl">' + label + '</div>' +
      '<div class="se">' + se + '</div><div class="nm">' + escapeHtml(ep.name || '') + '</div>' +
      '<div class="dt">' + escapeHtml(essFmtDate(ep.air_date)) + (cd ? ' · <span class="cd">' + cd + '</span>' : '') + '</div></div></div>';
  }

  async function runEnhancedSummary() {
    if (window.__snrEss || document.querySelector('#summary .ess-meta')) return true;
    window.__snrEss = true;
    const sum = document.querySelector('#summary');
    if (!sum) { window.__snrEss = false; return false; }

    // Always hide the broken YouTube/Flash sidebar card.
    const yb = essSidebarBox(/youtube/i); if (yb) yb.style.display = 'none';

    // Gather the sidebar panels we're folding in (before removing them).
    const gbox = essSidebarBox(/genres/i);
    const genreLinks = gbox ? [...gbox.querySelectorAll('a')].map(a => ({ t: a.textContent.trim(), href: a.getAttribute('href') })) : [];
    const latestBox = essSidebarBox(/latest episode/i);
    const nextBox = essSidebarBox(/next episode/i);
    const btnLatestTxt = latestBox ? (latestBox.querySelector('td, li') || {}).textContent : '';
    const btnNextTxt = nextBox ? (nextBox.querySelector('td, li') || {}).textContent : '';

    // TMDb enrichment.
    let tv = null;
    const key = (getKey('trending') || '').trim();
    if (key) {
      try {
        const info = window.__btnSeries || seriesInfo();
        const findTv = async (ext, src) => {
          if (!ext) return null;
          try {
            const d = await fetch('https://api.themoviedb.org/3/find/' + encodeURIComponent(ext) +
              '?external_source=' + src + '&api_key=' + encodeURIComponent(key)).then(r => r.json());
            return (d && d.tv_results && d.tv_results[0] && d.tv_results[0].id) || null;
          } catch (e) { return null; }
        };
        let tvId = await findTv(info.imdbId, 'imdb_id');
        if (!tvId) tvId = await findTv(info.tvdbId, 'tvdb_id');
        if (tvId) tv = await fetch('https://api.themoviedb.org/3/tv/' + tvId + '?api_key=' + encodeURIComponent(key)).then(r => r.json());
      } catch (e) { tv = null; }
    }

    // Build the meta-chip strip.
    const chips = [];
    if (tv) {
      if (tv.vote_average) chips.push('<span class="ess-chip star">★ ' + tv.vote_average.toFixed(1) + '</span>');
      if (tv.status) {
        const on = /return|airing|progress/i.test(tv.status);
        chips.push('<span class="ess-chip ' + (on ? 'status-on' : '') + '">' + escapeHtml(tv.status) + '</span>');
      }
      (tv.networks || []).slice(0, 1).forEach(n => chips.push('<span class="ess-chip">' + escapeHtml(n.name) + '</span>'));
      const y1 = (tv.first_air_date || '').slice(0, 4), y2 = (tv.last_air_date || '').slice(0, 4);
      if (y1) chips.push('<span class="ess-chip">' + y1 + (y2 && y2 !== y1 ? '–' + y2 : '') + '</span>');
      if (tv.number_of_seasons) chips.push('<span class="ess-chip">' + tv.number_of_seasons + ' season' + (tv.number_of_seasons > 1 ? 's' : '') + ' · ' + tv.number_of_episodes + ' eps</span>');
    }
    if (genreLinks.length) {
      genreLinks.forEach(g => chips.push('<a class="ess-chip" href="' + escapeAttr(g.href) + '">' + escapeHtml(g.t) + '</a>'));
    } else if (tv && tv.genres) {
      tv.genres.forEach(g => chips.push('<span class="ess-chip">' + escapeHtml(g.name) + '</span>'));
    }
    if (chips.length) {
      const meta = document.createElement('div');
      meta.className = 'ess-meta snr';
      meta.innerHTML = chips.join('');
      sum.insertBefore(meta, sum.firstChild);
    }

    // Build the Latest / Next episode strip.
    const latestEp = tv && tv.last_episode_to_air;
    const nextEp = tv && tv.next_episode_to_air;
    if (latestEp || nextEp || btnLatestTxt || btnNextTxt) {
      const eps = document.createElement('div');
      eps.className = 'ess-eps snr';
      eps.innerHTML = essEpCard('Latest Episode', latestEp, btnLatestTxt) +
                      essEpCard('Next Episode', nextEp, btnNextTxt);
      sum.appendChild(eps);
    }

    // Remove the folded-in sidebar panels.
    [gbox, latestBox, nextBox].forEach(b => { if (b) b.remove(); });
    return true;
  }

  /* =========================================================================
   * FEATURE: Stamps Row (series page)
   *   Move BTN's Buy Stamps panel out of the sidebar into a horizontal row
   *   across the bottom of the main column.
   * =======================================================================*/
  function runStamps() {
    const main = document.querySelector('.main_column');
    if (!main) return false;
    const box = [...document.querySelectorAll('.sidebar .box')]
      .find(b => /stamp/i.test((b.querySelector('.head') && b.querySelector('.head').textContent) || ''));
    if (!box) return true; // no stamps panel on this page — nothing to do
    if (box.id === 'snr-stamps' && box.parentElement === main) return true;
    box.id = 'snr-stamps';
    main.appendChild(box); // relocate to the very bottom of the main column
    return true;
  }

  /* =========================================================================
   * FEATURE: Fan Art Carousels (series page)
   *   Fill the Series Fan Art card with fanart.tv artwork as controllable
   *   single-image carousels — one per artwork type that exists.
   * =======================================================================*/
  const ARTWORK_TYPES = [
    ['showbackground', 'Backgrounds'], ['tvbanner', 'Banners']
  ];

  function buildCarousel(label, imgs) {
    const car = document.createElement('div');
    car.className = 'snr-car';
    car.innerHTML =
      '<div class="snr-car-lbl"><span>' + escapeHtml(label) + '</span><span class="snr-car-count"></span></div>' +
      '<div class="snr-car-stage"><img class="snr-car-img" alt="">' +
      '<button class="snr-car-nav prev" type="button" title="Previous">‹</button>' +
      '<button class="snr-car-nav next" type="button" title="Next">›</button>' +
      '<a class="snr-car-dl" target="_blank" rel="noopener">open ↗</a></div>';
    let i = 0;
    const im = car.querySelector('.snr-car-img');
    const cnt = car.querySelector('.snr-car-count');
    const dl = car.querySelector('.snr-car-dl');
    const show = () => { im.src = imgs[i].url; dl.href = imgs[i].url; cnt.textContent = (i + 1) + ' / ' + imgs.length; };
    car.querySelector('.prev').addEventListener('click', () => { i = (i - 1 + imgs.length) % imgs.length; show(); });
    car.querySelector('.next').addEventListener('click', () => { i = (i + 1) % imgs.length; show(); });
    show();
    return car;
  }

  async function runArtwork() {
    if (window.__snrArtwork) return true;
    const fanBox = [...document.querySelectorAll('.main_column .box')]
      .find(b => /fan\s*art/i.test((b.querySelector('.head') && b.querySelector('.head').textContent) || ''));
    if (!fanBox) return false;
    window.__snrArtwork = true;
    const key = (getKey('fanart') || '').trim();
    if (!key) return true;
    let tvdbId = null;
    try { tvdbId = await resolveTvdbId(); } catch (e) {}
    if (!tvdbId) return true;
    let data = null;
    try {
      const raw = await gmGet('https://webservice.fanart.tv/v3/tv/' + encodeURIComponent(tvdbId) + '?api_key=' + encodeURIComponent(key));
      data = JSON.parse(raw);
    } catch (e) { return true; }
    if (!data) return true;

    // English only — keep English-tagged and text-free artwork (backgrounds are
    // usually untagged), drop other languages. Sort by community likes.
    const sortImgs = arr => (arr || [])
      .filter(x => !x.lang || x.lang === 'en' || x.lang === '00')
      .sort((a, b) => (+b.likes || 0) - (+a.likes || 0));

    const wrap = document.createElement('div');
    wrap.className = 'snr-cars snr';
    const seenLabels = {};
    ARTWORK_TYPES.forEach(([k, label]) => {
      if (seenLabels[label]) return; // e.g. don't add "Clear Art" twice (hd + sd)
      const imgs = sortImgs(data[k]);
      if (!imgs.length) return;
      seenLabels[label] = true;
      wrap.appendChild(buildCarousel(label, imgs));
    });
    if (!wrap.children.length) return true; // no artwork — leave BTN's card as-is

    const body = fanBox.querySelector('.body') || fanBox;
    body.innerHTML = '';
    body.appendChild(wrap);
    return true;
  }

  /* =========================================================================
   * FEATURE: Actor Showcase (TMDb)
   *   Rebuild BTN's legacy nested-table actor showcase with TMDb photos and
   *   known-for TV credits. Cards link through BTN's working actor search.
   * =======================================================================*/
  const BTNSC_CACHE = 'btn_tmdb_actor_showcase_cache_v1';
  const BTNSC_TTL = 1000 * 60 * 60 * 24 * 7;
  const BTNSC_IMG = 'https://image.tmdb.org/t/p/';

  function btnscCss() {
    injectCss('btnsc-style', `
    body.stmpe-btn-showcase #content,
    body.stmpe-btn-showcase #content > .thin,
    body.stmpe-btn-showcase .thin{ max-width:none!important; width:min(1780px,calc(100vw - 72px))!important; }
    body.stmpe-btn-showcase .btnsc-native{ display:none!important; }
    #btnsc-mount{ margin:18px auto 34px; color:var(--text,#f4f7fb); }
    .btnsc-panel{ border:1px solid rgba(55,133,180,.22); border-radius:18px; overflow:hidden; background:linear-gradient(145deg,rgba(8,11,16,.97),rgba(11,16,23,.94)); box-shadow:0 22px 64px rgba(0,0,0,.42),inset 0 1px 0 rgba(255,255,255,.04); }
    .btnsc-head{ display:flex; align-items:flex-end; justify-content:space-between; gap:18px; padding:18px 20px; border-bottom:1px solid rgba(55,133,180,.18); background:linear-gradient(90deg,rgba(31,157,255,.13),rgba(255,255,255,.025) 42%,rgba(244,192,78,.07)); }
    .btnsc-kicker{ color:#38d8ff; font-size:12px; text-transform:uppercase; letter-spacing:.08em; font-weight:900; }
    .btnsc-title{ margin-top:4px; color:#fff; font-size:24px; line-height:1.1; font-weight:900; }
    .btnsc-sub{ margin-top:5px; color:var(--text-2,#aab4c1); font-size:13px; }
    .btnsc-badge{ display:inline-flex; align-items:center; min-height:28px; padding:4px 10px; border:1px solid rgba(92,157,197,.24); border-radius:999px; background:rgba(13,27,39,.72); color:#dcecf8; font-size:12px; font-weight:900; white-space:nowrap; }
    .btnsc-grid{ display:grid; grid-template-columns:repeat(auto-fit,minmax(292px,1fr)); gap:14px; padding:18px; }
    .btnsc-card{ display:grid; grid-template-columns:88px minmax(0,1fr); gap:13px; min-height:148px; border:1px solid rgba(92,157,197,.16); border-radius:16px; padding:12px; background:linear-gradient(145deg,rgba(255,255,255,.045),rgba(255,255,255,.012)); box-shadow:0 16px 34px rgba(0,0,0,.25); position:relative; overflow:hidden; }
    .btnsc-card::before{ content:""; position:absolute; inset:0 auto 0 0; width:3px; background:linear-gradient(180deg,#3fc8ff,#1f9dff); opacity:.95; box-shadow:0 0 18px rgba(63,200,255,.35); }
    .btnsc-photo{ width:88px; aspect-ratio:2/3; object-fit:cover; border-radius:12px; background:linear-gradient(135deg,rgba(31,157,255,.18),rgba(255,255,255,.04)); box-shadow:0 10px 24px rgba(0,0,0,.36); }
    .btnsc-name{ color:#fff!important; font-size:17px; line-height:1.2; font-weight:900; text-decoration:none!important; }
    .btnsc-name:hover{ color:#38d8ff!important; }
    .btnsc-meta{ margin-top:7px; display:flex; flex-wrap:wrap; gap:6px; color:#9fb0bf; font-size:11.5px; }
    .btnsc-meta span{ border:1px solid rgba(255,255,255,.08); border-radius:999px; padding:3px 7px; background:rgba(255,255,255,.035); }
    .btnsc-known{ margin-top:10px; color:#d8e2ec; font-size:12.5px; line-height:1.4; }
    .btnsc-known b{ display:block; margin-bottom:3px; color:#fff; }
    .btnsc-known a{ color:#38d8ff!important; text-decoration:none!important; font-weight:800; }
    .btnsc-known a:hover{ color:#fff!important; }
    .btnsc-actions{ display:flex; flex-wrap:wrap; gap:7px; margin-top:11px; }
    .btnsc-actions a{ color:#dcecf8!important; text-decoration:none!important; border:1px solid rgba(92,157,197,.2); border-radius:999px; padding:4px 8px; font-size:11px; font-weight:900; background:rgba(255,255,255,.035); }
    .btnsc-actions a:hover{ border-color:#38d8ff; color:#fff!important; }
    .btnsc-status{ padding:30px; text-align:center; color:#c7d1dc; }
    .btnsc-error{ color:#ff9f9f; }
    .btnsc-spin{ width:28px; height:28px; border-radius:50%; border:3px solid rgba(56,216,255,.18); border-top-color:#38d8ff; margin:0 auto 12px; animation:btnsc-spin .85s linear infinite; }
    @keyframes btnsc-spin{ to{ transform:rotate(360deg); } }
    @media (max-width:760px){
      body.stmpe-btn-showcase #content,body.stmpe-btn-showcase #content > .thin,body.stmpe-btn-showcase .thin{ width:calc(100vw - 24px)!important; }
      .btnsc-head{ align-items:flex-start; flex-direction:column; padding:16px; }
      .btnsc-grid{ grid-template-columns:1fr; padding:12px; }
    }`);
  }

  function btnscPlaceholder(name) {
    const initials = String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(s => s.charAt(0).toUpperCase()).join('') || '?';
    return 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22176%22 height=%22264%22 viewBox=%220 0 176 264%22%3E%3Cdefs%3E%3ClinearGradient id=%22g%22 x1=%220%22 x2=%221%22 y1=%220%22 y2=%221%22%3E%3Cstop stop-color=%22%23142637%22/%3E%3Cstop offset=%221%22 stop-color=%22%23070a0f%22/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width=%22176%22 height=%22264%22 rx=%2218%22 fill=%22url(%23g)%22/%3E%3Ccircle cx=%2288%22 cy=%2290%22 r=%2240%22 fill=%22%231f9dff%22 opacity=%22.22%22/%3E%3Cpath d=%22M36 212c11-51 93-51 104 0%22 fill=%22%231f9dff%22 opacity=%22.18%22/%3E%3Ctext x=%2288%22 y=%22147%22 text-anchor=%22middle%22 font-family=%22Arial%2C sans-serif%22 font-size=%2236%22 font-weight=%22700%22 fill=%22%233fc8ff%22%3E' + encodeURIComponent(initials) + '%3C/text%3E%3C/svg%3E';
  }

  function btnscYear(d) {
    return d ? String(d).slice(0, 4) : '';
  }

  function btnscCleanName(name) {
    return String(name || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  }

  function btnscGender(id) {
    if (id === 1) return 'Female';
    if (id === 2) return 'Male';
    if (id === 3) return 'Non-binary';
    return '';
  }

  function btnscReadCache() {
    try { return JSON.parse(localStorage.getItem(BTNSC_CACHE) || '{}') || {}; }
    catch (e) { return {}; }
  }

  function btnscWriteCache(cache) {
    try { localStorage.setItem(BTNSC_CACHE, JSON.stringify(cache)); } catch (e) {}
  }

  async function btnscTmdb(path, params) {
    const key = (getKey('trending') || '').trim();
    if (!key) throw new Error('Missing TMDb API key. Add it in the Userscript Manager on your profile settings page.');
    const qs = new URLSearchParams(Object.assign({ api_key: key, language: 'en-US' }, params || {}));
    const raw = await gmGet('https://api.themoviedb.org/3' + path + '?' + qs.toString());
    return JSON.parse(raw || '{}');
  }

  function btnscPickMatch(name, results) {
    const clean = btnscCleanName(name);
    const people = (results || []).filter(Boolean);
    return people.find(p => btnscCleanName(p.name) === clean) ||
      people.find(p => (p.also_known_as || []).some(a => btnscCleanName(a) === clean)) ||
      people[0] || null;
  }

  function btnscNormaliseCredits(credits) {
    const cast = credits && Array.isArray(credits.cast) ? credits.cast : [];
    const merged = new Map();
    cast.filter(c => c && c.media_type === 'tv' && c.id && c.name).forEach(show => {
      const prev = merged.get(show.id);
      if (!prev) {
        merged.set(show.id, Object.assign({}, show));
        return;
      }
      if (show.character && !String(prev.character || '').includes(show.character)) {
        prev.character = [prev.character, show.character].filter(Boolean).join(', ');
      }
      prev.episode_count = Math.max(Number(prev.episode_count || 0), Number(show.episode_count || 0));
      prev.popularity = Math.max(Number(prev.popularity || 0), Number(show.popularity || 0));
      prev.vote_average = Math.max(Number(prev.vote_average || 0), Number(show.vote_average || 0));
    });
    const rows = [...merged.values()];
    return rows.sort((a, b) => {
      const ae = Number(a.episode_count || 0);
      const be = Number(b.episode_count || 0);
      const ap = Number(a.popularity || 0);
      const bp = Number(b.popularity || 0);
      const ar = Number(a.vote_average || 0);
      const br = Number(b.vote_average || 0);
      if (be !== ae) return be - ae;
      if (bp !== ap) return bp - ap;
      return br - ar;
    }).slice(0, 4).map(show => ({
      id: show.id,
      name: show.name,
      premiered: show.first_air_date || '',
      role: show.character || '',
      episodes: show.episode_count || 0,
      rating: show.vote_average || 0
    }));
  }

  async function btnscEnrichActor(actor, cache) {
    const cacheKey = actor.name.toLowerCase();
    const cached = cache[cacheKey];
    if (cached && Date.now() - cached.t < BTNSC_TTL) return Object.assign({}, actor, cached.data);
    try {
      const search = await btnscTmdb('/search/person', { query: actor.name, include_adult: 'false', page: '1' });
      const person = btnscPickMatch(actor.name, search.results || []);
      if (!person) throw new Error('No TMDb match');
      let detail = {};
      try { detail = await btnscTmdb('/person/' + encodeURIComponent(person.id), { append_to_response: 'combined_credits,external_ids' }); }
      catch (e) { detail = person; }
      const data = {
        tmdbId: detail.id || person.id,
        tmdbUrl: 'https://www.themoviedb.org/person/' + encodeURIComponent(detail.id || person.id),
        tmdbName: detail.name || person.name || actor.name,
        image: (detail.profile_path || person.profile_path) ? BTNSC_IMG + 'w342' + (detail.profile_path || person.profile_path) : '',
        gender: btnscGender(detail.gender),
        place: detail.place_of_birth || '',
        birthday: detail.birthday || '',
        knownFor: btnscNormaliseCredits(detail.combined_credits)
      };
      cache[cacheKey] = { t: Date.now(), data };
      return Object.assign({}, actor, data);
    } catch (e) {
      const data = { tmdbId: null, tmdbUrl: '', tmdbName: actor.name, image: '', gender: '', place: '', birthday: '', knownFor: [] };
      cache[cacheKey] = { t: Date.now(), data };
      return Object.assign({}, actor, data);
    }
  }

  async function btnscMapLimit(items, limit, fn) {
    const out = new Array(items.length);
    let next = 0;
    async function worker() {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return out;
  }

  function btnscNativeActors() {
    const thin = document.querySelector('body#actorshowcase #content .thin') || document.querySelector('#content .thin');
    if (!thin) return [];
    return [...thin.querySelectorAll('a[href*="actor.php?id="][title]')].map(a => {
      const table = a.closest('table');
      const text = table ? table.innerText.replace(/\s+/g, ' ').trim() : '';
      const added = (text.match(/Added:\s*([0-9:-]+\s+[0-9:]+)/i) || [])[1] || '';
      const name = a.getAttribute('title') || a.textContent.trim();
      return {
        name,
        href: '/actor.php?name=' + encodeURIComponent(name),
        nativeHref: a.getAttribute('href') || '',
        added
      };
    }).filter(a => a.name);
  }

  function btnscMount() {
    btnscCss();
    document.body.classList.add('stmpe-btn-showcase');
    const thin = document.querySelector('body#actorshowcase #content .thin') || document.querySelector('#content .thin');
    if (!thin) return null;
    [...thin.children].forEach(el => {
      if (el.tagName === 'TABLE') el.classList.add('btnsc-native');
    });
    let mount = document.getElementById('btnsc-mount');
    if (mount) return mount;
    mount = document.createElement('div');
    mount.id = 'btnsc-mount';
    const firstTable = [...thin.children].find(el => el.tagName === 'TABLE');
    const linkbox = thin.querySelector(':scope > .linkbox') || thin.querySelector('.linkbox');
    if (firstTable) thin.insertBefore(mount, firstTable);
    else if (linkbox) linkbox.insertAdjacentElement('afterend', mount);
    else thin.appendChild(mount);
    return mount;
  }

  function btnscStatus(mount, msg, bad) {
    if (!mount) return;
    mount.innerHTML = '<div class="btnsc-panel"><div class="btnsc-status">' +
      (bad ? '' : '<div class="btnsc-spin"></div>') +
      '<div class="' + (bad ? 'btnsc-error' : '') + '">' + escapeHtml(msg) + '</div>' +
      '</div></div>';
  }

  function btnscShowSearch(show) {
    const year = btnscYear(show && show.premiered);
    return [show && show.name, year].filter(Boolean).join(' ');
  }

  function btnscCard(actor) {
    const card = document.createElement('article');
    card.className = 'btnsc-card';
    const placeholder = btnscPlaceholder(actor.name);
    const photo = actor.image || placeholder;
    const known = (actor.knownFor || []).map(k => {
      const name = k.name || 'Untitled';
      const year = btnscYear(k.premiered);
      const role = k.role || '';
      return '<div><a href="/series.php?name=' + escapeAttr(encodeURIComponent(btnscShowSearch(k))) + '">' + escapeHtml(name) + '</a>' +
        (year ? ' <span>(' + escapeHtml(year) + ')</span>' : '') +
        (role ? ' as ' + escapeHtml(role) : '') + '</div>';
    }).join('');
    card.innerHTML =
      '<a href="' + escapeAttr(actor.href) + '"><img class="btnsc-photo" alt="" loading="lazy" src="' + escapeAttr(photo) + '"></a>' +
      '<div>' +
      '<a class="btnsc-name" href="' + escapeAttr(actor.href) + '">' + escapeHtml(actor.tmdbName || actor.name) + '</a>' +
      '<div class="btnsc-meta">' +
      (actor.added ? '<span>Added ' + escapeHtml(actor.added.slice(0, 10)) + '</span>' : '') +
      (actor.place ? '<span>' + escapeHtml(actor.place) + '</span>' : '') +
      (actor.birthday ? '<span>' + escapeHtml(btnscYear(actor.birthday)) + '</span>' : '') +
      (actor.gender ? '<span>' + escapeHtml(actor.gender) + '</span>' : '') +
      '</div>' +
      '<div class="btnsc-known">' + (known ? '<b>Known for</b>' + known : '<b>Known for</b><div>TMDb match not found yet.</div>') + '</div>' +
      '<div class="btnsc-actions"><a href="' + escapeAttr(actor.href) + '">BTN Search</a>' +
      (actor.tmdbUrl ? '<a target="_blank" rel="noopener" href="' + escapeAttr(actor.tmdbUrl) + '">TMDb</a>' : '') +
      '</div></div>';
    const img = card.querySelector('.btnsc-photo');
    if (img) img.addEventListener('error', () => {
      img.src = placeholder;
    }, { once: true });
    return card;
  }

  function btnscRender(mount, actors) {
    mount.innerHTML = '';
    const panel = document.createElement('div');
    panel.className = 'btnsc-panel';
    const enriched = actors.filter(a => a.tmdbId).length;
    panel.innerHTML =
      '<div class="btnsc-head"><div>' +
      '<div class="btnsc-kicker">TMDb Actor Showcase</div>' +
      '<div class="btnsc-title">Actors Showcase</div>' +
      '<div class="btnsc-sub">Profile photos, clean cards and known-for TV credits from TMDb.</div>' +
      '</div><div class="btnsc-badge">' + escapeHtml(enriched + ' / ' + actors.length + ' matched') + '</div></div>';
    const grid = document.createElement('div');
    grid.className = 'btnsc-grid';
    actors.forEach(actor => grid.appendChild(btnscCard(actor)));
    panel.appendChild(grid);
    mount.appendChild(panel);
  }

  async function runActorShowcaseTmdb() {
    const actors = btnscNativeActors();
    if (!actors.length) return false;
    const mount = btnscMount();
    if (!mount) return false;
    if (mount.dataset.loading === '1') return true;
    mount.dataset.loading = '1';
    btnscStatus(mount, 'Refreshing actor photos and TV credits from TMDb...');
    try {
      const cache = btnscReadCache();
      const enriched = await btnscMapLimit(actors, 4, actor => btnscEnrichActor(actor, cache));
      btnscWriteCache(cache);
      btnscRender(mount, enriched);
    } catch (e) {
      console.error('[STMPE] BTN actor showcase error', e);
      btnscStatus(mount, e && e.message ? e.message : 'TMDb actor showcase failed.', true);
    } finally {
      mount.dataset.loading = '0';
    }
    return true;
  }

  /* =========================================================================
   * FEATURE: Actor Search (TMDb)
   *   Repair BTN actor search pages and enrich them from TMDb. The native page
   *   can render a broken/empty results table, so this mounts a replacement.
   * =======================================================================*/
  const BTNAS_IMG = 'https://image.tmdb.org/t/p/';

  function btnasCss() {
    injectCss('btnas-style', `
    body.stmpe-btn-actor #content,
    body.stmpe-btn-actor #content > .thin,
    body.stmpe-btn-actor .thin{ max-width:none!important; width:min(1760px,calc(100vw - 72px))!important; }
    body.stmpe-btn-actor .btnas-native-error{ display:none!important; }
    #btnas-mount{ margin:24px auto 34px; color:var(--text,#f4f7fb); }
    .btnas-panel{ border:1px solid rgba(55,133,180,.26); border-radius:18px; background:linear-gradient(145deg,rgba(7,9,13,.96),rgba(10,14,22,.92)); box-shadow:0 22px 64px rgba(0,0,0,.42), inset 0 1px 0 rgba(255,255,255,.04); overflow:hidden; }
    .btnas-head{ display:flex; align-items:center; justify-content:space-between; gap:18px; padding:16px 20px; border-bottom:1px solid rgba(55,133,180,.18); background:linear-gradient(90deg,rgba(31,157,255,.12),rgba(255,255,255,.025) 42%,rgba(31,157,255,.07)); }
    .btnas-kicker{ color:#38d8ff; font-size:12px; text-transform:uppercase; letter-spacing:.08em; font-weight:800; }
    .btnas-title{ margin-top:4px; font-size:24px; font-weight:900; color:#fff; }
    .btnas-sub{ margin-top:5px; color:var(--text-2,#aab4c1); font-size:13px; }
    .btnas-pillrow{ display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
    .btnas-pill,.btnas-linkpill,.btnas-tab{ display:inline-flex; align-items:center; gap:6px; min-height:30px; border:1px solid rgba(92,157,197,.24); border-radius:999px; padding:5px 11px; background:rgba(13,27,39,.72); color:#dcecf8!important; font-weight:800; font-size:12px; text-decoration:none!important; }
    .btnas-linkpill:hover,.btnas-tab:hover{ border-color:#38d8ff; color:#fff!important; box-shadow:0 0 18px rgba(56,216,255,.14); }
    .btnas-tab{ cursor:pointer; background:rgba(255,255,255,.035); }
    .btnas-tab.active{ background:linear-gradient(135deg,rgba(31,157,255,.28),rgba(56,216,255,.12)); border-color:rgba(56,216,255,.52); color:#fff!important; }
    .btnas-body{ display:grid; grid-template-columns:minmax(300px,380px) minmax(0,1fr); gap:22px; padding:22px; }
    .btnas-profile{ align-self:start; border:1px solid rgba(92,157,197,.2); border-radius:16px; background:linear-gradient(150deg,rgba(255,255,255,.05),rgba(255,255,255,.015)); overflow:hidden; }
    .btnas-profile-top{ display:grid; grid-template-columns:116px minmax(0,1fr); gap:16px; padding:16px; }
    .btnas-photo{ width:116px; aspect-ratio:2/3; object-fit:cover; border-radius:12px; background:rgba(255,255,255,.04); box-shadow:0 12px 28px rgba(0,0,0,.4); }
    .btnas-name{ color:#fff; font-size:22px; line-height:1.1; font-weight:900; }
    .btnas-role{ color:var(--text-2,#aab4c1); margin-top:8px; font-size:13px; }
    .btnas-bio{ padding:0 16px 16px; color:#c7d1dc; line-height:1.55; font-size:14px; }
    .btnas-section-title{ display:flex; align-items:center; justify-content:space-between; gap:12px; margin:0 0 12px; color:#fff; font-size:18px; font-weight:900; }
    .btnas-controls{ display:flex; flex-wrap:wrap; gap:9px; align-items:center; justify-content:space-between; margin-bottom:14px; }
    .btnas-count{ color:var(--text-2,#aab4c1); font-size:12px; font-weight:800; text-transform:uppercase; letter-spacing:.05em; }
    .btnas-grid{ display:grid; grid-template-columns:repeat(auto-fit,minmax(430px,1fr)); gap:14px; align-items:stretch; }
    .btnas-card{ display:grid; grid-template-columns:92px minmax(0,1fr); gap:14px; min-height:158px; border:1px solid rgba(92,157,197,.16); border-radius:16px; padding:13px; background:linear-gradient(145deg,rgba(8,10,14,.98),rgba(12,17,25,.88)); box-shadow:0 16px 36px rgba(0,0,0,.28); }
    .btnas-poster{ width:92px; aspect-ratio:2/3; object-fit:cover; border-radius:11px; background:linear-gradient(135deg,rgba(31,157,255,.18),rgba(255,255,255,.04)); }
    .btnas-card h4{ margin:0; color:#fff; font-size:17px; line-height:1.25; }
    .btnas-card h4 a{ color:#fff!important; text-decoration:none!important; }
    .btnas-card h4 a:hover{ color:#38d8ff!important; }
    .btnas-meta{ margin-top:7px; display:flex; flex-wrap:wrap; gap:7px; color:#9eb0c0; font-size:12px; }
    .btnas-meta span{ border:1px solid rgba(255,255,255,.08); border-radius:999px; padding:3px 8px; background:rgba(255,255,255,.035); }
    .btnas-character{ margin-top:9px; color:#d8e2ec; font-size:13px; font-weight:800; }
    .btnas-overview{ margin-top:9px; color:#aeb9c5; line-height:1.45; font-size:13px; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
    .btnas-actions{ display:flex; flex-wrap:wrap; gap:7px; margin-top:11px; }
    .btnas-actions a{ color:#dcecf8!important; text-decoration:none!important; border:1px solid rgba(92,157,197,.2); border-radius:999px; padding:4px 8px; font-size:11px; font-weight:900; background:rgba(255,255,255,.035); }
    .btnas-actions a:hover{ border-color:#38d8ff; color:#fff!important; }
    .btnas-other{ padding:14px 16px; border-top:1px solid rgba(92,157,197,.14); }
    .btnas-other .btnas-pillrow{ margin-top:9px; }
    .btnas-person-pick{ cursor:pointer; }
    .btnas-status{ padding:26px; text-align:center; color:#c7d1dc; }
    .btnas-error{ color:#ff9f9f; }
    .btnas-spin{ width:28px; height:28px; border-radius:50%; border:3px solid rgba(56,216,255,.18); border-top-color:#38d8ff; margin:0 auto 12px; animation:btnas-spin .85s linear infinite; }
    @keyframes btnas-spin{ to{ transform:rotate(360deg); } }
    @media (max-width:900px){
      body.stmpe-btn-actor #content,body.stmpe-btn-actor #content > .thin,body.stmpe-btn-actor .thin{ width:calc(100vw - 24px)!important; }
      .btnas-body{ grid-template-columns:1fr; padding:14px; }
      .btnas-head{ align-items:flex-start; flex-direction:column; }
      .btnas-grid{ grid-template-columns:1fr; }
      .btnas-card{ grid-template-columns:76px minmax(0,1fr); }
      .btnas-poster{ width:76px; }
    }`);
  }

  function btnasEl(tag, attrs, kids) {
    const el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(k => {
      if (k === 'class') el.className = attrs[k];
      else if (k === 'text') el.textContent = attrs[k];
      else if (k === 'html') el.innerHTML = attrs[k];
      else if (k === 'dataset') Object.assign(el.dataset, attrs[k]);
      else el.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(k => {
      if (k == null) return;
      el.appendChild(typeof k === 'string' ? document.createTextNode(k) : k);
    });
    return el;
  }

  function btnasTrunc(s, n) {
    s = String(s || '').replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n - 1).trim() + '…' : s;
  }

  function btnasImg(path, size) {
    return path ? BTNAS_IMG + (size || 'w342') + path : '';
  }

  function btnasYear(d) {
    return d ? String(d).slice(0, 4) : '';
  }

  function btnasJoin(arr, sep) {
    return (arr || []).filter(Boolean).join(sep || ' · ');
  }

  function btnasUrl(path, params) {
    const key = (getKey('trending') || '').trim();
    const qs = new URLSearchParams(Object.assign({ api_key: key, language: 'en-US' }, params || {}));
    return 'https://api.themoviedb.org/3' + path + '?' + qs.toString();
  }

  async function btnasTmdb(path, params) {
    const key = (getKey('trending') || '').trim();
    if (!key) throw new Error('Missing TMDb API key. Add it in the Userscript Manager on your profile settings page.');
    const raw = await gmGet(btnasUrl(path, params));
    return JSON.parse(raw || '{}');
  }

  function btnasQuery() {
    const qs = new URLSearchParams(location.search);
    const raw = qs.get('name') || qs.get('search') || qs.get('artistname') || '';
    if (raw.trim()) return raw.trim();
    const h1 = document.querySelector('h1, .header h2, .box .head');
    return h1 ? h1.textContent.replace(/\s+/g, ' ').trim() : '';
  }

  function btnasForcedId() {
    const m = String(location.hash || '').match(/(?:tmdb-)?(\d+)/i);
    return m ? Number(m[1]) : null;
  }

  function btnasHideNativeError() {
    const scope = document.querySelector('#content') || document.body;
    const hide = el => { if (el) el.classList.add('btnas-native-error'); };
    [...scope.querySelectorAll('h1,h2,h3,h4,strong,b')].forEach(el => {
      const txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (/^error(?:\s+404)?$/i.test(txt)) hide(el);
    });
    [...scope.querySelectorAll('.box,.pad,.body,table,div,p')].forEach(el => {
      if (el.id === 'btnas-mount' || el.closest('#btnas-mount')) return;
      const txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (/error\s*404/i.test(txt) ||
          /page (?:that )?doesn'?t really exist/i.test(txt) ||
          /don'?t have enough permission to view/i.test(txt)) {
        const box = el.closest('.box') || el;
        hide(box);
      }
    });
  }

  function btnasMount() {
    btnasCss();
    document.body.classList.add('stmpe-btn-actor');
    btnasHideNativeError();
    const nativeTable = document.getElementById('torrent_table');
    if (nativeTable) nativeTable.style.display = 'none';
    let mount = document.getElementById('btnas-mount');
    if (mount) return mount;
    mount = btnasEl('div', { id: 'btnas-mount', class: 'snr' });

    const anchor =
      nativeTable ||
      document.querySelector('.main_column .box') ||
      document.querySelector('.main_column') ||
      document.querySelector('#content .thin') ||
      document.querySelector('#content') ||
      document.body;
    const parent = anchor.parentNode || document.body;
    if (anchor === document.body) document.body.appendChild(mount);
    else parent.insertBefore(mount, anchor.nextSibling);
    return mount;
  }

  function btnasSetStatus(mount, msg, bad) {
    mount.innerHTML =
      '<div class="btnas-panel"><div class="btnas-status">' +
      (bad ? '' : '<div class="btnas-spin"></div>') +
      '<div class="' + (bad ? 'btnas-error' : '') + '">' + escapeHtml(msg) + '</div>' +
      '</div></div>';
  }

  function btnasCreditKey(c) {
    return (c.media_type || 'tv') + ':' + c.id;
  }

  function btnasNormaliseCredits(person) {
    const map = new Map();
    const cast = (((person || {}).combined_credits || {}).cast || []).map(c => Object.assign({}, c, { credit_kind: 'cast' }));
    const crew = (((person || {}).combined_credits || {}).crew || []).map(c => Object.assign({}, c, { credit_kind: 'crew' }));
    cast.concat(crew).forEach(c => {
      if (!c || !c.id || (c.media_type !== 'tv' && c.media_type !== 'movie')) return;
      const key = btnasCreditKey(c);
      const existing = map.get(key);
      const role = c.character || c.job || '';
      if (existing) {
        if (role && !existing.roles.includes(role)) existing.roles.push(role);
        existing.episode_count = Math.max(existing.episode_count || 0, c.episode_count || 0);
        existing.creditKinds.add(c.credit_kind);
        return;
      }
      map.set(key, {
        id: c.id,
        media_type: c.media_type,
        title: c.name || c.title || c.original_name || c.original_title || 'Untitled',
        poster_path: c.poster_path,
        backdrop_path: c.backdrop_path,
        overview: c.overview || '',
        first_date: c.first_air_date || c.release_date || '',
        popularity: Number(c.popularity || 0),
        vote_average: Number(c.vote_average || 0),
        vote_count: Number(c.vote_count || 0),
        episode_count: Number(c.episode_count || 0),
        roles: role ? [role] : [],
        creditKinds: new Set([c.credit_kind])
      });
    });
    return [...map.values()].sort((a, b) => {
      const ay = Number(btnasYear(a.first_date) || 0);
      const by = Number(btnasYear(b.first_date) || 0);
      if (by !== ay) return by - ay;
      return (b.popularity || 0) - (a.popularity || 0);
    });
  }

  async function btnasAddDetails(rows) {
    const topTv = rows.filter(r => r.media_type === 'tv').slice(0, 36);
    await Promise.all(topTv.map(async r => {
      try {
        const d = await btnasTmdb('/tv/' + encodeURIComponent(r.id), { append_to_response: 'external_ids,content_ratings,keywords' });
        r.status = d.status || '';
        r.type = d.type || '';
        r.last_date = d.last_air_date || '';
        r.networks = (d.networks || []).map(n => n.name).filter(Boolean);
        r.genres = (d.genres || []).map(g => g.name).filter(Boolean);
        r.seasons = d.number_of_seasons || 0;
        r.episodes = d.number_of_episodes || 0;
        r.runtime = (d.episode_run_time || [])[0] || 0;
        r.countries = d.origin_country || [];
        r.homepage = d.homepage || '';
        r.imdb_id = d.external_ids && d.external_ids.imdb_id;
        r.tvdb_id = d.external_ids && d.external_ids.tvdb_id;
        r.poster_path = r.poster_path || d.poster_path;
        r.backdrop_path = r.backdrop_path || d.backdrop_path;
        r.overview = r.overview || d.overview || '';
        r.vote_average = r.vote_average || Number(d.vote_average || 0);
        r.vote_count = r.vote_count || Number(d.vote_count || 0);
      } catch (e) {}
    }));
    return rows;
  }

  function btnasIsSelfCredit(r) {
    return (r.roles || []).join(' ').match(/\b(self|himself|herself|archive footage|guest)\b/i);
  }

  function btnasExternalPills(person) {
    const ids = (person && person.external_ids) || {};
    const out = [
      ['TMDb', 'https://www.themoviedb.org/person/' + person.id],
      ids.imdb_id && ['IMDb', 'https://www.imdb.com/name/' + ids.imdb_id + '/'],
      ids.wikidata_id && ['Wikidata', 'https://www.wikidata.org/wiki/' + ids.wikidata_id],
      ids.instagram_id && ['Instagram', 'https://www.instagram.com/' + ids.instagram_id + '/'],
      ids.twitter_id && ['X', 'https://x.com/' + ids.twitter_id],
      ids.facebook_id && ['Facebook', 'https://www.facebook.com/' + ids.facebook_id]
    ].filter(Boolean);
    return out.map(([label, href]) => btnasEl('a', { class: 'btnas-linkpill', href, target: '_blank', rel: 'noopener', text: label }));
  }

  function btnasShowSearchQuery(r) {
    const year = btnasYear(r && r.first_date);
    return btnasJoin([r && r.title, year], ' ');
  }

  function btnasCreditCard(r) {
    const poster = btnasImg(r.poster_path, 'w185');
    const year = btnasYear(r.first_date);
    const years = r.last_date && btnasYear(r.last_date) && btnasYear(r.last_date) !== year ? year + '-' + btnasYear(r.last_date) : year;
    const roles = btnasJoin((r.roles || []).slice(0, 3), ', ');
    const btnShowQuery = btnasShowSearchQuery(r);
    const titleHref = r.media_type === 'tv'
      ? '/series.php?name=' + encodeURIComponent(btnShowQuery)
      : 'https://www.themoviedb.org/movie/' + encodeURIComponent(r.id);
    const card = btnasEl('article', { class: 'btnas-card', dataset: { media: r.media_type, self: btnasIsSelfCredit(r) ? '1' : '0' } });
    card.innerHTML =
      '<img class="btnas-poster" alt="" src="' + escapeAttr(poster || 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22185%22 height=%22278%22 viewBox=%220 0 185 278%22%3E%3Crect width=%22185%22 height=%22278%22 fill=%22%23080b10%22/%3E%3Cpath d=%22M48 95h89v88H48z%22 fill=%22%23142637%22/%3E%3Cpath d=%22M65 118h55v10H65zm0 24h55v10H65%22 stroke=%22%2338d8ff%22 stroke-width=%226%22 stroke-linecap=%22round%22/%3E%3C/svg%3E') + '">' +
      '<div><h4><a href="' + escapeAttr(titleHref) + '">' + escapeHtml(r.title) + '</a></h4>' +
      '<div class="btnas-meta">' +
      (r.media_type ? '<span>' + escapeHtml(r.media_type === 'tv' ? 'TV' : 'Movie') + '</span>' : '') +
      (years ? '<span>' + escapeHtml(years) + '</span>' : '') +
      (r.type ? '<span>' + escapeHtml(r.type) + '</span>' : '') +
      (r.status ? '<span>' + escapeHtml(r.status) + '</span>' : '') +
      (r.vote_average ? '<span>TMDb ' + escapeHtml(r.vote_average.toFixed(1)) + '</span>' : '') +
      (r.seasons ? '<span>' + escapeHtml(r.seasons + ' season' + (r.seasons === 1 ? '' : 's')) + '</span>' : '') +
      (r.episodes ? '<span>' + escapeHtml(r.episodes + ' eps') + '</span>' : '') +
      (r.runtime ? '<span>' + escapeHtml(r.runtime + 'm') + '</span>' : '') +
      (r.networks && r.networks.length ? '<span>' + escapeHtml(btnasTrunc(btnasJoin(r.networks.slice(0, 2), ' / '), 34)) + '</span>' : '') +
      '</div>' +
      (roles ? '<div class="btnas-character">' + escapeHtml(roles) + (r.episode_count ? ' · ' + escapeHtml(r.episode_count + ' eps') : '') + '</div>' : '') +
      (r.genres && r.genres.length ? '<div class="btnas-meta">' + r.genres.slice(0, 4).map(g => '<span>' + escapeHtml(g) + '</span>').join('') + '</div>' : '') +
      (r.overview ? '<div class="btnas-overview">' + escapeHtml(r.overview) + '</div>' : '') +
      '<div class="btnas-actions">' +
      (r.media_type === 'tv' ? '<a href="/series.php?name=' + escapeAttr(encodeURIComponent(btnShowQuery)) + '">BTN Search</a>' : '') +
      '<a target="_blank" rel="noopener" href="https://www.themoviedb.org/' + escapeAttr(r.media_type) + '/' + escapeAttr(r.id) + '">TMDb</a>' +
      (r.imdb_id ? '<a target="_blank" rel="noopener" href="https://www.imdb.com/title/' + escapeAttr(r.imdb_id) + '/">IMDb</a>' : '') +
      (r.tvdb_id ? '<a target="_blank" rel="noopener" href="https://thetvdb.com/dereferrer/series/' + escapeAttr(r.tvdb_id) + '">TVDb</a>' : '') +
      '</div></div>';
    return card;
  }

  function btnasRender(mount, query, person, matches, credits) {
    const tvCredits = credits.filter(r => r.media_type === 'tv');
    const movieCredits = credits.filter(r => r.media_type === 'movie');
    const selfCount = credits.filter(btnasIsSelfCredit).length;
    mount.innerHTML = '';
    const root = btnasEl('div', { class: 'btnas-panel' });
    const top = btnasEl('div', { class: 'btnas-head' }, [
      btnasEl('div', {}, [
        btnasEl('div', { class: 'btnas-kicker', text: 'TMDb Actor Search' }),
        btnasEl('div', { class: 'btnas-title', text: person.name || query }),
        btnasEl('div', { class: 'btnas-sub', text: 'Matched from "' + query + '" · ' + tvCredits.length + ' TV credits · ' + movieCredits.length + ' movie credits' })
      ]),
      btnasEl('div', { class: 'btnas-pillrow' }, btnasExternalPills(person))
    ]);
    const body = btnasEl('div', { class: 'btnas-body' });
    const profile = btnasEl('aside', { class: 'btnas-profile' });
    const photo = btnasEl('img', { class: 'btnas-photo', alt: '', src: btnasImg(person.profile_path, 'w342') || 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22342%22 height=%22513%22 viewBox=%220 0 342 513%22%3E%3Crect width=%22342%22 height=%22513%22 fill=%22%23080b10%22/%3E%3Ccircle cx=%22171%22 cy=%22175%22 r=%2270%22 fill=%22%23142637%22/%3E%3Cpath d=%22M70 415c22-84 180-84 202 0%22 fill=%22%23142637%22/%3E%3C/svg%3E' });
    const chips = [];
    if (person.known_for_department) chips.push(btnasEl('span', { class: 'btnas-pill', text: person.known_for_department }));
    if (person.birthday) chips.push(btnasEl('span', { class: 'btnas-pill', text: person.deathday ? person.birthday + ' - ' + person.deathday : person.birthday }));
    if (person.place_of_birth) chips.push(btnasEl('span', { class: 'btnas-pill', text: btnasTrunc(person.place_of_birth, 34) }));
    if (person.popularity) chips.push(btnasEl('span', { class: 'btnas-pill', text: 'Popularity ' + Math.round(person.popularity) }));
    profile.appendChild(btnasEl('div', { class: 'btnas-profile-top' }, [
      photo,
      btnasEl('div', {}, [
        btnasEl('div', { class: 'btnas-name', text: person.name || query }),
        btnasEl('div', { class: 'btnas-role', text: person.also_known_as && person.also_known_as.length ? btnasTrunc(person.also_known_as.slice(0, 3).join(' · '), 96) : 'TMDb person profile' }),
        btnasEl('div', { class: 'btnas-pillrow', style: 'margin-top:12px;' }, chips)
      ])
    ]));
    profile.appendChild(btnasEl('div', { class: 'btnas-bio', text: person.biography || 'No biography available from TMDb yet.' }));
    const other = (matches || []).filter(p => p.id !== person.id).slice(0, 6);
    if (other.length) {
      const otherBox = btnasEl('div', { class: 'btnas-other' }, [
        btnasEl('div', { class: 'btnas-count', text: 'Other possible matches' }),
        btnasEl('div', { class: 'btnas-pillrow' }, other.map(p => {
          const a = btnasEl('button', { type: 'button', class: 'btnas-pill btnas-person-pick', text: p.name + (p.known_for_department ? ' · ' + p.known_for_department : '') });
          a.addEventListener('click', () => {
            location.hash = 'tmdb-' + p.id;
            runActorSearchTmdb(true);
          });
          return a;
        }))
      ]);
      profile.appendChild(otherBox);
    }

    const main = btnasEl('main', {});
    const tabs = btnasEl('div', { class: 'btnas-controls' }, [
      btnasEl('div', { class: 'btnas-pillrow' }, [
        btnasEl('button', { type: 'button', class: 'btnas-tab active', dataset: { filter: 'tv' }, text: 'TV credits' }),
        btnasEl('button', { type: 'button', class: 'btnas-tab', dataset: { filter: 'movie' }, text: 'Movies' }),
        btnasEl('button', { type: 'button', class: 'btnas-tab', dataset: { filter: 'all' }, text: 'All credits' }),
        btnasEl('button', { type: 'button', class: 'btnas-tab', dataset: { filter: 'acting' }, text: 'Acting only' }),
        selfCount ? btnasEl('button', { type: 'button', class: 'btnas-tab', dataset: { filter: 'noself' }, text: 'Hide self/archive' }) : null
      ]),
      btnasEl('div', { class: 'btnas-count', text: credits.length + ' total credits' })
    ]);
    const grid = btnasEl('div', { class: 'btnas-grid' }, credits.map(btnasCreditCard));
    function applyFilter(filter) {
      tabs.querySelectorAll('.btnas-tab').forEach(b => b.classList.toggle('active', b.dataset.filter === filter));
      grid.querySelectorAll('.btnas-card').forEach(card => {
        const show =
          filter === 'all' ||
          (filter === 'tv' && card.dataset.media === 'tv') ||
          (filter === 'movie' && card.dataset.media === 'movie') ||
          (filter === 'acting' && card.dataset.self !== '1') ||
          (filter === 'noself' && card.dataset.self !== '1');
        card.style.display = show ? '' : 'none';
      });
    }
    tabs.addEventListener('click', e => {
      const b = e.target.closest('.btnas-tab');
      if (b) applyFilter(b.dataset.filter || 'tv');
    });
    main.appendChild(btnasEl('div', { class: 'btnas-section-title' }, [
      btnasEl('span', { text: 'Credits' }),
      btnasEl('span', { class: 'btnas-count', text: 'Sorted by newest first' })
    ]));
    main.appendChild(tabs);
    main.appendChild(grid);
    body.appendChild(profile);
    body.appendChild(main);
    root.appendChild(top);
    root.appendChild(body);
    mount.appendChild(root);
    applyFilter('tv');
  }

  async function runActorSearchTmdb(force) {
    const mount = btnasMount();
    if (mount.dataset.loading === '1' && !force) return true;
    const query = btnasQuery();
    if (!query) {
      btnasSetStatus(mount, 'Enter an actor name to search TMDb.', true);
      return true;
    }
    mount.dataset.loading = '1';
    btnasSetStatus(mount, 'Searching TMDb for ' + query + '…');
    try {
      const search = await btnasTmdb('/search/person', { query, include_adult: 'false', page: '1' });
      const matches = (search.results || []).filter(p => p && p.id);
      if (!matches.length) {
        btnasSetStatus(mount, 'No TMDb actor matches found for ' + query + '.', true);
        return true;
      }
      const forced = btnasForcedId();
      const exact = matches.find(p => (p.name || '').toLowerCase() === query.toLowerCase());
      const picked = (forced && matches.find(p => p.id === forced)) || exact || matches[0];
      btnasSetStatus(mount, 'Loading TMDb profile and credits for ' + (picked.name || query) + '…');
      const person = await btnasTmdb('/person/' + encodeURIComponent(picked.id), { append_to_response: 'combined_credits,external_ids,images' });
      const credits = await btnasAddDetails(btnasNormaliseCredits(person));
      btnasRender(mount, query, person, matches, credits);
    } catch (e) {
      console.error('[STMPE] BTN actor search error', e);
      btnasSetStatus(mount, e && e.message ? e.message : 'TMDb actor enrichment failed.', true);
    } finally {
      mount.dataset.loading = '0';
    }
    return true;
  }

  /* =========================================================================
   * FEATURE: Collapsible News (homepage)
   *   Add a collapse caret to the front-page news post's header so it can be
   *   hidden once read (state remembered per article, so a new post re-opens),
   *   and replace the [1][2][3][4][5] news pager with a single News Section link.
   * =======================================================================*/
  const NEWS_KEY = 'btn_news_collapsed_v1';
  function newsGetMap() {
    try {
      let raw = '{}';
      if (typeof GM_getValue === 'function') raw = GM_getValue(NEWS_KEY, '{}');
      else { const v = localStorage.getItem('GM_' + NEWS_KEY); raw = (v == null) ? '{}' : v; }
      return JSON.parse(raw || '{}') || {};
    } catch (e) { return {}; }
  }
  function newsSaveMap(m) {
    try {
      if (typeof GM_setValue === 'function') GM_setValue(NEWS_KEY, JSON.stringify(m));
      else localStorage.setItem('GM_' + NEWS_KEY, JSON.stringify(m));
    } catch (e) {}
  }

  function runNewsCollapse() {
    const post = document.querySelector('#news_post');
    if (!post) return false;
    if (post.dataset.snrNews) return true;
    const head = post.querySelector('.head');
    const body = post.querySelector('.pad');
    if (!head || !body) return false;
    post.dataset.snrNews = '1';

    // Key the collapsed state by the post's discussion thread id (stable), so a
    // brand-new news post — a different thread id — starts expanded again.
    let key = 'news';
    const disc = head.querySelector('a[href*="thread"]');
    const m = disc ? ((disc.getAttribute('href') || '').match(/threadid=(\d+)/)) : null;
    if (m) key = 'news_' + m[1];
    else { const t = head.querySelector('strong'); if (t) key = 'news_' + t.textContent.trim().toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 24); }

    let collapsed = !!newsGetMap()[key];
    const caret = document.createElement('span');
    caret.className = 'snr-news-caret';
    head.insertBefore(caret, head.firstChild);
    head.style.cursor = 'pointer';
    const apply = () => { body.style.display = collapsed ? 'none' : ''; caret.textContent = collapsed ? '▸' : '▾'; };
    apply();
    head.addEventListener('click', (e) => {
      if (e.target.closest('a')) return; // let the [Discuss] link work
      collapsed = !collapsed;
      const mm = newsGetMap();
      if (collapsed) mm[key] = 1; else delete mm[key];
      newsSaveMap(mm);
      apply();
    });

    // Replace the [1][2][3][4][5] news pager with a single News Section link.
    const box = post.parentElement;
    const pager = box && box.querySelector('.extrapad');
    if (pager && !pager.dataset.snrNews) {
      pager.dataset.snrNews = '1';
      pager.innerHTML = '';
      const c = document.createElement('center');
      const a = document.createElement('a');
      a.className = 'snr-news-link';
      a.href = 'https://broadcasthe.net/news.php';
      a.textContent = 'News Section →';
      c.appendChild(a);
      pager.appendChild(c);
    }
    return true;
  }

  /* =========================================================================
   * FEATURE: Series Collection Wizard
   * ---------------------------------------------------------------------
   * WHY:
   *   The Series Collector panel is a bare table of eight controls with no
   *   explanation of what any of them do. It is the site's own downloader
   *   though, and it works — so this replaces only the front of it. The panel
   *   collapses to its head, and clicking that opens a modal that asks one
   *   question at a time, writes each answer into the real control, and then
   *   clicks the site's own Download button. Nothing about how the collecting
   *   works is reimplemented here.
   *
   * WHY READ THE FORM INSTEAD OF LISTING THE OPTIONS:
   *   Every question is built from the live <select> and its <option>s, so if
   *   a codec, source or resolution is added to the site the wizard offers it
   *   without a change here. The "--" option becomes "Any" and leaves the
   *   control untouched.
   * =======================================================================*/
  const CW_MODAL_ID = 'wtr-cw-modal';

  // Friendlier phrasing than the panel's one-word labels. Anything not listed
  // falls back to the site's own label, so a new row still reads sensibly.
  const CW_QUESTIONS = {
    'foreign':    { q: 'English or foreign audio?', hint: 'Leave it open unless you specifically want one or the other.' },
    'origin':     { q: 'Which release origin?',     hint: 'Who put the release out — a scene group, P2P, or an internal encoder.' },
    'codec':      { q: 'Which video codec?',        hint: 'H.264 is the safe pick for most players; H.265 is smaller but fussier.' },
    'container':  { q: 'Which container?',          hint: 'The file wrapper. MKV is the most common for TV.' },
    'source':     { q: 'Where should it come from?',hint: 'The material the release was made from.' },
    'resolution': { q: 'Which resolution?',         hint: 'Higher is bigger. 1080p is the usual sweet spot.' }
  };

  function cwFindBox() {
    return [...document.querySelectorAll('.sidebar > .box')].find(b => {
      const head = b.querySelector(':scope > .head');
      return head && /^series collector$/i.test(head.textContent.trim()) && b.querySelector('form');
    }) || null;
  }

  /* Build the question list from whatever the form actually contains. */
  function cwBuildSteps(form) {
    const steps = [];
    const ep = form.querySelector('input[name="episode"]');
    const se = form.querySelector('input[name="season"]');

    // The two checkboxes are one decision to a person, so ask them as one.
    if (ep || se) {
      steps.push({
        key: 'scope',
        label: 'Collect',
        question: 'What should it collect?',
        hint: 'Season packs, single episodes, or leave it open to take whatever is there.',
        options: [
          { value: 'any',  label: 'Anything',     note: 'No preference' },
          { value: 'ep',   label: 'Episodes',     note: 'Individual episodes only' },
          { value: 'se',   label: 'Season packs', note: 'Whole seasons only' },
          { value: 'both', label: 'Both',         note: 'Episodes and season packs' }
        ],
        answerLabel(v) { return (this.options.find(o => o.value === v) || {}).label || 'Anything'; },
        apply(v) {
          if (ep) ep.checked = (v === 'ep' || v === 'both');
          if (se) se.checked = (v === 'se' || v === 'both');
        }
      });
    }

    form.querySelectorAll('select').forEach(sel => {
      const row = sel.closest('tr');
      const cell = row ? row.querySelector('td') : null;
      const label = (cell ? cell.textContent.trim() : '') || sel.name;
      const copy = CW_QUESTIONS[label.toLowerCase()] || {};
      const options = [{ value: '', label: 'Any', note: 'No preference' }].concat(
        [...sel.options]
          .filter(o => o.value !== '')
          .map(o => ({ value: o.value, label: o.textContent.trim() }))
      );
      steps.push({
        key: sel.name,
        label,
        question: copy.q || ('Which ' + label.toLowerCase() + '?'),
        hint: copy.hint || '',
        options,
        answerLabel(v) { return (this.options.find(o => o.value === v) || {}).label || 'Any'; },
        apply(v) { sel.value = v; }
      });
    });

    return steps;
  }

  function cwInjectStyle() {
    injectCss('wtr-cw-style', `
      /* --- the collapsed panel --- */
      .wtr-cw-host>form{display:none !important;}
      .wtr-cw-host>.head{cursor:pointer;user-select:none;transition:background .18s ease;}
      .wtr-cw-host>.head:hover{background:var(--bg-3,#181c22);}
      .wtr-cw-cue{
        margin-left:auto;display:inline-flex;align-items:center;gap:6px;
        font-family:var(--ff,Inter,sans-serif);font-weight:500;font-size:11.5px;
        letter-spacing:.02em;color:var(--text-2,#8b94a1);transition:color .18s ease,transform .18s ease;
      }
      .wtr-cw-host>.head:hover .wtr-cw-cue{color:var(--accent-bright,#3fc8ff);transform:translateX(2px);}
      .wtr-cw-cue::after{content:"\\203A";font-size:15px;line-height:1;}

      /* --- overlay --- */
      #${CW_MODAL_ID}{
        position:fixed;inset:0;z-index:99998;display:flex;align-items:center;justify-content:center;
        padding:24px;background:rgba(4,6,9,.66);backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px);
        opacity:0;transition:opacity .22s ease;font-family:var(--ff,Inter,-apple-system,sans-serif);
      }
      #${CW_MODAL_ID}.is-open{opacity:1;}

      /* --- card --- */
      .wtr-cw-card{
        width:min(560px,100%);max-height:min(660px,calc(100vh - 48px));display:flex;flex-direction:column;
        background:var(--panel,linear-gradient(180deg,#14181e 0%,#0f1216 100%));
        border:1px solid var(--line,#232830);border-radius:var(--radius,16px);
        box-shadow:0 30px 80px rgba(0,0,0,.6),0 0 40px rgba(63,200,255,.07);
        transform:translateY(16px) scale(.975);opacity:0;
        transition:transform .3s cubic-bezier(.16,1,.3,1),opacity .24s ease;overflow:hidden;
      }
      #${CW_MODAL_ID}.is-open .wtr-cw-card{transform:none;opacity:1;}

      .wtr-cw-top{padding:18px 20px 0;}
      .wtr-cw-titlerow{display:flex;align-items:baseline;gap:10px;}
      .wtr-cw-title{
        font-family:var(--fd,'Space Grotesk',Inter,sans-serif);font-weight:600;font-size:15px;
        color:var(--text,#f4f7fb);letter-spacing:.01em;margin:0;
      }
      .wtr-cw-count{margin-left:auto;font-size:11.5px;color:var(--text-3,#5a626d);letter-spacing:.04em;}
      .wtr-cw-x{
        appearance:none;background:none;border:0;cursor:pointer;padding:4px;margin:-4px -4px -4px 8px;
        color:var(--text-3,#5a626d);font-size:17px;line-height:1;transition:color .15s ease;
      }
      .wtr-cw-x:hover{color:var(--text,#f4f7fb);}
      .wtr-cw-rail{height:2px;margin:14px 0 0;background:var(--line,#232830);border-radius:2px;overflow:hidden;}
      .wtr-cw-bar{
        height:100%;width:0;border-radius:2px;
        background:var(--grad-accent,linear-gradient(135deg,#3fc8ff 0%,#1f6feb 100%));
        transition:width .34s cubic-bezier(.16,1,.3,1);
      }

      .wtr-cw-body{padding:20px;overflow-y:auto;flex:1 1 auto;}
      .wtr-cw-q{
        font-family:var(--fd,'Space Grotesk',Inter,sans-serif);font-weight:600;font-size:19px;line-height:1.3;
        color:var(--text,#f4f7fb);margin:0 0 6px;
      }
      .wtr-cw-hint{font-size:12.5px;line-height:1.5;color:var(--text-2,#8b94a1);margin:0 0 16px;}

      .wtr-cw-opts{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;}
      .wtr-cw-opt{
        appearance:none;text-align:left;cursor:pointer;
        padding:11px 13px;border-radius:var(--radius-sm,10px);
        background:var(--bg-2,#12151a);border:1px solid var(--line,#232830);
        color:var(--text-1,#cdd4de);font-family:inherit;font-size:13px;font-weight:500;
        transition:border-color .15s ease,background .15s ease,color .15s ease,transform .12s ease;
      }
      .wtr-cw-opt:hover{background:var(--bg-3,#181c22);border-color:var(--line-2,#2d333c);color:var(--text,#f4f7fb);}
      .wtr-cw-opt:focus-visible{outline:none;box-shadow:var(--ring,0 0 0 2px rgba(63,200,255,.55));}
      .wtr-cw-opt.is-picked{
        border-color:var(--accent-bright,#3fc8ff);color:var(--text,#f4f7fb);
        background:var(--accent-soft,rgba(31,157,255,.14));transform:scale(.985);
      }
      .wtr-cw-opt .n{display:block;margin-top:3px;font-size:11px;font-weight:400;color:var(--text-3,#5a626d);}

      /* --- review --- */
      .wtr-cw-review{display:flex;flex-direction:column;gap:1px;background:var(--line,#232830);
        border:1px solid var(--line,#232830);border-radius:var(--radius-sm,10px);overflow:hidden;}
      .wtr-cw-rrow{
        display:flex;align-items:center;gap:12px;padding:10px 13px;background:var(--bg-1,#0d0f12);
        cursor:pointer;transition:background .15s ease;
      }
      .wtr-cw-rrow:hover{background:var(--bg-2,#12151a);}
      .wtr-cw-rk{font-size:12px;color:var(--text-2,#8b94a1);min-width:96px;}
      .wtr-cw-rv{font-size:13px;font-weight:600;color:var(--text,#f4f7fb);}
      .wtr-cw-rv.is-any{font-weight:400;color:var(--text-3,#5a626d);}
      .wtr-cw-redit{margin-left:auto;font-size:11px;color:var(--text-3,#5a626d);}
      .wtr-cw-rrow:hover .wtr-cw-redit{color:var(--accent-bright,#3fc8ff);}

      /* --- footer --- */
      .wtr-cw-foot{
        display:flex;align-items:center;gap:10px;padding:14px 20px;
        border-top:1px solid var(--line,#232830);background:var(--bg-1,#0d0f12);
      }
      .wtr-cw-btn{
        appearance:none;cursor:pointer;font-family:inherit;font-size:13px;font-weight:600;
        padding:9px 16px;border-radius:var(--radius-xs,7px);
        border:1px solid var(--line-2,#2d333c);background:var(--bg-2,#12151a);color:var(--text-1,#cdd4de);
        transition:background .15s ease,color .15s ease,border-color .15s ease,opacity .15s ease;
      }
      .wtr-cw-btn:hover{background:var(--bg-3,#181c22);color:var(--text,#f4f7fb);}
      .wtr-cw-btn:disabled{opacity:.35;cursor:default;}
      .wtr-cw-btn.is-go{
        margin-left:auto;border-color:transparent;color:#04121c;
        background:var(--grad-accent,linear-gradient(135deg,#3fc8ff 0%,#1f6feb 100%));
      }
      .wtr-cw-btn.is-go:hover{filter:brightness(1.08);color:#04121c;}

      /* --- motion --- */
      @keyframes wtrCwIn{from{opacity:0;transform:translateX(var(--wtr-cw-dx,14px));}to{opacity:1;transform:none;}}
      .wtr-cw-anim{animation:wtrCwIn .3s cubic-bezier(.16,1,.3,1) both;}
      .wtr-cw-opts .wtr-cw-opt{animation:wtrCwIn .28s cubic-bezier(.16,1,.3,1) both;}
      @media (prefers-reduced-motion:reduce){
        #${CW_MODAL_ID},.wtr-cw-card,.wtr-cw-bar{transition:none;}
        .wtr-cw-anim,.wtr-cw-opts .wtr-cw-opt{animation:none;}
      }
      @media (max-width:560px){.wtr-cw-opts{grid-template-columns:1fr;}}
    `);
  }

  function runCollectWizard() {
    const box = cwFindBox();
    if (!box) return false;
    const form = box.querySelector('form');
    const head = box.querySelector(':scope > .head');
    if (!form || !head || box.classList.contains('wtr-cw-host')) return true;

    const steps = cwBuildSteps(form);
    if (!steps.length) return true;

    cwInjectStyle();
    box.classList.add('wtr-cw-host');

    const strong = head.querySelector('strong') || head;
    strong.textContent = 'Series Collection Wizard';
    const cue = document.createElement('span');
    cue.className = 'wtr-cw-cue';
    cue.textContent = 'Start';
    head.appendChild(cue);

    head.setAttribute('role', 'button');
    head.setAttribute('tabindex', '0');
    head.addEventListener('click', openWizard);
    head.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openWizard(); }
    });

    // answers[i] holds the chosen value for steps[i]; default is "leave it alone"
    const answers = steps.map(s => s.options[0].value);
    let at = 0;               // 0..steps.length-1 = a question, steps.length = review
    let dir = 1;              // slide direction for the step animation
    let modal = null;

    function openWizard() {
      if (document.getElementById(CW_MODAL_ID)) return;
      at = 0; dir = 1;
      modal = document.createElement('div');
      modal.id = CW_MODAL_ID;
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-label', 'Series Collection Wizard');
      modal.innerHTML =
        '<div class="wtr-cw-card">' +
          '<div class="wtr-cw-top">' +
            '<div class="wtr-cw-titlerow">' +
              '<h2 class="wtr-cw-title">Series Collection Wizard</h2>' +
              '<span class="wtr-cw-count"></span>' +
              '<button class="wtr-cw-x" type="button" aria-label="Close">✕</button>' +
            '</div>' +
            '<div class="wtr-cw-rail"><div class="wtr-cw-bar"></div></div>' +
          '</div>' +
          '<div class="wtr-cw-body"></div>' +
          '<div class="wtr-cw-foot">' +
            '<button class="wtr-cw-btn is-back" type="button">Back</button>' +
            '<button class="wtr-cw-btn is-go" type="button">Collect</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(modal);

      modal.querySelector('.wtr-cw-x').addEventListener('click', close);
      modal.addEventListener('mousedown', e => { if (e.target === modal) close(); });
      modal.querySelector('.is-back').addEventListener('click', () => { if (at > 0) { dir = -1; at--; render(); } });
      modal.querySelector('.is-go').addEventListener('click', collect);
      document.addEventListener('keydown', onKey, true);

      render();
      requestAnimationFrame(() => modal.classList.add('is-open'));
    }

    function onKey(e) {
      if (!document.getElementById(CW_MODAL_ID)) return;
      if (e.key === 'Escape') { e.preventDefault(); close(); }
    }

    function close() {
      const m = document.getElementById(CW_MODAL_ID);
      if (!m) return;
      document.removeEventListener('keydown', onKey, true);
      m.classList.remove('is-open');
      const done = () => m.remove();
      m.addEventListener('transitionend', done, { once: true });
      setTimeout(done, 400);   // in case the transition never fires
    }

    function render() {
      const body = modal.querySelector('.wtr-cw-body');
      const bar = modal.querySelector('.wtr-cw-bar');
      const count = modal.querySelector('.wtr-cw-count');
      const back = modal.querySelector('.is-back');
      const go = modal.querySelector('.is-go');
      const onReview = at >= steps.length;

      bar.style.width = Math.round((at / steps.length) * 100) + '%';
      count.textContent = onReview ? 'Review' : ('Step ' + (at + 1) + ' of ' + steps.length);
      back.disabled = at === 0;
      go.style.display = onReview ? '' : 'none';

      body.style.setProperty('--wtr-cw-dx', (dir >= 0 ? '14px' : '-14px'));
      body.innerHTML = '';
      const wrap = document.createElement('div');
      wrap.className = 'wtr-cw-anim';

      if (onReview) {
        wrap.innerHTML = '<h3 class="wtr-cw-q">Ready to collect</h3>' +
          '<p class="wtr-cw-hint">Nothing downloads until you press Collect. Click any line to change it.</p>';
        const list = document.createElement('div');
        list.className = 'wtr-cw-review';
        steps.forEach((s, i) => {
          const val = s.answerLabel(answers[i]);
          const isAny = answers[i] === s.options[0].value;
          const row = document.createElement('div');
          row.className = 'wtr-cw-rrow';
          row.innerHTML =
            '<span class="wtr-cw-rk">' + escapeHtml(s.label) + '</span>' +
            '<span class="wtr-cw-rv' + (isAny ? ' is-any' : '') + '">' + escapeHtml(val) + '</span>' +
            '<span class="wtr-cw-redit">change</span>';
          row.addEventListener('click', () => { dir = -1; at = i; render(); });
          list.appendChild(row);
        });
        wrap.appendChild(list);
      } else {
        const s = steps[at];
        wrap.innerHTML =
          '<h3 class="wtr-cw-q">' + escapeHtml(s.question) + '</h3>' +
          (s.hint ? '<p class="wtr-cw-hint">' + escapeHtml(s.hint) + '</p>' : '');
        const grid = document.createElement('div');
        grid.className = 'wtr-cw-opts';
        s.options.forEach((o, i) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'wtr-cw-opt' + (answers[at] === o.value ? ' is-picked' : '');
          b.style.animationDelay = Math.min(i * 22, 200) + 'ms';
          b.innerHTML = escapeHtml(o.label) + (o.note ? '<span class="n">' + escapeHtml(o.note) + '</span>' : '');
          b.addEventListener('click', () => {
            answers[at] = o.value;
            grid.querySelectorAll('.wtr-cw-opt').forEach(x => x.classList.remove('is-picked'));
            b.classList.add('is-picked');
            setTimeout(() => { dir = 1; at++; render(); }, 160);   // let the pick register visually
          });
          grid.appendChild(b);
        });
        wrap.appendChild(grid);
      }

      body.appendChild(wrap);
      const first = body.querySelector('.wtr-cw-opt, .wtr-cw-rrow');
      if (first && first.focus) first.focus({ preventScroll: true });
    }

    function collect() {
      // Write every answer into the site's own control, then let the site's own
      // button submit the form. No download URL is built here.
      steps.forEach((s, i) => { try { s.apply(answers[i]); } catch (e) {} });
      close();
      const submit = form.querySelector('button[type="submit"], input[type="submit"], button');
      if (submit) submit.click(); else form.submit();
    }

    return true;
  }

  /* =========================================================================
   * Boot
   * =======================================================================*/
  function tryInject(fn) {
    try { if (fn()) return true; } catch (e) { console.warn('[BTN-Sonarr] inject failed', e); return true; }
    let tries = 0;
    const iv = setInterval(() => {
      try { if (fn() || ++tries > 25) clearInterval(iv); }
      catch (e) { clearInterval(iv); console.warn('[BTN-Sonarr] retry failed', e); }
    }, 400);
    return false;
  }

  function boot() {
    injectStyle();
    // Runs on every BTN page.
    try { applyLightTheme(); } catch (e) { console.error('[STMPE] light theme error', e); }
    if (isEnabled('browsetags')) {
      try { runBrowseTagLabels(); } catch (e) { console.error('[STMPE] browse tag labels error', e); }
    }
    if (isEnabled('placeholder')) {
      try { runPlaceholders(); } catch (e) { console.error('[STMPE] placeholder error', e); }
    }
    if (IS_EDIT) {
      tryInject(injectSettingsPanels);
    }
    if (IS_SERIES) {
      window.__btnSeries = seriesInfo();
      if (isEnabled('serieshero')) {
        tryInject(() => {
          if (!document.querySelector('#content .thin > center')) return false;
          runSeriesHero();
          return true;
        });
      }
      if (isEnabled('sonarr')) {
        tryInject(() => ((document.querySelector('div.sidebar') || document.querySelector('.linkbox')) ? injectLinkbar() : false));
      }
      if (isEnabled('fanart')) {
        runFanart();
      }
      if (isEnabled('seasonsynopsis')) {
        tryInject(() => {
          const sidebar = document.querySelector('#content > div.thin > div.sidebar') || document.querySelector('.sidebar');
          if (!sidebar || (!lssFindPosterCard(sidebar) && !document.getElementById('snr-fanart-logo'))) return false;
          runLatestSeasonSynopsis();
          return true;
        });
      }
      if (isEnabled('parents')) {
        try { runParentsGuide(); } catch (e) { console.error('[STMPE] parents guide error', e); }
      }
      if (isEnabled('seasons')) {
        tryInject(() => {
          const t = document.querySelector('.main_column .torrent_table tr.group_torrent');
          return t ? runSeasonCollapse() : false;
        });
      }
      if (isEnabled('hidereq')) {
        tryInject(() => {
          const t = document.querySelector('.main_column table.border tr.colhead_dark, .main_column table.border tr.colhead');
          return t ? (runRequestsPanel() || true) : false;
        });
      }
      if (isEnabled('seriesactionbar')) {
        tryInject(() => {
          const linkbox = document.querySelector('#content .thin>.linkbox');
          const sidebar = document.querySelector('#content .thin>.sidebar');
          return (linkbox && sidebar) ? (runSeriesActionBar() || true) : false;
        });
      }
      if (isEnabled('trailer')) {
        tryInject(() => {
          const pb = document.querySelector('#playbutton');
          if (!pb) return false;
          runTrailer(pb);
          return true;
        });
      }
      if (isEnabled('actors')) {
        tryInject(() => {
          if (!document.querySelector('.main_column')) return false;
          runActors();
          return true;
        });
      }
      if (isEnabled('seasonbrowser')) {
        tryInject(() => {
          if (!document.querySelector('.main_column')) return false;
          runSeasonBrowser();
          return true;
        });
      }
      if (isEnabled('similar')) {
        tryInject(() => {
          if (!document.querySelector('.main_column')) return false;
          runSimilar();
          return true;
        });
      }
      if (isEnabled('enhsummary')) {
        tryInject(() => {
          if (!document.querySelector('#summary')) return false;
          runEnhancedSummary();
          return true;
        });
      }
      if (isEnabled('collectwizard')) {
        tryInject(runCollectWizard);
      }
      if (isEnabled('stamps')) {
        tryInject(() => {
          if (!document.querySelector('.main_column')) return false;
          return runStamps();
        });
      }
      if (isEnabled('artwork')) {
        tryInject(() => {
          if (!document.querySelector('.main_column .box')) return false;
          runArtwork();
          return true;
        });
      }
    }
    if (IS_COLLAGE && isEnabled('collageactionbar')) {
      tryInject(() => {
        const linkbox = document.querySelector('body#collages #content>.thin>.linkbox');
        const sidebar = document.querySelector('body#collages #content>.thin>.sidebar');
        return (linkbox && sidebar) ? (runCollageActionBar() || true) : false;
      });
    }
    if (IS_ACTOR && isEnabled('actorsearch')) {
      tryInject(() => {
        const query = btnasQuery();
        if (!query && !document.querySelector('#torrent_table, .main_column, #content')) return false;
        return runActorSearchTmdb();
      });
    }
    if (IS_ACTOR_SHOWCASE && isEnabled('actorshowcase')) {
      tryInject(() => {
        if (!document.querySelector('body#actorshowcase #content .thin a[href*="actor.php?id="][title]')) return false;
        return runActorShowcaseTmdb();
      });
    }
    if (IS_RECOMMEND && isEnabled('recommendmodal')) {
      tryInject(() => runRecommendModal());
    }
    if (IS_TORRENT_DETAIL && isEnabled('serieshero')) {
      window.__btnSeries = window.__btnSeries || seriesInfo();
      tryInject(() => {
        if (!document.querySelector('#content .thin > h2 a[href*="series.php"] img')) return false;
        return runSeriesHero();
      });
    }
    if (IS_TORRENT_DETAIL && isEnabled('torrenttouchups')) {
      tryInject(() => {
        if (!document.querySelector('tr[id^="torrent_"]')) return false;
        return runTorrentTouchups();
      });
    }
    if (IS_HOME) {
      if (isEnabled('homestats')) {
        tryInject(() => runHomeStatsStrip());
      }
      if (isEnabled('homeuploads')) {
        tryInject(() => {
          if (!document.querySelector('#last_uploads')) return false;
          runHomeLatestUploads();
          return true;
        });
      }
      if (isEnabled('trending')) {
        tryInject(() => {
          const mc = document.querySelector('#content > div.thin > div.main_column') || document.querySelector('.main_column');
          if (!mc) return false;
          runTrending();
          return true;
        });
      }
      if (isEnabled('news')) {
        tryInject(() => {
          if (!document.querySelector('#news_post')) return false;
          return runNewsCollapse();
        });
      }
      if (isEnabled('homefeatures')) {
        tryInject(() => {
          if (!document.querySelector('.of_the_month')) return false;
          runHomeFeaturedCards();
          return true;
        });
      }
      if (isEnabled('homenewseriescarousel')) {
        tryInject(() => runHomeNewSeriesCarousel());
      }
      if (isEnabled('homecalendar')) {
        tryInject(() => {
          if (!document.querySelector('#content > div.thin > div.sidebar') && !document.querySelector('.sidebar')) return false;
          runHomeSonarrCalendar();
          return true;
        });
      }
    }
  }

  (async () => {
    try { await initStorage(); } catch (e) { console.error('[BTN-Sonarr] storage init error', e); }
    try { boot(); } catch (e) { console.error('[BTN-Sonarr] boot error', e); }
  })();
})();
