/**
 * GLOBAL Feed — infinite scroll, photos, videos, category tags
 */
(function () {
  const PAGE_SIZE = 8;
  const state = {
    target: "feed",
    category: "all",
    offset: 0,
    hasMore: true,
    loading: false,
    posts: [],
    observer: null
  };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>'"]/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c])
    );
  }

  function timeAgo(iso) {
    if (!iso) return "";
    const t = new Date(iso).getTime();
    if (isNaN(t)) return "";
    const s = Math.floor((Date.now() - t) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + "m";
    if (s < 86400) return Math.floor(s / 3600) + "h";
    if (s < 604800) return Math.floor(s / 86400) + "d";
    return new Date(iso).toLocaleDateString();
  }

  function prettyCat(cat) {
    const c = String(cat || "general");
    return c.replace(/[_-]/g, " ").replace(/\b\w/g, x => x.toUpperCase());
  }

  function avatarHtml(p) {
    const name = p.authorName || p.username || "G";
    const letter = esc((name[0] || "G").toUpperCase());
    if (p.authorAvatar) {
      return `<img class="avatar post-avatar" src="${esc(p.authorAvatar)}" alt="" loading="lazy" onerror="this.outerHTML='<div class=\\'avatar post-avatar-fallback\\'>${letter}</div>'">`;
    }
    return `<div class="avatar post-avatar-fallback">${letter}</div>`;
  }

  function mediaHtml(p) {
    let html = "";
    if (p.imageUrl) {
      const src = esc(p.imageUrl);
      html += `<div class="post-media-wrap post-photo">
        <img class="post-media" src="${src}" alt="Post photo" loading="lazy" decoding="async"
          onerror="this.closest('.post-media-wrap').classList.add('media-broken')">
      </div>`;
    }
    if (p.videoUrl) {
      const src = esc(p.videoUrl);
      html += `<div class="post-media-wrap post-video">
        <video class="post-media" controls playsinline preload="metadata" src="${src}"
          onerror="this.closest('.post-media-wrap').classList.add('media-broken')"></video>
      </div>`;
    }
    return html;
  }

  function renderPost(p) {
    const likes = Array.isArray(p.likes) ? p.likes.length : 0;
    const comments = Array.isArray(p.comments) ? p.comments.length : 0;
    const cat = prettyCat(p.category);
    const handle = p.username || "builder";
    return `<article class="post panel" data-post-id="${esc(p.id)}" data-category="${esc(p.category || "general")}">
      <div class="post-head">
        ${avatarHtml(p)}
        <div class="post-meta">
          <strong>${esc(p.authorName || handle)}</strong>
          <span>@${esc(handle)} · ${timeAgo(p.createdAt)}</span>
        </div>
        <span class="badge post-category post-tag">${esc(cat)}</span>
      </div>
      ${p.text ? `<div class="post-body">${esc(p.text)}</div>` : ""}
      ${mediaHtml(p)}
      <div class="post-actions">
        <button type="button" onclick="likePost('${esc(p.id)}')">♥ ${likes}</button>
        <button type="button" onclick="focusComment('${esc(p.id)}')">💬 ${comments}</button>
        <button type="button" onclick="sharePost('${esc(p.id)}')">↻ Share</button>
      </div>
    </article>`;
  }

  function sentinelHtml() {
    return `<div id="feed-sentinel" class="feed-sentinel" aria-hidden="true">
      <div class="feed-loading" id="feedLoading" style="display:none">Loading more…</div>
      <div class="feed-end muted" id="feedEnd" style="display:none">You're all caught up</div>
    </div>`;
  }

  async function fetchPage() {
    if (state.loading || !state.hasMore) return;
    state.loading = true;
    const loadingEl = document.getElementById("feedLoading");
    if (loadingEl) loadingEl.style.display = "block";

    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(state.offset),
        category: state.category || "all"
      });
      const r = await fetch("/api/posts?" + params.toString());
      if (!r.ok) throw new Error("HTTP " + r.status);
      const d = await r.json();
      const batch = d.posts || [];
      state.hasMore = !!d.hasMore;
      state.offset = d.nextOffset != null ? d.nextOffset : state.offset + batch.length;

      const el = document.getElementById(state.target);
      if (!el) return;

      const oldSentinel = document.getElementById("feed-sentinel");
      if (oldSentinel) oldSentinel.remove();

      if (state.posts.length === 0 && batch.length === 0) {
        el.innerHTML =
          '<div class="empty panel">No posts in this space yet. Open <a href="dashboard.html">Feed</a> to share a photo, video or update.</div>' +
          sentinelHtml();
      } else if (state.posts.length === 0) {
        el.innerHTML = batch.map(renderPost).join("") + sentinelHtml();
      } else {
        el.insertAdjacentHTML("beforeend", batch.map(renderPost).join("") + sentinelHtml());
      }
      state.posts = state.posts.concat(batch);

      const endEl = document.getElementById("feedEnd");
      if (endEl) endEl.style.display = state.hasMore ? "none" : "block";
      attachObserver();
    } catch (e) {
      const el = document.getElementById(state.target);
      if (el && state.posts.length === 0) {
        el.innerHTML =
          '<div class="empty panel">Could not load feed. Make sure the server is running (<code>npm start</code>).</div>';
      }
    } finally {
      state.loading = false;
      const loadingEl2 = document.getElementById("feedLoading");
      if (loadingEl2) loadingEl2.style.display = "none";
    }
  }

  function attachObserver() {
    if (state.observer) {
      state.observer.disconnect();
      state.observer = null;
    }
    const sentinel = document.getElementById("feed-sentinel");
    if (!sentinel || !state.hasMore) return;
    state.observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting && state.hasMore && !state.loading) fetchPage();
      },
      { root: null, rootMargin: "500px", threshold: 0 }
    );
    state.observer.observe(sentinel);
  }

  async function loadFeed(target, category) {
    state.target = target || "feed";
    state.category = category || "all";
    state.offset = 0;
    state.hasMore = true;
    state.posts = [];
    if (state.observer) {
      state.observer.disconnect();
      state.observer = null;
    }
    const el = document.getElementById(state.target);
    if (el) {
      el.innerHTML =
        '<div class="empty panel muted" style="text-align:center;padding:24px">Loading feed…</div>';
    }
    await fetchPage();
  }

  async function likePost(id) {
    const a = JSON.parse(localStorage.getItem("global_current_account") || "null");
    if (!a) return (location.href = "login.html");
    try {
      await fetch("/api/posts/" + id + "/like", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: a.userId || a.id })
      });
      await loadFeed(state.target, state.category);
    } catch (e) {}
  }

  function focusComment(id) {
    const text = prompt("Comment on this post:");
    if (!text) return;
    const a = JSON.parse(localStorage.getItem("global_current_account") || "null");
    if (!a) return (location.href = "login.html");
    fetch("/api/posts/" + id + "/comment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: a.userId || a.id,
        authorId: a.userId || a.id,
        authorName: a.fullName || a.username || "GLOBAL Builder",
        text
      })
    }).then(() => loadFeed(state.target, state.category));
  }

  function sharePost(id) {
    const url = location.origin + "/dashboard.html#post-" + id;
    if (navigator.share) {
      navigator.share({ title: "GLOBAL Post", url }).catch(() => {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(url);
      alert("Link copied");
    }
  }

  window.loadFeed = loadFeed;
  window.likePost = likePost;
  window.focusComment = focusComment;
  window.sharePost = sharePost;
  window.esc = esc;
})();
