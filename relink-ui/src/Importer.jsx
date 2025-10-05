// relink-ui/src/Importer.jsx
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from './supabaseClient'

function bytes(n){ if(n==null) return '-'; const u=['B','KB','MB','GB']; let i=0,x=n; while(x>=1024&&i<u.length-1){x/=1024;i++} return `${x.toFixed(1)} ${u[i]}` }
async function safeJson(res){ const t=await res.text(); try{return JSON.parse(t)}catch{ throw new Error(`HTTP ${res.status}. Body starts with: ${t.slice(0,120)}`) } }
function cleanWhitespace(s=''){ return s.replace(/\s{2,}/g,' ').trim() }

const NOISE_PATTERNS=[/\b(out\s*now)\b/ig,/\bofficial(?:\s+music)?\s+(?:video|audio)\b/ig,/\bofficial\b/ig,/\blyrics?\b/ig,/\blyric\s+video\b/ig,/\bvisuali[sz]er\b/ig,/\b(HD|4K|8K)\b/ig,/\b(explicit|clean|dirty)\b/ig,/\s*-\s*copy(?:\s*\(\d+\))?\s*$/ig,/https?:\/\/\S+/ig,/\b(youtu\.?be|soundcloud|facebook|instagram|tiktok|linktr\.ee)\b/ig];
function removeNoise(str=''){ let x=str; x=x.replace(/\.(mp3|m4a|wav|flac|aac|ogg)$/i,''); x=x.replace(/[_·•]+/g,' '); x=x.replace(/\s*[\[\(\{](?:https?:\/\/|www\.)?.*?[\]\)\}]\s*/g,' '); for(const re of NOISE_PATTERNS) x=x.replace(re,' '); return cleanWhitespace(x) }
function stripFeat(s=''){ return cleanWhitespace(s.replace(/\s*\((feat|ft\.?)\s.+?\)/ig,' ').replace(/\s*-\s*(feat|ft\.?)\s.+$/ig,' ')) }
function readTagFromName(name=''){ const base=removeNoise(name); const seps=[' - ', ' – ', ' — ']; let idx=-1, sep=' - '; for(const s of seps){ const i=base.indexOf(s); if(i!==-1){ idx=i; sep=s; break } } if(idx!==-1){ const artist=cleanWhitespace(base.slice(0,idx)); const title=stripFeat(cleanWhitespace(base.slice(idx+sep.length))); return {artist,title} } return {artist:'', title:stripFeat(base)} }
function measureDurationMs(file){ return new Promise((resolve)=>{ const url=URL.createObjectURL(file); const a=new Audio(); a.preload='metadata'; a.src=url; a.onloadedmetadata=()=>{ const ms=Number.isFinite(a.duration)?Math.round(a.duration*1000):0; URL.revokeObjectURL(url); resolve(ms||0) }; a.onerror=()=>{ URL.revokeObjectURL(url); resolve(0) } }) }

const CLEAN_PARENS_RX=/\s*\((?:official|music\s*video|video|audio|lyrics?|original\s*mix|extended\s*mix|radio\s*edit|remaster(?:ed)?(?:\s*\d{4})?|copy.*)\)\s*$/gi
const CLEAN_COPY_RX=/-\s*copy(\s*\(\d+\))?/gi
function cleanTitle(s){ return (s||'').replace(CLEAN_PARENS_RX,'').replace(CLEAN_COPY_RX,'').replace(/\s{2,}/g,' ').trim() }
function cleanArtist(s){ return (s||'').replace(/\s*-\s*topic$/i,'').trim() }

export default function Importer({ apiBase }) {
  const nav = useNavigate()
  const location = useLocation()

  const [tab, setTab] = useState('import')
  const [playlistName, setPlaylistName] = useState('moja playlista')

  const [files, setFiles] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [scanning, setScanning] = useState(false)
  const [matched, setMatched] = useState([])

  const [loadingFiles, setLoadingFiles] = useState(false)
  const [loadingProgress, setLoadingProgress] = useState(0)
  const [scanProgress, setScanProgress] = useState(0)

  const [cloudLoading, setCloudLoading] = useState(false)
  const [cloudFiles, setCloudFiles] = useState([])
  const [cloudSelected, setCloudSelected] = useState(new Set())

  const [spName, setSpName] = useState(null)
  const [flash, setFlash] = useState(null)
  const [connecting, setConnecting] = useState(false)

  const folderInputRef = useRef(null)
  const multiInputRef = useRef(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data?.session) nav('/')
    })
  }, [nav])

  async function authHeaders() {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    return token ? { Authorization: `Bearer ${token}` } : {}
  }

  async function fetchSpotifyStatus() {
    try {
      const res = await fetch(`${apiBase}/api/spotify/status`, { headers: { ...(await authHeaders()) } })
      const data = await safeJson(res)
      if (data.ok && data.connected) setSpName(data.name || 'Połączono')
      else setSpName(null)
    } catch (e) {
      console.warn('[Importer] status error:', e)
      setSpName(null)
    }
  }

  useEffect(() => { fetchSpotifyStatus() }, [])
  useEffect(() => { if (tab === 'cloud') loadCloud() }, [tab])
  useEffect(() => {
    const url = new URL(window.location.href)
    const flag = url.searchParams.get('spotify')
    const reason = url.searchParams.get('reason')
    if (flag) {
      if (flag === 'error') setFlash({ type:'err', text:`Błąd łączenia Spotify${reason ? `: ${reason}` : ''}` })
      else setFlash({ type:'ok', text:'Połączono ze Spotify' })
      fetchSpotifyStatus()
      url.searchParams.delete('spotify'); url.searchParams.delete('reason')
      window.history.replaceState({}, '', url.toString())
      setTimeout(()=>setFlash(null), 4000)
    }
  }, [location.key])

  async function handleFiles(fileList) {
    const arr = Array.from(fileList || []).filter(f => /\.(mp3|m4a|wav|flac|aac|ogg)$/i.test(f.name))
    if (!arr.length) return
    
    setLoadingFiles(true)
    setLoadingProgress(0)
    
    const mapped = []
    for (let i = 0; i < arr.length; i++) {
      const f = arr[i]
      const { artist, title } = readTagFromName(f.name)
      const durationMs = await measureDurationMs(f)
      mapped.push({ file: f, name: f.name, artist, title, durationMs })
      setLoadingProgress(Math.round(((i + 1) / arr.length) * 100))
    }
    
    setFiles(prev => [...prev, ...mapped])
    setLoadingFiles(false)
    setLoadingProgress(0)
  }

  async function scanAndMatch() {
    if (!files.length) return alert('Najpierw dodaj pliki.')
    setScanning(true)
    setMatched([])
    setSelected(new Set())
    setScanProgress(0)
    
    try {
      const payload = {
        tracks: files.map(f => ({
          title: cleanTitle(f.title || f.name),
          artist: cleanArtist(f.artist || ''),
          durationMs: f.durationMs || 0,
        })),
      }
      
      const res = await fetch(`${apiBase}/api/match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify(payload),
      })
      const data = await safeJson(res)
      
      if (!data.ok) {
        if (data.code === 'NO_LINK') {
          alert('Nie połączono ze Spotify.')
          return
        }
        throw new Error(data.error || 'match failed')
      }
      
      const pollInterval = setInterval(async () => {
        try {
          const progressRes = await fetch(`${apiBase}/api/match/progress`, {
            headers: { ...(await authHeaders()) }
          })
          const progressData = await safeJson(progressRes)
          
          if (!progressData.exists) {
            clearInterval(pollInterval)
            return
          }
          
          if (progressData.current && progressData.total) {
            const percent = Math.round((progressData.current / progressData.total) * 100)
            setScanProgress(percent)
          }
          
          if (progressData.done) {
            clearInterval(pollInterval)
            
            if (progressData.error) {
              throw new Error(progressData.error)
            }
            
            if (progressData.results) {
              setMatched(progressData.results.results || [])
              const matchCount = progressData.results.results.filter(m => m.matched).length
              const totalCount = progressData.results.results.filter(m => !m.isDuplicate).length
              setFlash({ 
                type: 'ok', 
                text: `Dopasowano ${matchCount}/${totalCount} utworów (próg: ${progressData.results.threshold})` 
              })
              setTimeout(() => setFlash(null), 5000)
            }
            
            setScanning(false)
            setScanProgress(0)
          }
        } catch (e) {
          clearInterval(pollInterval)
          alert('Błąd sprawdzania progressu: ' + e.message)
          setScanning(false)
          setScanProgress(0)
        }
      }, 500)
      
    } catch (e) {
      alert('Błąd dopasowania: ' + e.message)
      setScanning(false)
      setScanProgress(0)
    }
  }

  async function createPlaylist() {
    const indices = [...selected]
    const tracksToAdd = indices.map(i => matched[i]).filter(m => m?.matched && m?.spotifyId)
    
    if (!tracksToAdd.length) return alert('Zaznacz dopasowane utwory do playlisty.')
    
    try {
      const trackUris = tracksToAdd.map(m => `spotify:track:${m.spotifyId}`)
      const res = await fetch(`${apiBase}/api/playlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ name: playlistName, trackUris }),
      })
      const data = await safeJson(res)
      if (!data.ok) {
        if (data.code === 'NO_LINK') {
          alert('Nie połączono ze Spotify.')
          return
        }
        throw new Error(data.error || 'playlist failed')
      }
      if (data.playlistUrl) window.open(data.playlistUrl, '_blank')
      else alert('Playlist utworzona.')
    } catch (e) {
      alert('Błąd tworzenia playlisty: ' + e.message)
    }
  }

  async function uploadToCloud() {
    const indices = [...selected]
    if (!indices.length) return alert('Zaznacz pliki do chmury.')
    const form = new FormData()
    indices.forEach(i => { const f = files[i]?.file; if (f) form.append('files', f, f.name) })
    try {
      const res = await fetch(`${apiBase}/api/upload`, {
        method: 'POST',
        headers: { ...(await authHeaders()) },
        body: form,
      })
      const data = await safeJson(res)
      if (!data.ok) throw new Error(data.error || 'upload failed')
      alert(`Przeniesiono: ${data.files.filter(x => x.ok).length} plików`)
      await loadCloud()
    } catch (e) {
      alert('Błąd chmury: ' + e.message)
    }
  }

  async function deleteSelected() {
    if (!selected.size) return alert('Zaznacz pliki do usunięcia.')
    if (!confirm(`Usunąć ${selected.size} zaznaczonych plików?`)) return
    
    const indices = [...selected].sort((a,b) => b - a)
    setFiles(prev => prev.filter((_, i) => !indices.includes(i)))
    setMatched(prev => prev.filter((_, i) => !indices.includes(i)))
    setSelected(new Set())
  }

  async function deleteCloudFiles() {
    if (!cloudSelected.size) return alert('Zaznacz pliki do usunięcia.')
    if (!confirm(`Usunąć ${cloudSelected.size} ${cloudSelected.size === 1 ? 'plik' : 'plików'} z chmury?`)) return
    
    try {
      const filenames = [...cloudSelected].map(idx => cloudFiles[idx].name)
      
      const res = await fetch(`${apiBase}/api/cloud/delete`, {
        method: 'DELETE',
        headers: { 
          'Content-Type': 'application/json',
          ...(await authHeaders()) 
        },
        body: JSON.stringify({ filenames }),
      })
      
      const data = await safeJson(res)
      
      if (!data.ok) throw new Error(data.error || 'delete failed')
      
      setFlash({ 
        type: 'ok', 
        text: `Usunięto ${data.deleted} ${data.deleted === 1 ? 'plik' : 'plików'}${data.failed > 0 ? `, błędy: ${data.failed}` : ''}` 
      })
      setTimeout(() => setFlash(null), 4000)
      
      setCloudSelected(new Set())
      await loadCloud()
    } catch (e) {
      alert('Błąd usuwania: ' + e.message)
    }
  }

  async function loadCloud() {
    setCloudLoading(true)
    try {
      const res = await fetch(`${apiBase}/api/cloud/list`, { headers: { ...(await authHeaders()) } })
      const data = await safeJson(res)
      if (!data.ok) throw new Error(data.error || 'list failed')
      setCloudFiles(data.files || [])
    } catch (e) {
      alert('Błąd chmury: ' + e.message)
    } finally {
      setCloudLoading(false)
    }
  }

  async function logout() {
    await supabase.auth.signOut()
    nav('/')
  }

  async function connectSpotify() {
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token || ''
      if (!token) { 
        alert('Najpierw zaloguj się.') 
        return 
      }
      
      const origin = window.location.origin
      const frontendUrl = `${origin}/app`
      
      const url = `${apiBase}/spotify/login?frontend=${encodeURIComponent(frontendUrl)}&token=${encodeURIComponent(token)}`
      
      setConnecting(true)
      window.location.assign(url)
    } catch (e) {
      setConnecting(false)
      alert('Błąd: ' + (e?.message || e))
    }
  }

  async function disconnectSpotify() {
    if (!confirm('Odłączyć Spotify?')) return
    
    try {
      const res = await fetch(`${apiBase}/api/spotify/disconnect`, {
        method: 'POST',
        headers: { ...(await authHeaders()) },
      })
      const data = await safeJson(res)
      
      if (!data.ok) throw new Error(data.error || 'disconnect failed')
      
      setSpName(null)
      setFlash({ type: 'ok', text: 'Odłączono Spotify' })
      setTimeout(() => setFlash(null), 3000)
    } catch (e) {
      alert('Błąd: ' + e.message)
    }
  }

  function selectAllMatched() {
    const all = new Set()
    matched.forEach((m, i) => {
      if (m.matched && !m.isDuplicate) all.add(i)
    })
    setSelected(all)
  }

  function selectAllUnmatched() {
    const all = new Set()
    matched.forEach((m, i) => {
      if (!m.matched && !m.isDuplicate) all.add(i)
    })
    setSelected(all)
  }

  function selectAll() {
    const all = new Set()
    matched.forEach((m, i) => {
      if (!m.isDuplicate) all.add(i)
    })
    setSelected(all)
  }

  function selectAllCloud() {
    const all = new Set(cloudFiles.map((_, i) => i))
    setCloudSelected(all)
  }

  function deselectAllCloud() {
    setCloudSelected(new Set())
  }

  return (
    <div style={{ minHeight:'100svh', display:'grid', placeItems:'center', padding:'24px', fontFamily:'system-ui, sans-serif' }}>
      <div style={{ width:'min(1200px, 96vw)', background:'#fff', border:'1px solid #e5e7eb', borderRadius:12, padding:16, boxShadow:'0 6px 24px rgba(0,0,0,0.06)' }}>
        {flash && (
          <div style={{
            marginBottom:10, padding:'8px 12px',
            borderRadius:8,
            background: flash.type==='ok' ? '#e8f7ee' : '#fdeaea',
            color: flash.type==='ok' ? '#0a6b2a' : '#a11',
            border: '1px solid ' + (flash.type==='ok' ? '#bfe7cc' : '#f4c7c7')
          }}>
            {flash.text}
          </div>
        )}

        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8 }}>
          <h2 style={{ margin:8 }}>ReLink MVP</h2>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            {spName ? (
              <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                <span style={{ padding:'6px 10px', background:'#eefbf3', border:'1px solid #b7e6c7', color:'#0c6b2a', borderRadius:8, fontSize:14 }}>
                  Spotify: <b>{spName}</b>
                </span>
                <button onClick={disconnectSpotify} title="Odłącz Spotify"
                  style={{ padding:'5px 9px', border:'1px solid #dc2626', background:'#fee2e2', color:'#dc2626', borderRadius:8, fontSize:12, cursor:'pointer' }}>
                  Odłącz
                </button>
              </div>
            ) : (
              <button onClick={connectSpotify} disabled={connecting}
                style={{ 
                  padding:'7px 14px', 
                  border:'1px solid #1DB954', 
                  background:'#1DB954', 
                  color:'#fff', 
                  borderRadius:8,
                  cursor: connecting ? 'wait' : 'pointer',
                  fontSize:14,
                  fontWeight:500
                }}>
                {connecting ? 'Łączenie…' : 'Połącz Spotify'}
              </button>
            )}
            <button onClick={logout} style={{ padding:'6px 10px', border:'1px solid #d1d5db', borderRadius:8, background:'#f5f5f5', fontSize:14 }}>
              Wyloguj
            </button>
          </div>
        </div>

        <div style={{ marginBottom:12 }}>
          <button onClick={()=>setTab('import')} style={{ padding:'6px 10px', marginRight:8, background:tab==='import'?'#222':'#eee', color:tab==='import'?'#fff':'#000', border:'1px solid #ccc', borderRadius:6 }}>
            Import i dopasowanie
          </button>
          <button onClick={()=>setTab('cloud')} style={{ padding:'6px 10px', background:tab==='cloud'?'#222':'#eee', color:tab==='cloud'?'#fff':'#000', border:'1px solid #ccc', borderRadius:6 }}>
            Moja chmura
          </button>
        </div>

        {tab==='import' && (
          <>
            <div style={{ marginBottom:10 }}>
              <div style={{ marginBottom:6 }}>
                <label style={{ fontSize:12, color:'#666' }}>Nazwa playlisty:</label>
                <input value={playlistName} onChange={e=>setPlaylistName(e.target.value)} style={{ width:360, padding:6, marginLeft:8 }} placeholder="np. Moje importy" />
              </div>

              <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:10 }}>
                <button onClick={()=>folderInputRef.current?.click()} disabled={loadingFiles} style={{ padding:'6px 10px' }}>
                  {loadingFiles ? 'Ładowanie…' : 'Wybierz folder'}
                </button>
                <input ref={folderInputRef} type="file" style={{ display:'none' }} webkitdirectory="true" directory="true" multiple onChange={e=>handleFiles(e.target.files)} />
                <button onClick={()=>multiInputRef.current?.click()} disabled={loadingFiles} style={{ padding:'6px 10px' }}>
                  {loadingFiles ? 'Ładowanie…' : 'Wybierz pliki'}
                </button>
                <input ref={multiInputRef} type="file" style={{ display:'none' }} multiple accept=".mp3,.m4a,.wav,.flac,.aac,.ogg" onChange={e=>handleFiles(e.target.files)} />
                <span style={{ fontSize:12, color:'#666' }}>Plików: {files.length}</span>
              </div>

              {loadingFiles && (
                <div style={{ marginBottom:10 }}>
                  <div style={{ fontSize:12, color:'#666', marginBottom:4 }}>Wczytywanie plików: {loadingProgress}%</div>
                  <div style={{ width:'100%', height:8, background:'#e5e7eb', borderRadius:4, overflow:'hidden' }}>
                    <div style={{ width:`${loadingProgress}%`, height:'100%', background:'#3b82f6', transition:'width 0.3s ease' }} />
                  </div>
                </div>
              )}

              {scanning && (
                <div style={{ marginBottom:10 }}>
                  <div style={{ fontSize:12, color:'#666', marginBottom:4 }}>Dopasowywanie: {Math.round(scanProgress)}%</div>
                  <div style={{ width:'100%', height:8, background:'#e5e7eb', borderRadius:4, overflow:'hidden' }}>
                    <div style={{ width:`${scanProgress}%`, height:'100%', background:'#16a34a', transition:'width 0.3s ease' }} />
                  </div>
                </div>
              )}

              <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                <button onClick={scanAndMatch} disabled={scanning || !files.length} style={{ padding:'6px 12px', fontWeight:500, background:'#1d4ed8', color:'#fff', border:'1px solid #1e40af', borderRadius:6 }}>
                  {scanning ? 'Dopasowuję…' : 'Skanuj i dopasuj'}
                </button>
                
                {matched.length > 0 && (
                  <>
                    <button onClick={selectAll} style={{ padding:'6px 10px', fontSize:13, border:'1px solid #6b7280', background:'#f9fafb', color:'#374151', borderRadius:6 }}>
                      Zaznacz wszystkie
                    </button>
                    <button onClick={selectAllMatched} style={{ padding:'6px 10px', fontSize:13, border:'1px solid #16a34a', background:'#f0fdf4', color:'#16a34a', borderRadius:6 }}>
                      Zaznacz wszystkie dopasowane
                    </button>
                    <button onClick={selectAllUnmatched} style={{ padding:'6px 10px', fontSize:13, border:'1px solid #eab308', background:'#fefce8', color:'#ca8a04', borderRadius:6 }}>
                      Zaznacz wszystkie niedopasowane
                    </button>
                    <button onClick={createPlaylist} disabled={!selected.size} style={{ padding:'6px 12px', fontWeight:500, background:'#16a34a', color:'#fff', border:'1px solid #15803d', borderRadius:6 }}>
                      Utwórz playlistę ({selected.size})
                    </button>
                    <button onClick={uploadToCloud} disabled={!selected.size} style={{ padding:'6px 10px', fontSize:13, border:'1px solid #0891b2', background:'#cffafe', color:'#0e7490', borderRadius:6 }}>
                      Do chmury ({selected.size})
                    </button>
                    <button onClick={deleteSelected} disabled={!selected.size} style={{ padding:'6px 10px', fontSize:13, border:'1px solid #dc2626', background:'#fee2e2', color:'#dc2626', borderRadius:6 }}>
                      Skasuj ({selected.size})
                    </button>
                  </>
                )}
              </div>
            </div>

            <div style={{ marginTop:12, overflowX:'auto' }}>
              <table width="100%" cellPadding={6} style={{ borderCollapse:'collapse' }}>
                <thead style={{ background:'#f5f5f5' }}>
                  <tr>
                    <th style={{ textAlign:'center', width:40 }}>Status</th>
                    <th style={{ textAlign:'left' }}>Plik</th>
                    <th style={{ textAlign:'left' }}>Artysta</th>
                    <th style={{ textAlign:'left' }}>Spotify</th>
                    <th style={{ textAlign:'center', width:60 }}>Zaznacz</th>
                  </tr>
                </thead>
                <tbody>
                  {files.map((f,i)=>{
                    const m = matched[i]
                    if (m?.isDuplicate) {
                      return (
                        <tr key={i} style={{ borderTop:'1px solid #eee', background:'#fafafa' }}>
                          <td style={{ textAlign:'center' }}>
                            <span style={{ color:'#999', fontSize:18 }}>⊗</span>
                          </td>
                          <td colSpan={4} style={{ color:'#999', fontSize:12, fontStyle:'italic' }}>
                            {f.name} <span style={{ color:'#f59e0b' }}>(duplikat - pominięto)</span>
                          </td>
                        </tr>
                      )
                    }
                    
                    const isMatched = m?.matched
                    const checked = selected.has(i)
                    
                    return (
                      <tr key={i} style={{ borderTop:'1px solid #eee' }}>
                        <td style={{ textAlign:'center' }}>
                          <span style={{ fontSize:20 }}>{isMatched ? '🟢' : '🟡'}</span>
                        </td>
                        <td style={{ fontSize:13 }}>{f.name}</td>
                        <td style={{ fontSize:13 }}>{f.artist || '-'}</td>
                        <td style={{ fontSize:13 }}>
                          {m?.spotifyUrl ? (
                            <a href={m.spotifyUrl} target="_blank" rel="noreferrer">
                              {m.name} — {m.artists}
                            </a>
                          ) : (
                            <span style={{ color:'#999' }}>Brak dopasowania</span>
                          )}
                          {m?.duplicates > 0 && (
                            <span style={{ marginLeft:6, fontSize:11, color:'#f59e0b' }}>
                              (+{m.duplicates} {m.duplicates === 1 ? 'kopia' : 'kopii'})
                            </span>
                          )}
                        </td>
                        <td style={{ textAlign:'center' }}>
                          <input 
                            type="checkbox" 
                            checked={checked} 
                            onChange={e=>{
                              setSelected(prev=>{
                                const next=new Set(prev)
                                if(e.target.checked) next.add(i)
                                else next.delete(i)
                                return next
                              })
                            }}
                          />
                        </td>
                      </tr>
                    )
                  })}
                  {!files.length && (
                    <tr><td colSpan={5} style={{ color:'#777', fontStyle:'italic', textAlign:'center', padding:20 }}>
                      Dodaj pliki by rozpocząć
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {tab==='cloud' && (
          <div>
            <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:8 }}>
              <h3 style={{ margin:0 }}>Moja chmura</h3>
              <button onClick={loadCloud} disabled={cloudLoading} style={{ padding:'4px 10px' }}>
                {cloudLoading ? 'Odświeżam…' : 'Odśwież'}
              </button>
              
              {cloudFiles.length > 0 && (
                <>
                  <button 
                    onClick={selectAllCloud} 
                    style={{ 
                      padding:'4px 10px', 
                      fontSize:13, 
                      border:'1px solid #6b7280', 
                      background:'#f9fafb', 
                      borderRadius:6 
                    }}>
                    Zaznacz wszystkie
                    </button>
                  <button 
                    onClick={deselectAllCloud} 
                    style={{ 
                      padding:'4px 10px', 
                      fontSize:13, 
                      border:'1px solid #6b7280', 
                      background:'#f9fafb', 
                      borderRadius:6 
                    }}>
                    Odznacz wszystkie
                  </button>
                  <button 
                    onClick={deleteCloudFiles} 
                    disabled={!cloudSelected.size}
                    style={{ 
                      padding:'6px 12px', 
                      fontSize:13, 
                      fontWeight:500,
                      border:'1px solid #dc2626', 
                      background: cloudSelected.size ? '#dc2626' : '#fee2e2', 
                      color: cloudSelected.size ? '#fff' : '#dc2626',
                      borderRadius:6,
                      cursor: cloudSelected.size ? 'pointer' : 'not-allowed'
                    }}>
                    Usuń ({cloudSelected.size})
                  </button>
                </>
              )}
            </div>

            <table width="100%" cellPadding={6} style={{ borderCollapse:'collapse' }}>
              <thead style={{ background:'#f5f5f5' }}>
                <tr>
                  <th style={{ textAlign:'center', width:40 }}>Zaznacz</th>
                  <th style={{ textAlign:'left' }}>Nazwa</th>
                  <th style={{ textAlign:'left' }}>Rozmiar</th>
                  <th style={{ textAlign:'left' }}>Podgląd / Pobierz</th>
                </tr>
              </thead>
              <tbody>
                {cloudFiles.map((f,idx)=>{
                  const checked = cloudSelected.has(idx)
                  return (
                    <tr key={idx} style={{ borderTop:'1px solid #eee', background: checked ? '#f0f9ff' : 'transparent' }}>
                      <td style={{ textAlign:'center' }}>
                        <input 
                          type="checkbox" 
                          checked={checked} 
                          onChange={e=>{
                            setCloudSelected(prev=>{
                              const next = new Set(prev)
                              if(e.target.checked) next.add(idx)
                              else next.delete(idx)
                              return next
                            })
                          }}
                        />
                      </td>
                      <td>{f.name}</td>
                      <td>{bytes(f.size)}</td>
                      <td>
                        <audio src={f.url} controls preload="none" style={{ width:280 }} />
                        {' '}
                        <a href={f.url} download target="_blank" rel="noreferrer">Pobierz</a>
                      </td>
                    </tr>
                  )
                })}
                {!cloudFiles.length && (
                  <tr><td colSpan={4} style={{ color:'#777', fontStyle:'italic', textAlign:'center', padding:20 }}>
                    Brak plików
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}