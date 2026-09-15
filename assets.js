function wireSearch(){
  const input=document.querySelector(".search input");
  if(!input)return;
  input.addEventListener("keydown",async e=>{
    if(e.key!=="Enter")return;
    const q=input.value.trim();
    if(q.length<2)return;
    try{
      const r=await fetch("/api/search?q="+encodeURIComponent(q));
      const d=await r.json();
      const results=d.results||[];
      const main=document.getElementById("app");
      if(!main)return;
      main.innerHTML=`<div class="section-title"><div><span class="eyebrow">SEARCH</span><h1>Results for "${q.replace(/</g,"")}"</h1></div><button class="btn" onclick="location.reload()">Back</button></div><div class="card panel" style="margin-top:14px">${results.length?results.map(x=>`<div style="padding:12px 0;border-bottom:1px solid #1a2230"><span class="badge">${x.type||""}</span> <strong>${(x.title||"").replace(/</g,"")}</strong><p class="muted" style="margin:4px 0 0;font-size:13px">${(x.description||"").replace(/</g,"").slice(0,160)}</p></div>`).join(""):"<p class=\"muted\" style=\"padding:16px\">No results.</p>"}</div>`;
      if(window.GLOBAL&&GLOBAL.footer)GLOBAL.footer();
    }catch(err){alert("Search failed. Is the server running?");}
  });
}

(function(){
const page=location.pathname.split('/').pop()||'index.html';
const nav=[['⌂','Home','index.html'],['◈','Explore','people.html'],['▣','Feed','dashboard.html'],['✦','Ideas','ideas.html'],['⚠','Problems','problems.html'],['▲','Projects','projects.html'],['◇','Research','research.html'],['▤','Opportunities','opportunities.html'],['◐','Teams','teams.html'],['♦','Mentorship','mentorship.html'],['▦','Organisations','organisation.html'],['✦','Innovation','innovation.html'],['◎','GLOBAL AI','global-ai.html']];
function account(){try{return JSON.parse(localStorage.getItem('global_current_account')||'null')}catch{return null}}
function shell(){const a=account();document.body.insertAdjacentHTML('afterbegin',`<header class="topbar"><div class="topbar-inner"><a class="brand" href="index.html"><i class="brand-mark"></i><span>GLOBAL</span></a><div class="search"><input placeholder="Search people, projects, ideas, problems…"></div><div class="top-actions"><button class="icon-btn" onclick="location.href='notifications.html'">◌</button><button class="icon-btn" onclick="location.href='messages.html'">✉</button></div></div></header><div class="layout"><aside class="sidebar"><div class="nav-group">${nav.map(n=>`<a class="nav-link ${page===n[2]?'active':''}" href="${n[2]}"><b>${n[0]}</b><span>${n[1]}</span></a>`).join('')}<div class="nav-title">Account</div><a class="nav-link ${page==='profile.html'?'active':''}" href="profile.html"><b>●</b><span>Profile</span></a><a class="nav-link" href="settings.html"><b>⚙</b><span>Settings</span></a>${a?'<button class="nav-link" style="width:100%;border:0;background:transparent;color:#ff8490" id="logout"><b>↪</b><span>Log out</span></button>':'<a class="nav-link" href="login.html"><b>↪</b><span>Login</span></a>'}</div></aside><main class="main" id="app"></main><aside class="rail"><div class="right-card panel"><h3>GLOBAL Pulse</h3><p class="muted">Ideas, problems, projects and opportunities moving across the network.</p><div class="tag-row"><span class="tag">Nigeria</span><span class="tag">Africa</span><span class="tag">AI</span><span class="tag">Engineering</span></div></div><div class="right-card panel"><h3>Build with GLOBAL</h3><p class="muted">Turn a problem into a team, project, prototype and impact.</p><a class="btn primary" href="innovation.html">Open Innovation Hub</a></div></aside></div><nav class="mobile-nav">${[['⌂','Home','index.html'],['◈','Explore','people.html'],['＋','Create','dashboard.html'],['▲','Projects','projects.html'],['●','Profile','profile.html']].map(n=>`<a class="${page===n[2]?'active':''}" href="${n[2]}"><b>${n[0]}</b>${n[1]}</a>`).join('')}</nav>`);if(document.getElementById('logout'))document.getElementById('logout').onclick=()=>{localStorage.removeItem('global_current_account');localStorage.removeItem('global_logged_in');location.href='login.html'};wireSearch();}
function footer(){document.getElementById('app').insertAdjacentHTML('beforeend','<div class="footer">GLOBAL Organisation · People · Ideas · Problems · Research · Opportunities · Innovation</div>')}
window.GLOBAL={shell,footer,account};
})();
