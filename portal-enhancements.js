/* Portal additions use native controls and the existing same-origin Pages API. */
(function () {
  'use strict';
  var data = Array.isArray(window.DASHBOARDS) ? window.DASHBOARDS : [];
  var $ = function (s) { return document.querySelector(s); };
  var grid = $('#grid'), categoryFilter = $('#category-filter'), category = 'all', sort = $('#sort-select');
  var pins = []; try { pins = JSON.parse(localStorage.getItem('portal:pins') || '[]'); } catch (_) {}
  var custom = []; try { custom = JSON.parse(localStorage.getItem('portal:links') || '[]'); } catch (_) {}
  if(localStorage.getItem('portal:fresh-hours'))$('#freshness').value=localStorage.getItem('portal:fresh-hours'); if(localStorage.getItem('portal:alert-hours'))$('#alert-threshold').value=localStorage.getItem('portal:alert-hours');
  var offline = false, wip = false, undoTimer;
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function rows() { return Array.from(grid.querySelectorAll('.row')); }
  function draw() {
    var wanted = category;
    rows().forEach(function (row) {
      var item = data.find(function (x) { return x.id === row.dataset.id; });
      row.hidden = (!!wanted && wanted !== 'all' && item.category !== wanted) || (offline && !!item.url) || (wip && item.status !== 'wip');
    });
    var visible = rows().filter(function (r) { return !r.hidden; });
    visible.sort(function (a,b) {
      var x = data.find(function (v) { return v.id === a.dataset.id; }), y = data.find(function (v) { return v.id === b.dataset.id; });
      return sort.value === 'az' ? x.name.localeCompare(y.name) : sort.value === 'category' ? (x.category||'').localeCompare(y.category||'') : data.indexOf(x)-data.indexOf(y);
    }).forEach(function (row) { grid.appendChild(row); });
    $('#meta').textContent='Showing '+visible.length+' of '+data.length+' dashboards';
  }
  categoryFilter.addEventListener('click',function(e){var b=e.target.closest('[data-category]');if(!b)return;category=b.dataset.category;categoryFilter.querySelectorAll('[role=radio]').forEach(function(x){x.setAttribute('aria-checked',String(x===b));});draw();}); sort.addEventListener('change', draw);
  document.querySelectorAll('[data-status-tab]').forEach(function(tab){tab.addEventListener('click',function(){document.querySelectorAll('[data-status-tab]').forEach(function(t){t.setAttribute('aria-selected',String(t===tab));});$('#tab-note').textContent=tab.dataset.statusTab==='live'?'Showing live dashboards':'No '+tab.textContent.toLowerCase()+' dashboards are currently published.';});});
  $('#show-offline').addEventListener('change', function (e) { offline=e.target.checked; draw(); });
  $('#show-wip').addEventListener('change', function (e) { wip=e.target.checked; draw(); });
  document.querySelectorAll('.segment button').forEach(function (b) { b.addEventListener('click',function(){ document.querySelectorAll('.segment button').forEach(function(x){x.setAttribute('aria-checked',String(x===b));}); grid.classList.toggle('is-grid',b.dataset.view==='grid'); }); });
  document.querySelectorAll('[role=radiogroup]').forEach(function(group){group.addEventListener('keydown',function(e){if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;var options=Array.from(group.querySelectorAll('[role=radio]'));if(!options.length)return;e.preventDefault();var i=options.indexOf(document.activeElement),next=(i+(e.key==='ArrowLeft'||e.key==='ArrowUp'?-1:1)+options.length)%options.length;options[next].focus();options[next].click();});});
  document.querySelectorAll('[role=tablist]').forEach(function(group){group.addEventListener('keydown',function(e){if(!['ArrowLeft','ArrowRight'].includes(e.key))return;var options=Array.from(group.querySelectorAll('[role=tab]')),i=options.indexOf(document.activeElement),next=(i+(e.key==='ArrowLeft'?-1:1)+options.length)%options.length;e.preventDefault();options[next].focus();options[next].click();});});
  document.addEventListener('keydown',function(e){if(e.key==='Escape')document.querySelectorAll('.row-menu[aria-expanded=true]').forEach(function(b){b.setAttribute('aria-expanded','false');});});
  function renderPins() {
    $('#favourites').innerHTML = data.filter(function (x) { return pins.indexOf(x.id)>=0; }).slice(0,4).map(function(x){ return '<button type="button" role="radio" aria-checked="'+String(x.id===favoriteId)+'" data-fav="'+esc(x.id)+'">'+esc(x.name)+'</button>'; }).join('') || '<button type="button" data-add-first>Pin first dashboard</button>';
    renderGlance();
  }
  var glanceIndex=0, favoriteId=pins[0]||null; function renderGlance(){var x=data[glanceIndex%data.length];if(!x)return;var f=x.count&&x.count.fallback&&x.count.fallback.titles;var figure=typeof f==='number'?(x.url?'<a data-component="animated-counter" class="counter-value" href="'+esc(x.url)+'" target="_blank" rel="noopener" aria-label="'+f+' recorded titles — open '+esc(x.name)+'">'+f+'</a>':'<span data-component="animated-counter" class="counter-value" aria-label="Recorded titles">'+f+'</span>'):'';$('#glance-list').innerHTML='<p><strong>'+esc(x.name)+'</strong></p><p>'+figure+(typeof f==='number'?' titles (recorded)':'No live metric available')+'</p><p class="sample-label">Change since yesterday unavailable — no daily history is connected.</p>';}
  $('#glance-prev').addEventListener('click',function(){glanceIndex=(glanceIndex+data.length-1)%data.length;renderGlance();});$('#glance-next').addEventListener('click',function(){glanceIndex=(glanceIndex+1)%data.length;renderGlance();});
  grid.addEventListener('click', function (e) {
    var row=e.target.closest('.row'); if(!row) return;
    if (e.target.closest('.row-title a,.preview-btn')) return;
    var id=row.dataset.id, item=data.find(function(x){return x.id===id;}); if(!item) return;
    var action=e.target.closest('[data-row-action]'); if(action) { if(action.dataset.rowAction==='pin') togglePin(id); if(action.dataset.rowAction==='copy') navigator.clipboard&&navigator.clipboard.writeText(location.origin+'/#preview-'+encodeURIComponent(id)); return; }
    var menu=e.target.closest('.row-menu'); if(menu) { menu.setAttribute('aria-expanded',menu.getAttribute('aria-expanded')!=='true'); return; }
  });
  function togglePin(id) { var removing=pins.indexOf(id)>=0;pins=removing?pins.filter(function(x){return x!==id;}):[id].concat(pins).slice(0,4);if(removing&&favoriteId===id)favoriteId=pins[0]||null;if(!removing&&!favoriteId)favoriteId=id;localStorage.setItem('portal:pins',JSON.stringify(pins)); renderPins(); }
  function enhanceRows(){grid.querySelectorAll('.row').forEach(function(row){ if(row.dataset.enhanced)return; row.dataset.enhanced='true';var item=data.find(function(x){return x.id===row.dataset.id;});if(!item)return;var tools=document.createElement('span');tools.className='row-menu-wrap';tools.innerHTML='<button type="button" class="row-menu" aria-label="Actions for '+esc(item.name)+'" aria-expanded="false" data-component="inline-disclosure-menu">•••</button><span class="row-menu-items"><a href="'+esc(item.url||'#')+'" target="_blank" rel="noopener">Open in new tab</a><button type="button" data-row-action="pin">Pin / unpin</button><button type="button" data-row-action="copy">Copy link</button></span>';row.querySelector('.row-actions').appendChild(tools);row.setAttribute('data-component','expandable-profile-card');var swipe=document.createElement('button');swipe.type='button';swipe.textContent='Pin';swipe.setAttribute('aria-label','Pin or unpin '+item.name);swipe.dataset.component='swipe-row';swipe.addEventListener('click',function(){togglePin(item.id);});row.querySelector('.row-actions').appendChild(swipe);});}
  enhanceRows();new MutationObserver(enhanceRows).observe(grid,{childList:true});  grid.addEventListener('pointerdown',function(e){var row=e.target.closest('.row');if(row)row.dataset.swipeStart=String(e.clientX);});
  grid.addEventListener('pointerup',function(e){var row=e.target.closest('.row');if(row&&row.dataset.swipeStart&&Math.abs(e.clientX-Number(row.dataset.swipeStart))>70){togglePin(row.dataset.id);row.dataset.swipeStart='';}});
  $('#clear-pins').addEventListener('click',function(){ if(!pins.length)return; var previous=pins.slice(); pins=[]; localStorage.setItem('portal:pins','[]'); renderPins(); $('#undo-status').textContent='Pins cleared. Undo within 5 seconds.'; clearTimeout(undoTimer); undoTimer=setTimeout(function(){$('#undo-status').textContent='';},5000); var b=document.createElement('button'); b.textContent='Undo'; b.addEventListener('click',function(){pins=previous;localStorage.setItem('portal:pins',JSON.stringify(pins));renderPins();$('#undo-status').textContent='Pins restored.';}); $('#undo-status').appendChild(b); });
  $('#favourites').addEventListener('click',function(e){var b=e.target.closest('[data-fav]');if(b){favoriteId=b.dataset.fav;$('#favourites').querySelectorAll('[data-fav]').forEach(function(x){x.setAttribute('aria-checked',String(x===b));});glanceIndex=Math.max(0,data.findIndex(function(x){return x.id===favoriteId;}));renderGlance();}if(e.target.closest('[data-add-first]'))togglePin(data[0].id);});
  document.querySelectorAll('[data-step]').forEach(function(b){b.addEventListener('click',function(){var i=$('#freshness');i.value=Math.max(+i.min,Math.min(+i.max,+i.value+(+b.dataset.step)));i.dispatchEvent(new Event('change',{bubbles:true}));});});
  $('#freshness').addEventListener('change',function(){localStorage.setItem('portal:fresh-hours',this.value);});
  $('#alert-threshold').addEventListener('change',function(){var value=Math.max(1,Math.min(720,Number(this.value)||72));this.value=String(value);localStorage.setItem('portal:alert-hours',this.value);$('#portal-action-status').textContent='Alert threshold saved: '+this.value+' hours.';});
  $('#custom-link-form').addEventListener('submit',function(e){e.preventDefault();var name=$('#custom-name').value.trim(),url=$('#custom-url').value.trim(),cat=$('#custom-category').value.trim();if(!/^https?:\/\//i.test(url))return;custom.push({name:name,url:url,category:cat});localStorage.setItem('portal:links',JSON.stringify(custom));paintCustom();e.target.reset();});
  function paintCustom(){ $('#custom-links').innerHTML=custom.map(function(x,i){return '<li><a href="'+esc(x.url)+'" rel="noopener">'+esc(x.name)+'</a> · '+esc(x.category)+' <button type="button" data-delete-link="'+i+'">Remove</button></li>';}).join(''); }
  $('#custom-links').addEventListener('click',function(e){var b=e.target.closest('[data-delete-link]');if(b){custom.splice(+b.dataset.deleteLink,1);localStorage.setItem('portal:links',JSON.stringify(custom));paintCustom();}});
  $('#feedback-form').addEventListener('submit',async function(e){e.preventDefault();var status=$('#feedback-status'),form=e.currentTarget;status.textContent='Sending…';try{var response=await fetch('/api/feedback',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message:$('#feedback-message').value,website:form.elements.website.value,source:'portal'})});if(!response.ok)throw new Error();status.textContent='Thanks. Your report was received.';form.reset();}catch(_){status.textContent='Could not send the report. Please try again later.';}});
  var today=new Intl.DateTimeFormat('en-GB',{weekday:'long',day:'numeric',month:'short',year:'numeric'}); $('#sticky-date').textContent='Date · '+today.format(new Date())+' · deploy time unavailable';
  function openUpdates(){var heading=$('#updates-title');if(!heading)return;heading.focus({preventScroll:true});heading.scrollIntoView({block:'center'});}
  $('#sticky-date').addEventListener('click',openUpdates);
  // The button prints the date, so the date is part of its name - WCAG 2.5.3.
  $('#sticky-date').setAttribute('aria-label',$('#sticky-date').textContent+' - open recent updates');
  $('#activity-open').addEventListener('click',openUpdates);
  $('#recent-updates').innerHTML=data.slice(0,5).map(function(x){return '<li><a href="'+esc(x.url)+'" target="_blank" rel="noopener">'+esc(x.name)+'</a> · sample update</li>';}).join('');
  var heatClass=['heat-0','heat-1','heat-2','heat-3','heat-4']; $('#activity-heatmap').innerHTML=Array.from({length:90},function(_,i){return '<i class="'+heatClass[(i*7)%5]+'" title="Sample activity day '+(i+1)+'"></i>';}).join('');
  $('#visits-chart').innerHTML='<svg viewBox="0 0 300 70" role="presentation"><polyline points="0,55 30,40 60,49 90,27 120,42 150,20 180,34 210,14 240,27 270,9 300,20"/></svg>';
  var theme=$('#theme-toggle'); if(theme)theme.setAttribute('data-component','switch-mode');
  document.querySelectorAll('[data-portal-action]').forEach(function(button){button.addEventListener('click',async function(){var item=data.find(function(x){return pins.indexOf(x.id)>=0;})||data[0],url=item&&item.url,status=$('#portal-action-status');if(button.dataset.portalAction==='refresh'){location.reload();return;}if(button.dataset.portalAction==='open'){if(url)window.open(url,'_blank','noopener');return;}try{if(button.dataset.portalAction==='share'&&navigator.share){await navigator.share({title:item.name,url:url});status.textContent='Share sheet opened.';}else{await navigator.clipboard.writeText(url);status.textContent='Link copied.';}}catch(_){status.textContent='Could not share or copy this link.';}});});
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').then(function(reg){ if(reg.waiting){var note=document.createElement('button');note.textContent='Update available → Reload';note.className='update-prompt';note.dataset.component='dynamic-button';note.onclick=function(){reg.waiting.postMessage({type:'SKIP_WAITING'});location.reload();};document.body.appendChild(note);}reg.addEventListener('updatefound',function(){var worker=reg.installing;if(worker)worker.addEventListener('statechange',function(){if(worker.state==='installed'&&navigator.serviceWorker.controller){var note=document.createElement('button');note.textContent='Update available → Reload';note.className='update-prompt';note.onclick=function(){worker.postMessage({type:'SKIP_WAITING'});location.reload();};document.body.appendChild(note);}});});}).catch(function(){});
  // The launchpad reads the same manifest the rows above read, so a dashboard
  // that is removed from data/dashboards.js leaves the pad on the next load.
  if (window.mountHairline) {
    window.mountHairline('portal-launchpad', data.filter(function (x) { return !!x.url; }).slice(0, 6).map(function (x) {
      return { title: x.name, href: x.url, host: String(x.url).replace(/^https?:\/\//, '').replace(/\/$/, '') };
    }));
  }
  renderPins(); paintCustom(); draw();
})();
