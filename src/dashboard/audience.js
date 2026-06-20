// audience.js

function getActiveProjectData() {
    if (!analyticsData || !analyticsData.projects) return null;
    if (activeProjectKey === 'all') {
        const allSessions = [];
        const visitorsMap = {};
        
        analyticsData.projects.forEach(p => {
            if (p.sessions) {
                p.sessions.forEach(s => {
                    allSessions.push({ ...s, project_key: p.project_key });
                });
            }
            if (p.visitors) {
                p.visitors.forEach(v => {
                    const vid = v.visitor_id;
                    if (!vid) return;
                    if (!visitorsMap[vid]) {
                        visitorsMap[vid] = { ...v, projects: [p.project_key] };
                    } else {
                        const existing = visitorsMap[vid];
                        if (v.devices) {
                            v.devices.forEach(d => {
                                if (!existing.devices.includes(d)) existing.devices.push(d);
                            });
                        }
                        if (v.browsers) {
                            v.browsers.forEach(b => {
                                if (!existing.browsers.includes(b)) existing.browsers.push(b);
                            });
                        }
                        if (v.locations) {
                            v.locations.forEach(l => {
                                if (l !== 'Unknown Location' && existing.locations.includes('Unknown Location')) {
                                    existing.locations = existing.locations.filter(x => x !== 'Unknown Location');
                                }
                                if (l === 'Unknown Location' && existing.locations.length > 0 && !existing.locations.includes('Unknown Location')) {
                                    return;
                                }
                                if (!existing.locations.includes(l)) existing.locations.push(l);
                            });
                        }
                        if (v.narrative && !existing.narrative.includes(v.narrative)) {
                            existing.narrative = existing.narrative ? `${existing.narrative}\n\n[${p.project_key}]: ${v.narrative}` : v.narrative;
                        }
                        if (!existing.projects.includes(p.project_key)) {
                            existing.projects.push(p.project_key);
                        }
                        
                        // Pick the highest intent user type
                        const typePriority = { 'deep': 4, 'engaged': 3, 'glancer': 2, 'bounce': 1, 'unknown': 0 };
                        const existingPriority = typePriority[existing.user_type] || 0;
                        const newPriority = typePriority[v.user_type] || 0;
                        if (newPriority > existingPriority) {
                            existing.user_type = v.user_type;
                        }
                    }
                });
            }
        });
        
        return {
            visitors: Object.values(visitorsMap),
            sessions: allSessions
        };
    } else {
        const proj = analyticsData.projects.find(p => p.project_key === activeProjectKey);
        return proj ? { visitors: proj.visitors || [], sessions: proj.sessions || [] } : null;
    }
}

function renderAudience() {
    const projectData = getActiveProjectData();
    if (!projectData) return;

    const listContainer = document.getElementById('audience-list');
    if (!listContainer) return;
    
    const searchTerm = document.getElementById('audienceSearch').value.toLowerCase();
    const typeFilter = document.getElementById('audienceTypeFilter').value;
    const locationFilterElement = document.getElementById('audienceLocationFilter');
    const locationFilter = locationFilterElement ? locationFilterElement.value : 'all';
    const dateFilter = document.getElementById('audienceDateFilter') ? document.getElementById('audienceDateFilter').value : 'all';
    const minSessions = document.getElementById('audienceMinSessions') ? parseInt(document.getElementById('audienceMinSessions').value) || 1 : 1;

    let html = '';
    
    // Get sessions from projectData
    let projectSessions = projectData.sessions || [];
    
    // Build project-specific visitor metrics
    const visitorsMap = {};
    projectSessions.forEach(s => {
        const sVisitorId = s.id.split('_')[1] || s.id;
        if (!visitorsMap[sVisitorId]) {
            // Copy the base visitor info
            const baseVisitor = (projectData.visitors || []).find(v => v.visitor_id === sVisitorId) || { visitor_id: sVisitorId, user_type: 'unknown', devices: [], narrative: '' };
            visitorsMap[sVisitorId] = {
                visitorId: sVisitorId,
                type: baseVisitor.user_type || 'unknown',
                devices: baseVisitor.devices || [],
                narrative: baseVisitor.narrative || '',
                location: baseVisitor.locations ? baseVisitor.locations.join(', ') : (baseVisitor.location || 'Unknown'),
                firstSeen: s.start,
                lastSeen: s.start,
                sessionCount: 0,
                totalDuration: 0
            };
        }
        const v = visitorsMap[sVisitorId];
        v.sessionCount++;
        v.totalDuration += (s.duration_s || 0) * 1000;
        if (new Date(s.start) < new Date(v.firstSeen)) v.firstSeen = s.start;
        if (new Date(s.start) > new Date(v.lastSeen)) v.lastSeen = s.start;
    });

    const visitors = Object.values(visitorsMap);

    // Populate Location Dropdown if it hasn't been populated yet
    if (locationFilterElement && locationFilterElement.options.length <= 1) {
        const uniqueLocations = [...new Set(visitors.map(v => {
            const parts = (v.location || 'Unknown').split(',');
            return parts[parts.length - 1].trim(); // Just country for dropdown
        }))].filter(Boolean).sort();
        
        uniqueLocations.forEach(loc => {
            const opt = document.createElement('option');
            opt.value = loc;
            opt.textContent = loc;
            locationFilterElement.appendChild(opt);
        });
    }

    const now = new Date();

    const filtered = visitors.filter(v => {
        const name = getVisitorDisplayName(v.visitorId).toLowerCase();
        if (searchTerm && !name.includes(searchTerm) && !v.visitorId.toLowerCase().includes(searchTerm)) return false;
        if (typeFilter !== 'all' && v.type !== typeFilter) return false;
        
        if (v.sessionCount < minSessions) return false;
        
        if (locationFilter !== 'all') {
            if (!(v.location || '').includes(locationFilter)) return false;
        }
        
        if (dateFilter !== 'all') {
            const daysAgo = parseInt(dateFilter);
            const msAgo = now - (daysAgo * 24 * 60 * 60 * 1000);
            if (new Date(v.lastSeen).getTime() < msAgo) return false;
        }

        return true;
    });

    if (filtered.length === 0) {
        listContainer.innerHTML = `<div style="padding:2rem; text-align:center; color:var(--text-muted); font-style:italic; grid-column: 1 / -1;">No visitors matched your criteria.</div>`;
        return;
    }

    // Sort by session count descending
    filtered.sort((a, b) => b.sessionCount - a.sessionCount);

    filtered.forEach(v => {
        const name = getVisitorDisplayName(v.visitorId);
        
        // Type badge
        let typeBadge = '';
        if (v.type === 'deep') typeBadge = `<span style="background: rgba(210, 153, 34, 0.15); color: var(--accent-amber); padding: 0.1rem 0.4rem; border-radius: 4px; font-size: 0.7rem; border: 1px solid rgba(210, 153, 34, 0.25);">🔥 Deep</span>`;
        else if (v.type === 'engaged') typeBadge = `<span style="background: rgba(63, 185, 80, 0.15); color: var(--accent-green); padding: 0.1rem 0.4rem; border-radius: 4px; font-size: 0.7rem; border: 1px solid rgba(63, 185, 80, 0.25);">⚡ Engaged</span>`;
        else if (v.type === 'glancer') typeBadge = `<span style="background: rgba(88, 166, 255, 0.15); color: var(--accent-blue); padding: 0.1rem 0.4rem; border-radius: 4px; font-size: 0.7rem; border: 1px solid rgba(88, 166, 255, 0.25);">👀 Glancer</span>`;
        else if (v.type === 'bounce') typeBadge = `<span style="background: rgba(248, 81, 73, 0.15); color: var(--accent-red); padding: 0.1rem 0.4rem; border-radius: 4px; font-size: 0.7rem; border: 1px solid rgba(248, 81, 73, 0.25);">🚪 Bounce</span>`;
        else typeBadge = `<span style="background: rgba(255, 255, 255, 0.1); color: var(--text-muted); padding: 0.1rem 0.4rem; border-radius: 4px; font-size: 0.7rem; border: 1px solid rgba(255, 255, 255, 0.2);">Bot/Other</span>`;

        html += `
        <div style="background: rgba(255,255,255,0.025); border: 1px solid var(--border-color); border-radius: 8px; padding: 1rem; display: flex; flex-direction: column; gap: 0.8rem; transition: border-color 0.2s;" onmouseover="this.style.borderColor='rgba(188, 140, 255, 0.4)'" onmouseout="this.style.borderColor='var(--border-color)'">
            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                <div style="display: flex; flex-direction: column; gap: 0.2rem;">
                    <div style="display: flex; align-items: center; gap: 0.5rem;">
                        <h3 style="margin:0; font-size: 1rem; color: var(--text-main); font-weight: 600; text-overflow: ellipsis; white-space: nowrap; overflow: hidden; max-width: 150px;">${name}</h3>
                        ${typeBadge}
                    </div>
                    <span style="font-size: 0.7rem; color: var(--text-muted); font-family: var(--font-mono); cursor: pointer;" onclick="renameVisitor('${v.visitorId}')" title="Click to rename" onmouseover="this.style.color='var(--accent-blue)'" onmouseout="this.style.color='var(--text-muted)'">ID: ${v.visitorId.slice(0,12)}... ✏️</span>
                </div>
            </div>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; font-size: 0.8rem;">
                <div><span style="color:var(--text-muted);">Sessions:</span> <strong style="color:var(--text-main);">${v.sessionCount}</strong></div>
                <div><span style="color:var(--text-muted);">Total Time:</span> <strong style="color:var(--text-main);">${formatDuration(v.totalDuration)}</strong></div>
                <div style="grid-column: span 2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;"><span style="color:var(--text-muted);">Location:</span> <span style="color:var(--text-main);">${v.location || 'Unknown'}</span></div>
                <div style="grid-column: span 2;"><span style="color:var(--text-muted);">First Seen:</span> <span style="color:var(--text-main);">${new Date(v.firstSeen).toLocaleString()}</span></div>
                <div style="grid-column: span 2;"><span style="color:var(--text-muted);">Last Seen:</span> <span style="color:var(--text-main);">${new Date(v.lastSeen).toLocaleString()}</span></div>
            </div>
            
            <button onclick="openVisitorModal('${v.visitorId}')" style="margin-top: auto; background: rgba(188, 140, 255, 0.1); border: 1px solid rgba(188, 140, 255, 0.3); color: var(--accent-purple); padding: 0.4rem; border-radius: 4px; font-size: 0.8rem; cursor: pointer; font-weight: 600; transition: background 0.2s;" onmouseover="this.style.background='rgba(188, 140, 255, 0.2)'" onmouseout="this.style.background='rgba(188, 140, 255, 0.1)'">
                View Profile & Narrative
            </button>
        </div>
        `;
    });

    listContainer.innerHTML = html;
    
    // Refresh map if it's currently visible
    if (document.getElementById('audience-map') && document.getElementById('audience-map').style.display !== 'none') {
        renderMap(filtered);
    }
}

// ----------------------------------------------------------------------------
// World Map Logic
// ----------------------------------------------------------------------------
let audienceLeafletMap = null;
let audienceMarkersLayer = null;

function toggleAudienceView(view) {
    const listBtn = document.getElementById('btnAudienceList');
    const mapBtn = document.getElementById('btnAudienceMap');
    const listContainer = document.getElementById('audience-list');
    const mapContainer = document.getElementById('audience-map');
    
    if (view === 'list') {
        listBtn.style.background = 'var(--accent-blue)';
        listBtn.style.color = '#fff';
        mapBtn.style.background = 'transparent';
        mapBtn.style.color = 'var(--text-muted)';
        
        listContainer.style.display = 'grid';
        mapContainer.style.display = 'none';
    } else {
        mapBtn.style.background = 'var(--accent-blue)';
        mapBtn.style.color = '#fff';
        listBtn.style.background = 'transparent';
        listBtn.style.color = 'var(--text-muted)';
        
        listContainer.style.display = 'none';
        mapContainer.style.display = 'block';
        
        // Trigger resize so Leaflet knows its container size changed
        if (audienceLeafletMap) {
            audienceLeafletMap.invalidateSize();
        }
        
        // Render map with current filters
        renderAudience(); 
    }
}

function renderMap(filteredVisitors) {
    if (typeof L === 'undefined') return; // Leaflet not loaded
    
    if (!audienceLeafletMap) {
        audienceLeafletMap = L.map('audience-map').setView([20, 0], 2);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
            subdomains: 'abcd',
            maxZoom: 19
        }).addTo(audienceLeafletMap);
        
        audienceMarkersLayer = L.layerGroup().addTo(audienceLeafletMap);
    }
    
    audienceMarkersLayer.clearLayers();
    
    // Group visitors by country
    const countryGroups = {};
    filteredVisitors.forEach(v => {
        const parts = (v.location || 'Unknown').split(',');
        const country = parts[parts.length - 1].trim();
        if (!countryGroups[country]) countryGroups[country] = [];
        countryGroups[country].push(v);
    });
    
    for (const [country, visitors] of Object.entries(countryGroups)) {
        if (typeof COUNTRY_COORDS !== 'undefined' && COUNTRY_COORDS[country]) {
            const [lat, lon] = COUNTRY_COORDS[country];
            
            // Marker styling based on traffic volume
            const size = Math.min(Math.max(visitors.length * 5, 10), 40);
            
            const markerHtml = \`<div style="background: rgba(188, 140, 255, 0.4); border: 2px solid var(--accent-purple); border-radius: 50%; width: \${size}px; height: \${size}px; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 0.7rem; font-weight: bold; box-shadow: 0 0 10px rgba(188, 140, 255, 0.5);">\${visitors.length}</div>\`;
            
            const icon = L.divIcon({
                html: markerHtml,
                className: 'custom-map-marker',
                iconSize: [size, size],
                iconAnchor: [size/2, size/2]
            });
            
            const popupHtml = \`
                <div style="font-family: var(--font-main); color: #333; min-width: 150px;">
                    <h4 style="margin: 0 0 0.5rem 0; border-bottom: 1px solid #ccc; padding-bottom: 0.25rem;">\${country}</h4>
                    <div style="font-size: 0.8rem;">
                        <strong>\${visitors.length}</strong> Visitors<br>
                        <strong>\${visitors.reduce((acc, v) => acc + v.sessionCount, 0)}</strong> Sessions
                    </div>
                </div>
            \`;
            
            L.marker([lat, lon], { icon }).bindPopup(popupHtml).addTo(audienceMarkersLayer);
        }
    }
}

function formatDuration(ms) {
    if (!ms) return '0s';
    const s = Math.floor(ms / 1000);
    if (s < 60) return s + 's';
    const m = Math.floor(s / 60);
    return m + 'm ' + (s % 60) + 's';
}

async function renameVisitor(visitorId) {
    const currentName = getVisitorDisplayName(visitorId);
    const newName = prompt("Enter custom tag for visitor (this will be saved globally):", currentName === visitorId ? "" : currentName);
    
    if (newName !== null) {
        const cleaned = newName.trim();
        if (cleaned) {
            localStorage.setItem('alias_' + visitorId, cleaned);
            visitorAliases[visitorId] = cleaned;
            
            try {
                const res = await fetch('/ripple/api/save_visitor_name.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ visitorId, name: cleaned })
                });
                const data = await res.json();
                if(!data.success) console.warn("Failed to save alias to server:", data.error);
            } catch(err) {
                console.error("Error saving alias:", err);
            }
        } else {
            localStorage.removeItem('alias_' + visitorId);
            delete visitorAliases[visitorId];
            
            try {
                await fetch('/ripple/api/save_visitor_name.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ visitorId, name: "" })
                });
            } catch(err) {
                console.error("Error deleting alias:", err);
            }
        }
        
        renderAudience();
        if(typeof applyFilters === 'function') applyFilters(); // refresh explorer
        
        // Update open modal header if currently open
        const modal = document.getElementById('visitorModal');
        if (modal && modal.style.display === 'flex') {
            openVisitorModal(visitorId);
        }
    }
}

// Modal logic
// Modal logic
function openVisitorModal(visitorId) {
    const projectData = getActiveProjectData();
    if (!projectData) return;
    const baseV = (projectData.visitors || []).find(x => x.visitor_id === visitorId) || {};
    
    // Recalculate project-specific stats
    const sessions = (projectData.sessions || []).filter(s => (s.id.split('_')[1] || s.id) === visitorId);
    sessions.sort((a, b) => new Date(b.start) - new Date(a.start));
    const sessionCount = sessions.length;
    const totalDuration = sessions.reduce((acc, s) => acc + (s.duration_s || 0) * 1000, 0);

    const name = getVisitorDisplayName(visitorId);

    // Get unique referrers
    const referrers = [...new Set(sessions.map(s => s.referrer || 'direct'))].filter(Boolean);
    const referrerDisplay = referrers.join(', ') || 'direct';

    // Create modal if it doesn't exist
    let modal = document.getElementById('visitorModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'visitorModal';
        modal.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.8); z-index: 1000;
            display: flex; justify-content: center; align-items: center;
        `;
        document.body.appendChild(modal);
    }
    
    const narrativeText = baseV.narrative ? baseV.narrative.replace(/\n/g, '<br>') : "No narrative available.";
    const userLocation = baseV.locations ? baseV.locations.join(', ') : (baseV.location || 'Unknown');

    modal.innerHTML = `
        <div style="background: var(--bg-main); border: 1px solid var(--border-color); border-radius: 8px; width: 90%; max-width: 800px; max-height: 90vh; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
            <div style="padding: 1rem 1.5rem; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.02);">
                <h2 style="margin: 0; font-size: 1.2rem; color: var(--text-main);">👤 ${name} Profile</h2>
                <button onclick="document.getElementById('visitorModal').style.display='none'" style="background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 1.5rem; line-height: 1;">&times;</button>
            </div>
            
            <div style="padding: 1.5rem; overflow-y: auto;">
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-bottom: 1.5rem;">
                    <!-- Left Column: Metrics -->
                    <div style="background: rgba(0,0,0,0.2); border: 1px solid var(--border-color); border-radius: 8px; padding: 1rem;">
                        <h4 style="margin: 0 0 1rem 0; color: var(--accent-purple); font-size: 0.9rem; text-transform: uppercase;">User Stats</h4>
                        <div style="display: grid; grid-template-columns: 1fr; gap: 0.6rem; font-size: 0.85rem;">
                            <div style="display:flex; justify-content:space-between;"><span style="color:var(--text-muted);">Sessions:</span> <strong>${sessionCount}</strong></div>
                            <div style="display:flex; justify-content:space-between;"><span style="color:var(--text-muted);">User Type:</span> <strong style="text-transform:capitalize;">${baseV.user_type || 'unknown'}</strong></div>
                            <div style="display:flex; justify-content:space-between;"><span style="color:var(--text-muted);">Total Time:</span> <strong>${formatDuration(totalDuration)}</strong></div>
                            <div style="display:flex; justify-content:space-between;"><span style="color:var(--text-muted);">Browser:</span> <strong>${(baseV.browsers || baseV.devices || []).join(', ')}</strong></div>
                            <div style="display:flex; justify-content:space-between;"><span style="color:var(--text-muted);">Location:</span> <strong>${userLocation}</strong></div>
                            <div style="display:flex; justify-content:space-between;"><span style="color:var(--text-muted);">Referrer:</span> <strong>${referrerDisplay}</strong></div>
                        </div>
                    </div>
                    
                    <!-- Right Column: Journey Summary -->
                    <div style="background: rgba(188, 140, 255, 0.05); border: 1px solid rgba(188, 140, 255, 0.2); border-radius: 8px; padding: 1rem;">
                        <h4 style="margin: 0 0 0.5rem 0; color: var(--accent-purple); font-size: 0.9rem; text-transform: uppercase;">AI Generated Narrative</h4>
                        <p style="font-size: 0.85rem; line-height: 1.5; color: var(--text-main); margin:0; max-height: 150px; overflow-y: auto;">
                            ${narrativeText}
                        </p>
                    </div>
                </div>
                
                <h4 style="margin: 0 0 1rem 0; color: var(--text-main); border-bottom: 1px solid var(--border-color); padding-bottom: 0.5rem;">Session Timeline</h4>
                <div style="display: flex; flex-direction: column; padding-left: 0.5rem;">
                    ${renderSessionTimeline(sessions)}
                </div>
            </div>
            
            <div style="padding: 1rem 1.5rem; border-top: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.02);">
                <span style="font-size: 0.75rem; color: var(--text-muted); font-family: var(--font-mono);">ID: ${visitorId}</span>
                <div style="display:flex; gap:0.5rem;">
                    <button class="btn-status" onclick="renameVisitor('${visitorId}')" style="border-color: var(--accent-blue); color: var(--accent-blue);">✏️ Rename User</button>
                    <button class="btn-status" onclick="generateSingleAIAnalysis('${visitorId}')" style="border-color: var(--accent-purple); color: var(--accent-purple);">✨ Generate AI Profile</button>
                </div>
            </div>
        </div>
    `;
    modal.style.display = 'flex';
}

async function generateSingleAIAnalysis(visitorId) {
    const projectData = getActiveProjectData();
    if (!projectData) return;
    const baseV = (projectData.visitors || []).find(x => x.visitor_id === visitorId) || {};
    
    const name = getVisitorDisplayName(visitorId);
    let promptText = `Please analyze the behavioral profile of user "${name}" (ID: ${visitorId}) for the project "${activeProjectKey}".\n\n`;
    promptText += `Provide insights into this specific user's friction points, goals, engagement style, and overall narrative.\n\n`;
    
    // gather their sessions
    const sessions = (projectData.sessions || []).filter(s => (s.id.split('_')[1] || s.id) === visitorId);
    sessions.sort((a, b) => new Date(b.start) - new Date(a.start));
    const sessionCount = sessions.length;
    const totalDuration = sessions.reduce((acc, s) => acc + (s.duration_s || 0) * 1000, 0);
    
    promptText += `## User Summary\n`;
    promptText += `- Type: ${baseV.user_type || 'unknown'}\n`;
    promptText += `- Sessions: ${sessionCount}, Total Duration: ${formatDuration(totalDuration)}\n`;
    promptText += `- Location: ${baseV.locations ? baseV.locations.join(', ') : (baseV.location || 'Unknown')}, Devices: ${(baseV.browsers || baseV.devices || []).join(', ')}\n`;
    const referrers = [...new Set(sessions.map(s => s.referrer || 'direct'))].filter(Boolean);
    const referrerDisplay = referrers.join(', ') || 'direct';
    promptText += `- Referrer: ${referrerDisplay}\n`;
    promptText += `- Generated Narrative: ${(baseV.narrative || "").replace(/\n/g, ' ')}\n\n`;
    
    promptText += `## Session Timeline\n`;
    sessions.forEach(s => {
        let paths = [];
        if (s.events && s.events.length > 0) {
            paths = s.events.filter(e => e.type === 'page_view' || e.type === 'view_changed').map(e => e.data.path || e.data.url || e.data.view).filter(Boolean);
            paths = [...new Set(paths)];
        }
        promptText += `- ${new Date(s.start).toLocaleString()} (Duration: ${s.duration})\n`;
        if(paths.length > 0) promptText += `  Visited: ${paths.join(' ➔ ')}\n`;
    });

    const body = new URLSearchParams();
    body.append('project', activeProjectKey);
    body.append('category', 'data');
    body.append('prompt', promptText);

    try {
        const res = await fetch('/ripple/api/capture_prompt.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString()
        });
        const result = await res.json();
        
        if (result.success) {
            alert(`Single AI Analysis request captured! Prompt saved to:\n${result.file}\n\nThe 'data' agent will process this shortly.`);
        } else {
            alert("Failed to submit analysis: " + result.error);
        }
    } catch(err) {
        console.error("Error submitting AI analysis:", err);
        alert("Error submitting request. Check console.");
    }
}

function toggleModalSessionDetails(sessionId) {
    const detailsDiv = document.getElementById(`modal-details-${sessionId}`);
    if (!detailsDiv) return;
    detailsDiv.classList.toggle('hidden');
}

function renderSessionTimeline(sessions) {
    if (sessions.length === 0) return `<div style="color:var(--text-muted); font-style:italic;">No detailed sessions available.</div>`;

    return sessions.map(s => {
        const sDate = new Date(s.start).toLocaleString();
        
        const pathStr = s.path || '(no path)';
        const pathParts = pathStr === '(no path)' ? ['(no path)'] : pathStr.split(' → ');
        const pathChips = pathParts.map((pPart, j) => {
            const escaped = pPart.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
            return `${j > 0 ? '<span class="view-arrow">→</span>' : ''}<span class="view-chip" style="font-size: 10px; padding: 1px 6px;">${escaped}</span>`;
        }).join('');

        const classBadges = {
            deep: { label: "deep", color: "var(--accent-purple)", bg: "rgba(188, 140, 255, 0.1)" },
            engaged: { label: "engaged", color: "var(--accent-green)", bg: "rgba(63, 185, 80, 0.1)" },
            glancer: { label: "glancer", color: "var(--accent-blue)", bg: "rgba(56, 139, 253, 0.1)" },
            bounce: { label: "bounce", color: "var(--text-muted)", bg: "rgba(139, 148, 158, 0.1)" },
            ghost: { label: "ghost", color: "var(--accent-amber)", bg: "rgba(210, 153, 34, 0.1)" },
            bot: { label: "bot", color: "var(--accent-red)", bg: "rgba(248, 81, 73, 0.1)" }
        };
        const badge = classBadges[s.classification] || { label: s.classification, color: "var(--text-muted)", bg: "rgba(255,255,255,0.05)" };

        const viewsMarkup = (s.views || []).map(v => `
            <span style="background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.06); padding: 0.15rem 0.4rem; border-radius: 4px; font-size: 0.7rem; font-family: var(--font-mono); color: var(--text-muted);">
                ${v.view}: <strong>${v.duration}</strong>
            </span>
        `).join('');

        const eventsMarkup = (s.events || []).map(e => {
            const t = new Date(e.timestamp);
            const timeOnly = t.toLocaleTimeString(undefined, { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
            let detailsStr = "";
            if (e.details) {
                if (e.details.conclusion) detailsStr = `<span style="color: var(--accent-green);">[conclusion: ${e.details.conclusion}]</span>`;
                else if (e.details.to) detailsStr = `<span style="color: var(--text-muted);">→ ${e.details.to}</span>`;
                else if (e.details.title) detailsStr = `<span style="color: var(--accent-amber); font-weight: 500;">"${e.details.title}"</span>`;
                else if (e.details.modal) detailsStr = `<span style="color: var(--accent-purple);">[modal: ${e.details.modal}]</span>`;
                else if (e.details.timeOnPage) detailsStr = `<span style="color: var(--text-muted);">(stayed ${parseFloat(e.details.timeOnPage).toFixed(1)}s)</span>`;
            }
            return `
                <div style="font-size: 0.7rem; font-family: var(--font-mono); display: flex; gap: 0.5rem; color: var(--text-muted); line-height: 1.4;">
                    <span style="color: var(--accent-blue);">${timeOnly}</span>
                    <span style="color: var(--text-main); font-weight: 600;">${e.name}</span>
                    <span>${detailsStr}</span>
                </div>
            `;
        }).join('');

        return `
            <div class="journey-session-row ${s.classification}" style="margin-bottom: 0.5rem;">
                <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.8rem; cursor:pointer;" onclick="toggleModalSessionDetails('${s.id}')">
                    <div>
                        <span style="font-weight:600; color:var(--text-main);">${sDate}</span>
                        <span style="color:var(--text-muted); margin-left:0.5rem;">⏱️ ${s.duration}</span>
                        <span style="color:var(--text-muted); margin-left:0.5rem;">🔗 ${s.referrer === 'direct' ? 'direct' : s.referrer}</span>
                    </div>
                    <span style="background:${badge.bg}; color:${badge.color}; padding:0.1rem 0.3rem; border-radius:3px; font-size:0.65rem; font-weight:700; text-transform:uppercase; border: 1px solid ${badge.color}22;">${badge.label}</span>
                </div>
                <div style="margin-top:0.25rem; font-family:var(--font-mono); display:flex; justify-content:space-between; align-items:center; gap: 0.5rem; cursor:pointer;" onclick="toggleModalSessionDetails('${s.id}')">
                    <div style="display:flex; align-items:center; gap:0.4rem; flex-wrap:wrap; font-size:0.75rem; color:var(--text-muted);">
                        <span>Path:</span>
                        <div class="path-str" style="display:inline-flex; gap: 4px;">${pathChips}</div>
                    </div>
                    <span style="font-size: 0.7rem; color: var(--accent-blue); white-space: nowrap;">Inspect ▾</span>
                </div>
                
                <div id="modal-details-${s.id}" class="session-expanded-details hidden" style="margin-top: 0.6rem; border-top: 1px solid rgba(34, 42, 61, 0.3); padding-top: 0.6rem; display: flex; flex-direction: column; gap: 0.6rem;">
                    <div>
                        <div style="font-size: 0.68rem; font-weight: 600; color: var(--text-muted); margin-bottom: 0.3rem; text-transform: uppercase;">View Durations</div>
                        <div style="display: flex; flex-wrap: wrap; gap: 0.3rem;">
                            ${viewsMarkup || '<span style="color:var(--text-muted); font-style:italic; font-size:0.7rem;">None</span>'}
                        </div>
                    </div>
                    <div>
                        <div style="font-size: 0.68rem; font-weight: 600; color: var(--text-muted); margin-bottom: 0.3rem; text-transform: uppercase;">Behavior Timeline</div>
                        <div style="display: flex; flex-direction: column; gap: 0.25rem; background: rgba(0,0,0,0.18); padding: 0.5rem 0.7rem; border-radius: 6px; border: 1px solid rgba(34,42,61,0.2);">
                            ${eventsMarkup || '<div style="color:var(--text-muted); font-style:italic; font-size:0.7rem;">None</div>'}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// Hook into applyFilters
setTimeout(() => {
    if (window.applyFilters) {
        const originalApplyFilters = window.applyFilters;
        window.applyFilters = function() {
            originalApplyFilters();
            renderAudience();
        };
        renderAudience();
    }
}, 500);

async function generateAggregateAIAnalysis() {
    const projectData = getActiveProjectData();
    if (!projectData || !projectData.visitors || projectData.visitors.length === 0) {
        alert("No visitor data available to analyze.");
        return;
    }

    // Filter sessions by active project
    let projectSessions = projectData.sessions || [];
    
    // Get unique visitors for the current project selection
    const visitorIds = new Set(projectSessions.map(s => s.id.split('_')[1] || s.id));
    const visitors = (projectData.visitors || []).filter(v => visitorIds.has(v.visitor_id));

    if(visitors.length === 0) {
        alert("No visitors found for the selected project.");
        return;
    }
    
    // Prepare prompt text
    let promptText = `Please analyze the following aggregated user audience data for the project "${activeProjectKey}".\n\n`;
    promptText += `Provide insights on:\n1. User segmentation (Deep, Engaged, Glancers)\n2. Location trends\n3. Device/Platform preferences\n4. Overall behavioral themes and potential friction points.\n\n`;
    promptText += `Here is the user summary data:\n\n`;

    visitors.forEach(v => {
        const name = getVisitorDisplayName(v.visitor_id);
        // compute stats for this specific project and visitor
        const vSessions = projectSessions.filter(s => (s.id.split('_')[1] || s.id) === v.visitor_id);
        const sCount = vSessions.length;
        const totalDuration = vSessions.reduce((acc, s) => acc + (s.duration_s || 0) * 1000, 0);
        
        promptText += `- User: ${name} (Type: ${v.user_type || 'unknown'})\n`;
        promptText += `  Sessions: ${sCount}, Total Duration: ${formatDuration(totalDuration)}\n`;
        promptText += `  Location: ${v.locations ? v.locations.join(', ') : (v.location || 'Unknown')}, Devices: ${(v.devices || []).join(', ')}\n`;
        promptText += `  Narrative: ${(v.narrative || "").replace(/\n/g, ' ')}\n\n`;
    });

    const body = new URLSearchParams();
    body.append('project', activeProjectKey);
    body.append('category', 'data');
    body.append('prompt', promptText);

    try {
        const res = await fetch('/ripple/api/capture_prompt.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString()
        });
        const result = await res.json();
        
        if (result.success) {
            alert(`Aggregate AI Analysis request captured! Prompt saved to:\n${result.file}\n\nThe 'data' agent will process this shortly.`);
        } else {
            alert("Failed to submit analysis: " + result.error);
        }
    } catch(err) {
        console.error("Error submitting AI analysis:", err);
        alert("Error submitting request. Check console.");
    }
}
