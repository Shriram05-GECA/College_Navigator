// ================================================================
//  CAMPUS NAVIGATOR — script.js
//  Click-to-place editor with undo, live edge preview & ghost cursor
// ================================================================

// ─── State ──────────────────────────────────────────────────────
let map, pathLine = null;
let allNodes     = [];
let allEdges     = [];
let nodeMarkers  = {};      // id → { marker, node }
let edgePolylines = [];     // { line, from, to }
let sidebarOpen   = true;
let selectedNode  = null;

// ─── Editor state ────────────────────────────────────────────────
let editorActive      = false;
let editorMode        = 'waypoint';   // waypoint | named | edge | del_node | del_edge
let waypointCounter   = 1;
let showWaypoints     = true;

// Edge drawing
let edgeFromNode      = null;         // node id of first click
let edgePreviewLine   = null;         // rubber-band line
let delEdgeFromNode   = null;         // for del_edge mode

// Ghost cursor (shows where waypoint will land)
let ghostMarker       = null;

// Undo stack — each entry is a snapshot of { nodes, edges }
let undoStack         = [];
const MAX_UNDO        = 30;

// ─── Colors ──────────────────────────────────────────────────────
const TYPE_COLORS = {
    academic:     { bg: '#4ade80', glow: 'rgba(74,222,128,0.5)'  },
    admin:        { bg: '#60a5fa', glow: 'rgba(96,165,250,0.5)'  },
    food:         { bg: '#f97316', glow: 'rgba(249,115,22,0.5)'  },
    sports:       { bg: '#a78bfa', glow: 'rgba(167,139,250,0.5)' },
    entrance:     { bg: '#f43f5e', glow: 'rgba(244,63,94,0.5)'   },
    event:        { bg: '#fbbf24', glow: 'rgba(251,191,36,0.5)'  },
    residential:  { bg: '#34d399', glow: 'rgba(52,211,153,0.5)'  },
    intersection: { bg: '#94a3b8', glow: 'rgba(148,163,184,0.3)' },
    waypoint:     { bg: '#f0abfc', glow: 'rgba(240,171,252,0.5)' }
};
const getColor = t => TYPE_COLORS[t] || TYPE_COLORS.intersection;

// ================================================================
//  INIT
// ================================================================
function initMap() {
    map = L.map('map', {
        crs: L.CRS.Simple, minZoom: -2, maxZoom: 4,
        zoomControl: true, attributionControl: false
    });
    const W = 1920, H = 1080;
    L.imageOverlay('/assets/campus_map.png', [[0,0],[H,W]]).addTo(map);
    map.fitBounds([[0,0],[H,W]]);

    // Map-level events
    map.on('click',       onMapClick);
    map.on('mousemove',   onMapMouseMove);
    map.on('contextmenu', e => { L.DomEvent.preventDefault(e); cancelEdgeMode(); });

    loadData();
    injectLoadingOverlay();

    // Keyboard shortcuts
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') cancelEdgeMode();
        if ((e.ctrlKey||e.metaKey) && e.key === 'z') { e.preventDefault(); undoAction(); }
    });
}

// ================================================================
//  DATA
// ================================================================
async function loadData() {
    try {
        const [nr, er] = await Promise.all([fetch('/api/nodes'), fetch('/api/edges')]);
        const nd = await nr.json(), ed = await er.json();
        allNodes = nd.nodes;
        allEdges = ed.edges;
        populateSelects();
        redrawAll();
        hideLoading();
    } catch(e) { console.error(e); showToast('Failed to load map data'); hideLoading(); }
}

// ================================================================
//  RENDER
// ================================================================
function redrawAll() {
    Object.values(nodeMarkers).forEach(({marker}) => map.removeLayer(marker));
    nodeMarkers = {};
    edgePolylines.forEach(({line}) => map.removeLayer(line));
    edgePolylines = [];
    allEdges.forEach(drawEdgeLine);
    allNodes.forEach(drawNode);
    updateEditorStats();
}

function drawEdgeLine(edge) {
    const a = byId(edge.from), b = byId(edge.to);
    if (!a || !b) return;
    const isWP = a.type==='waypoint' || b.type==='waypoint';
    const visible = !isWP || (showWaypoints && editorActive);
    const line = L.polyline([[a.y,a.x],[b.y,b.x]], {
        color:  isWP ? 'rgba(240,171,252,0.55)' : 'rgba(255,255,255,0.11)',
        weight: isWP ? 1.5 : 2,
        dashArray: isWP ? '3,5' : '4,6',
        opacity: visible ? 1 : 0,
        interactive: false
    }).addTo(map);
    edgePolylines.push({ line, from: edge.from, to: edge.to });
}

function drawNode(node) {
    const isWP   = node.type === 'waypoint';
    const color  = getColor(node.type);
    const size   = isWP ? 12 : 18;
    const vis    = !isWP || (showWaypoints && editorActive);

    const html = `<div class="nc" data-id="${node.id}" style="
        width:${size}px;height:${size}px;
        background:${color.bg};
        border-radius:50%;
        border:${isWP ? '1.5px solid rgba(255,255,255,0.35)' : '2.5px solid rgba(255,255,255,0.45)'};
        box-shadow:0 0 ${isWP?7:12}px ${color.glow}, 0 2px 6px rgba(0,0,0,0.55);
        cursor:pointer;
        transition:transform 0.12s ease, box-shadow 0.12s ease;
        opacity:${vis?1:0};
        pointer-events:${vis?'all':'none'};
    "></div>`;

    const icon = L.divIcon({
        html, className:'',
        iconSize:   [size, size],
        iconAnchor: [size/2, size/2]
    });
    const marker = L.marker([node.y, node.x], { icon, title: node.name, zIndexOffset: isWP ? 0 : 100 }).addTo(map);
    marker.on('click',    ev => { L.DomEvent.stopPropagation(ev); onNodeClick(node); });
    marker.on('mouseover',() => { setNodeScale(node.id, 1.5); });
    marker.on('mouseout', () => { setNodeScale(node.id, 1); });
    nodeMarkers[node.id] = { marker, node };
}

function setNodeScale(id, s) {
    nodeMarkers[id]?.marker.getElement()?.querySelector('.nc')
        ?.style.setProperty('transform', `scale(${s})`);
}

function setNodeStyle(id, extraShadow) {
    const el = nodeMarkers[id]?.marker.getElement()?.querySelector('.nc');
    if (!el) return;
    const color = getColor(nodeMarkers[id].node.type);
    el.style.boxShadow = extraShadow
        ? `0 0 0 4px rgba(59,130,246,0.9), 0 0 22px rgba(59,130,246,0.7)`
        : `0 0 ${nodeMarkers[id].node.type==='waypoint'?7:12}px ${color.glow}, 0 2px 6px rgba(0,0,0,0.55)`;
    el.style.transform = extraShadow ? 'scale(1.9)' : 'scale(1)';
}

// ================================================================
//  MAP EVENTS
// ================================================================
function onMapClick(e) {
    if (!editorActive) { closePreview(); return; }

    const x = parseFloat(e.latlng.lng.toFixed(2));
    const y = parseFloat(e.latlng.lat.toFixed(2));

    if (editorMode === 'waypoint') { placeWaypoint(x, y); return; }
    if (editorMode === 'named')    { openNameDialog(x, y); return; }
}

function onMapMouseMove(e) {
    // Ghost cursor for placement modes
    if (!editorActive) { removeGhost(); return; }
    if (editorMode !== 'waypoint' && editorMode !== 'named') { removeGhost(); return; }

    const latlng = e.latlng;

    if (!ghostMarker) {
        const isNamed = editorMode === 'named';
        const size = isNamed ? 18 : 12;
        const color = isNamed ? '#fbbf24' : '#f0abfc';
        const html = `<div style="
            width:${size}px;height:${size}px;background:${color};border-radius:50%;
            border:2px dashed rgba(255,255,255,0.6);
            opacity:0.65;pointer-events:none;
            box-shadow:0 0 12px ${color}88;
        "></div>`;
        ghostMarker = L.marker(latlng, {
            icon: L.divIcon({ html, className:'', iconSize:[size,size], iconAnchor:[size/2,size/2] }),
            interactive: false, zIndexOffset: 9000
        }).addTo(map);
    } else {
        ghostMarker.setLatLng(latlng);
    }

    // Rubber-band line for edge mode
    if (editorMode === 'edge' && edgeFromNode) {
        const fromNode = byId(edgeFromNode);
        if (fromNode) {
            if (!edgePreviewLine) {
                edgePreviewLine = L.polyline([[fromNode.y,fromNode.x], latlng], {
                    color: '#60a5fa', weight: 2.5, dashArray: '6,5',
                    opacity: 0.75, interactive: false
                }).addTo(map);
            } else {
                edgePreviewLine.setLatLngs([[fromNode.y,fromNode.x], latlng]);
            }
        }
    }
}

// ================================================================
//  EDITOR — PLACE NODES
// ================================================================
function placeWaypoint(x, y) {
    snapshot();
    const id   = 'wp_' + Date.now();
    const node = { id, name:'WP-'+(waypointCounter++), x, y, type:'waypoint',
                   description:'Invisible road junction', photo:'', hours:'', facilities:[] };
    allNodes.push(node);
    drawNode(node);
    updateEditorStats();
    markUnsaved();
    flashCoords(x, y);
}

function openNameDialog(x, y) {
    const name = prompt('Location name:');
    if (!name?.trim()) return;
    const type = prompt(
        'Node type:\nacademic | admin | food | sports | entrance | event | residential | intersection'
    )?.trim() || 'intersection';
    snapshot();
    const id   = name.trim().toLowerCase().replace(/\s+/g,'_') + '_' + Date.now();
    const node = { id, name:name.trim(), x, y, type, description:'', photo:'', hours:'', facilities:[] };
    allNodes.push(node);
    drawNode(node);
    populateSelects();
    updateEditorStats();
    markUnsaved();
    showToast(`✓ "${node.name}" placed`);
}

// ================================================================
//  EDITOR — NODE CLICK DISPATCH
// ================================================================
function onNodeClick(node) {
    if (!editorActive) {
        if (node.type !== 'waypoint') { selectedNode=node; showPreview(node); pulseMarker(node.id); }
        return;
    }
    switch(editorMode) {
        case 'edge':     handleEdgeAdd(node);    break;
        case 'del_node': handleDeleteNode(node); break;
        case 'del_edge': handleEdgeDel(node);    break;
        // waypoint / named → clicks on nodes do nothing (place only on map bg)
    }
}

// ================================================================
//  EDITOR — ADD EDGE (click-click with rubber-band)
// ================================================================
function handleEdgeAdd(node) {
    if (!edgeFromNode) {
        edgeFromNode = node.id;
        setNodeStyle(node.id, true);
        showToast(`From: "${node.name}" — now click the destination node  (Esc to cancel)`);
    } else {
        if (edgeFromNode === node.id) { cancelEdgeMode(); return; }

        const dup = allEdges.some(e =>
            (e.from===edgeFromNode&&e.to===node.id)||
            (e.from===node.id&&e.to===edgeFromNode));

        if (!dup) {
            snapshot();
            const edge = { from:edgeFromNode, to:node.id };
            allEdges.push(edge);
            drawEdgeLine(edge);
            markUnsaved();
            updateEditorStats();
            showToast(`Connected: "${byId(edgeFromNode).name}" ↔ "${node.name}"`);
        } else {
            showToast('⚠ Edge already exists');
        }
        cleanupEdgePreview();
        setNodeStyle(edgeFromNode, false);
        edgeFromNode = null;
    }
}

// ================================================================
//  EDITOR — DELETE EDGE
// ================================================================
function handleEdgeDel(node) {
    if (!delEdgeFromNode) {
        delEdgeFromNode = node.id;
        setNodeStyle(node.id, true);
        showToast(`Remove edge FROM: "${node.name}" — click the other node`);
    } else {
        const idx = allEdges.findIndex(e =>
            (e.from===delEdgeFromNode&&e.to===node.id)||
            (e.from===node.id&&e.to===delEdgeFromNode));

        setNodeStyle(delEdgeFromNode, false);

        if (idx !== -1) {
            snapshot();
            const re = allEdges.splice(idx, 1)[0];
            const li = edgePolylines.findIndex(ep =>
                (ep.from===re.from&&ep.to===re.to)||(ep.from===re.to&&ep.to===re.from));
            if (li !== -1) { map.removeLayer(edgePolylines[li].line); edgePolylines.splice(li,1); }
            markUnsaved();
            updateEditorStats();
            showToast(`Edge removed between "${byId(delEdgeFromNode)?.name}" and "${node.name}"`);
        } else {
            showToast('⚠ No edge between those nodes');
        }
        delEdgeFromNode = null;
    }
}

// ================================================================
//  EDITOR — DELETE NODE
// ================================================================
function handleDeleteNode(node) {
    if (!confirm(`Delete "${node.name}" and all its edges?`)) return;
    snapshot();
    // Remove edges
    const removed = allEdges.filter(e => e.from===node.id||e.to===node.id);
    allEdges = allEdges.filter(e => e.from!==node.id&&e.to!==node.id);
    removed.forEach(re => {
        const li = edgePolylines.findIndex(ep =>
            (ep.from===re.from&&ep.to===re.to)||(ep.from===re.to&&ep.to===re.from));
        if (li !== -1) { map.removeLayer(edgePolylines[li].line); edgePolylines.splice(li,1); }
    });
    // Remove node
    allNodes = allNodes.filter(n => n.id!==node.id);
    if (nodeMarkers[node.id]) { map.removeLayer(nodeMarkers[node.id].marker); delete nodeMarkers[node.id]; }
    populateSelects();
    updateEditorStats();
    markUnsaved();
    showToast(`Deleted: "${node.name}"`);
}

// ================================================================
//  UNDO
// ================================================================
function snapshot() {
    undoStack.push({
        nodes: JSON.parse(JSON.stringify(allNodes)),
        edges: JSON.parse(JSON.stringify(allEdges))
    });
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    updateUndoBtn();
}

function undoAction() {
    if (!undoStack.length) { showToast('Nothing to undo'); return; }
    const prev = undoStack.pop();
    allNodes = prev.nodes;
    allEdges = prev.edges;
    cancelEdgeMode();
    redrawAll();
    populateSelects();
    markUnsaved();
    updateUndoBtn();
    showToast('↩ Undone');
}

function updateUndoBtn() {
    const btn = document.getElementById('undoBtn');
    if (btn) { btn.disabled = undoStack.length === 0; btn.textContent = `↩ Undo (${undoStack.length})`; }
}

// ================================================================
//  EDITOR MODE & TOGGLE
// ================================================================
function toggleEditor() {
    editorActive = !editorActive;
    cancelEdgeMode();
    removeGhost();

    const panel = document.getElementById('editorPanel');
    const btn   = document.getElementById('editorToggleBtn');

    if (editorActive) {
        panel.style.display = 'flex';
        btn.textContent = '✕ Exit Editor';
        btn.classList.add('active-editor-btn');
        setEditorMode('waypoint');
        showToast('Editor ON — click on map to place waypoints');
    } else {
        panel.style.display = 'none';
        btn.textContent = '🛠 Edit Map';
        btn.classList.remove('active-editor-btn');
        document.getElementById('map').style.cursor = '';
        showToast('Editor closed');
    }
    redrawAll();
}

function setEditorMode(mode) {
    editorMode = mode;
    cancelEdgeMode();
    removeGhost();

    document.querySelectorAll('.editor-mode-btn').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById('mode_'+mode);
    if (btn) btn.classList.add('active');

    // Cursor
    const cursors = { waypoint:'crosshair', named:'crosshair', edge:'pointer', del_node:'not-allowed', del_edge:'not-allowed' };
    document.getElementById('map').style.cursor = editorActive ? (cursors[mode]||'default') : '';

    // Hint text + color
    const hints = {
        waypoint:  { text:'Click anywhere on a road/path to drop an invisible waypoint junction', color:'#f0abfc' },
        named:     { text:'Click on the map to place a named, visible location node', color:'#fbbf24' },
        edge:      { text:'Click a node to start an edge, then click another node to connect them  (Esc = cancel)', color:'#60a5fa' },
        del_node:  { text:'Click any node to permanently delete it and all its edges', color:'#f87171' },
        del_edge:  { text:'Click two connected nodes to remove only the edge between them', color:'#fb923c' }
    };
    const h = hints[mode] || { text:'', color:'#94a3b8' };
    const hintEl = document.getElementById('editorHint');
    hintEl.textContent = h.text;
    hintEl.style.borderColor = h.color + '44';
    hintEl.style.color = h.color;
    hintEl.style.background = h.color + '0d';
}

function cancelEdgeMode() {
    if (edgeFromNode)    { setNodeStyle(edgeFromNode, false);    edgeFromNode=null; }
    if (delEdgeFromNode) { setNodeStyle(delEdgeFromNode, false); delEdgeFromNode=null; }
    cleanupEdgePreview();
}

function cleanupEdgePreview() {
    if (edgePreviewLine) { map.removeLayer(edgePreviewLine); edgePreviewLine=null; }
}

function removeGhost() {
    if (ghostMarker) { map.removeLayer(ghostMarker); ghostMarker=null; }
}

// ================================================================
//  WAYPOINT VISIBILITY TOGGLE
// ================================================================
function setWaypointVisibility(visible) {
    showWaypoints = visible;
    allNodes.filter(n=>n.type==='waypoint').forEach(node => {
        const el = nodeMarkers[node.id]?.marker.getElement()?.querySelector('.nc');
        if (el) { el.style.opacity = visible?'1':'0'; el.style.pointerEvents = visible?'all':'none'; }
    });
    edgePolylines.forEach(({line, from, to}) => {
        const a=byId(from), b=byId(to);
        if (a?.type==='waypoint'||b?.type==='waypoint') {
            line.setStyle({ opacity: visible ? 1 : 0 });
        }
    });
}

// ================================================================
//  SAVE / DOWNLOAD
// ================================================================
async function saveGraph() {
    const btn = document.getElementById('saveBtn');
    btn.textContent='Saving...'; btn.disabled=true;
    try {
        const res = await fetch('/api/save_nodes', {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ nodes:allNodes, edges:allEdges })
        });
        const data = await res.json();
        if (data.success) { showToast('✅ Saved to nodes.json and reloaded!'); clearUnsaved(); }
        else showToast('Save failed: '+(data.error||'unknown'));
    } catch(e) { showToast('Save failed: '+e.message); }
    btn.textContent='💾 Save Graph'; btn.disabled=false;
}

function downloadGraph() {
    const json = JSON.stringify({nodes:allNodes, edges:allEdges}, null, 2);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json],{type:'application/json'}));
    a.download = 'nodes.json'; a.click();
    showToast('nodes.json downloaded');
}

// ================================================================
//  FIND PATH
// ================================================================
async function findPath() {
    const start = document.getElementById('startNode').value;
    const end   = document.getElementById('endNode').value;
    if (!start||!end) { showToast('⚠ Select start and destination'); return; }
    if (start===end)  { showToast('⚠ Same node selected twice'); return; }
    showToast('Calculating shortest path...');
    try {
        const res = await fetch('/find_path', {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({start, end})
        });
        const data = await res.json();
        if (!data.path) { showToast('No path found — check your graph connections'); return; }
        drawPath(data.path);
        showRouteInfo(data);
        showToast('✓ Route found!');
    } catch(e) { showToast('Error: '+e.message); }
}

function drawPath(coordinates) {
    clearPathLayers();
    // glow
    L.polyline(coordinates, {color:'#60a5fa',weight:16,opacity:0.12,interactive:false}).addTo(map);
    // main line
    pathLine = L.polyline(coordinates, {
        color:'#3b82f6', weight:5, opacity:0.95,
        lineJoin:'round', lineCap:'round', interactive:false
    }).addTo(map);
    addPin(coordinates[0], '#10b981', 'S');
    addPin(coordinates[coordinates.length-1], '#ef4444', 'E');
    map.fitBounds(pathLine.getBounds(), {padding:[80,80]});
}

function addPin(coord, color, label) {
    L.marker(coord, {
        icon: L.divIcon({
            html:`<div style="width:26px;height:26px;background:${color};border-radius:50%;
                  border:3px solid white;box-shadow:0 0 18px ${color}99;
                  display:flex;align-items:center;justify-content:center;
                  font-size:11px;font-weight:700;color:white;font-family:'Sora',sans-serif;">${label}</div>`,
            className:'', iconSize:[26,26], iconAnchor:[13,13]
        }), interactive:false, zIndexOffset:500
    }).addTo(map);
}

function clearPathLayers() {
    if (pathLine) { map.removeLayer(pathLine); pathLine=null; }
    map.eachLayer(layer => {
        if ((layer instanceof L.Polyline) && !edgePolylines.find(e=>e.line===layer)) map.removeLayer(layer);
        if ((layer instanceof L.Marker)   && layer.options.interactive===false) map.removeLayer(layer);
    });
}

function clearPath() {
    clearPathLayers();
    document.getElementById('routeInfo').style.display='none';
    document.getElementById('startNode').value='';
    document.getElementById('endNode').value='';
    showToast('Route cleared');
}

function showRouteInfo(data) {
    document.getElementById('routeInfo').style.display='block';
    document.getElementById('distanceStat').textContent = `${data.distance}m`;
    document.getElementById('timeStat').textContent     = `~${data.estimated_time} min`;

    const stops = (data.path_ids||[]).slice(1,-1)
        .filter(id=>{ const n=byId(id); return n&&n.type!=='waypoint'; }).length;
    document.getElementById('stopsStat').textContent = stops;

    const list = document.getElementById('directionsList');
    list.innerHTML='';
    let stepNum = 1;
    (data.steps||[]).forEach((step,i)=>{
        const id=data.path_ids?.[i], n=id?byId(id):null;
        if (n?.type==='waypoint') return;
        const div=document.createElement('div');
        div.className='direction-step';
        div.innerHTML=`<span class="step-num">${String(stepNum++).padStart(2,'0')}</span><span>${step}</span>`;
        list.appendChild(div);
    });
}

// ================================================================
//  LOCATION PREVIEW
// ================================================================
function showPreview(node) {
    document.getElementById('previewName').textContent  = node.name;
    document.getElementById('previewDesc').textContent  = node.description||'';
    document.getElementById('previewHours').textContent = node.hours||'—';
    const color=getColor(node.type), badge=document.getElementById('previewBadge');
    badge.textContent=node.type;
    badge.style.cssText=`background:${color.bg}22;color:${color.bg};border:1px solid ${color.bg}55;`;
    const img=document.getElementById('previewImage');
    img.src=node.photo||''; img.style.display=node.photo?'block':'none';
    const fac=document.getElementById('previewFacilities'); fac.innerHTML='';
    (node.facilities||[]).forEach(f=>{ const t=document.createElement('span'); t.className='facility-tag'; t.textContent=f; fac.appendChild(t); });
    document.getElementById('locationPreview').classList.add('visible');
    map.panTo([node.y,node.x],{animate:true,duration:0.4});
}
function closePreview() { document.getElementById('locationPreview').classList.remove('visible'); selectedNode=null; }
function setAsStart()   { if(!selectedNode)return; document.getElementById('startNode').value=selectedNode.id; showToast(`Start: ${selectedNode.name}`); }
function setAsEnd()     { if(!selectedNode)return; document.getElementById('endNode').value=selectedNode.id;   showToast(`End: ${selectedNode.name}`); }

// ================================================================
//  SEARCH
// ================================================================
document.getElementById('searchBox').addEventListener('input', function(){
    const q=this.value.trim().toLowerCase(), res=document.getElementById('searchResults');
    if(!q){res.style.display='none';return;}
    const matches=allNodes.filter(n=>n.type!=='waypoint'&&n.name.toLowerCase().includes(q));
    res.innerHTML='';
    if(!matches.length){res.style.display='none';return;}
    matches.forEach(node=>{
        const item=document.createElement('div'); item.className='search-result-item';
        const c=getColor(node.type);
        item.innerHTML=`<div class="search-result-dot" style="background:${c.bg}"></div><span>${node.name}</span>`;
        item.onclick=()=>{ selectedNode=node; showPreview(node); pulseMarker(node.id); res.style.display='none'; this.value=node.name; };
        res.appendChild(item);
    });
    res.style.display='block';
});
document.addEventListener('click', e=>{ if(!e.target.closest('.search-wrapper')) document.getElementById('searchResults').style.display='none'; });

// ================================================================
//  UTILS
// ================================================================
function byId(id) { return allNodes.find(n=>n.id===id)||null; }

function populateSelects() {
    ['startNode','endNode'].forEach(selId=>{
        const sel=document.getElementById(selId), cur=sel.value;
        sel.innerHTML='<option value="">Select location</option>';
        allNodes.filter(n=>n.type!=='waypoint').forEach(n=>sel.add(new Option(n.name,n.id)));
        if(cur) sel.value=cur;
    });
}

function pulseMarker(id) {
    const el=nodeMarkers[id]?.marker.getElement()?.querySelector('.nc');
    if(!el)return;
    el.style.transform='scale(2)';
    setTimeout(()=>{ el.style.transform='scale(1)'; },600);
}

function updateEditorStats() {
    const named=allNodes.filter(n=>n.type!=='waypoint').length;
    const wps  =allNodes.filter(n=>n.type==='waypoint').length;
    document.getElementById('nodeCount').textContent=named;
    document.getElementById('edgeCount').textContent=allEdges.length;
    document.getElementById('wpCount').textContent=wps;
}

function flashCoords(x,y) {
    showToast(`Waypoint placed · x:${x.toFixed(0)} y:${y.toFixed(0)}`);
}

function toggleSidebar() {
    sidebarOpen=!sidebarOpen;
    document.getElementById('sidebar').classList.toggle('hidden',!sidebarOpen);
}

let unsaved=false;
function markUnsaved()  { unsaved=true;  const s=document.getElementById('saveBtn'); if(s) s.textContent='💾 Save Graph *'; }
function clearUnsaved() { unsaved=false; const s=document.getElementById('saveBtn'); if(s) s.textContent='💾 Save Graph'; }
window.addEventListener('beforeunload', e=>{ if(unsaved) e.preventDefault(); });

let toastTimer;
function showToast(msg) {
    const t=document.getElementById('toast');
    t.textContent=msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.classList.remove('show'),3200);
}

function injectLoadingOverlay() {
    const d=document.createElement('div'); d.id='loadingOverlay'; d.className='loading-overlay';
    d.innerHTML='<div class="loading-logo">&#9672;</div><div class="loading-text">LOADING CAMPUS MAP...</div>';
    document.body.appendChild(d);
}
function hideLoading() { const o=document.getElementById('loadingOverlay'); if(o){o.classList.add('fade');setTimeout(()=>o.remove(),500);} }

window.addEventListener('load', initMap);
