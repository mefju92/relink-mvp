// relink-ui/src/Importer.jsx
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from './supabaseClient'

// === utils ===
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

// === component ===
export default function Importer({ apiBase }) {
  const nav = useNavigate()
  const location = useLocation()

  const [tab, setTab] = useState('import')
  const [playlistName, setPlaylistName] = useState('moja playlista')
  const [minScore, setMinScore] = useState(0.58)

  const [files, setFiles] = useState([])
  const [selectedForCloud, setSelectedForCloud] = useState(new Set())
  const [scanning, setScanning] = useState(false)
  const [matched, setMatched] = useState([])

  const [cloudLoading, setCloudLoading] = useState(false)
  const [cloudFiles, setCloudFiles] = useState([])

  const [spName, setSpName] = useState(null)
  const [flash, setFlash] = useState(null)
  const [connecting, setConnecting] = useState(false)

  const folderInputRef = useRef(null)
  const multiInputRef = useRef(null)

  console.log('[Importer] apiBase =', apiBase)

  // bez sesji – cofamy na /
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
      console.log('[Importer] /api/spotify/status →', data)
      if (data.ok && data.connected) setSpName(data.name || 'Połączono')
      else setSpName(null)
    } catch (e) {
      console.warn('[Importer] status error:', e)
      setSpName(null)
    }
  }

  // po załadowaniu
  useEffect(() => { fetchSpotifyStatus() }, [])
  // kiedy przełączamy na chmurę
  useEffect(() => { if (tab === 'cloud') loadCloud() }, [tab])
  // po powrocie z OAuth (?spotify=...):
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
    const mapped = await Promise.all(arr.map(async (f) => {
      const { artist, title } = readTagFromName(f.name)
      const durationMs = await measureDurationMs(f)
      return { file: f, name: f.name, artist, title, durationMs }
    }))
    setFiles(prev => [...prev, ...mapped])
  }

  async function scanAndMatch() {
    if (!files.length) return alert('Najpierw dodaj pliki.')
    setScanning(true)
    try {
      const payload = {
        minScore,
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
          alert('Nie połączono ze Spotify. Kliknij przycisk "Połącz Spotify" żeby połączyć konto.')
          return
        }
        throw new Error(data.error || 'match failed')
      }
      setMatched(data.results || [])
    } catch (e) {
      alert('Błąd dopasowania: ' + e.message)
    } finally {
      setScanning(false)
    }
  }

  async function createPlaylist() {
    const ok = matched.filter(m => m.spotifyId)
    if (!ok.length) return alert('Brak dopasowań do dodania.')
    try {
      const trackUris = ok.map(m => `spotify:track:${m.spotifyId}`)
      const res = await fetch(`${apiBase}/api/playlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ name: playlistName, trackUris }),
      })
      const data = await safeJson(res)
      if (!data.ok) {
        if (data.code === 'NO_LINK') {
          alert('Nie połączono ze Spotify. Kliknij przycisk "Połącz Spotify" żeby połączyć konto.')
          return
        }
        throw new Error(data.error || 'playlist failed')
      }
      if (data.playlistUrl) window.open(data.playlistUrl, '_blank')
      else alert('Playlist utworzona (brak linku URL).')
    } catch (e) {
      alert('Błąd tworzenia playlisty: ' + e.message)
    }
  }

  async function uploadToCloud() {
    const indices = [...selectedForCloud]
    if (!indices.length) return alert('Zaznacz pliki do chmury (kolumna „Do chmury").')
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
      alert(`Przeniesiono do chmury: ${data.files.filter(x => x.ok).length} plików`)
      await loadCloud()
    } catch (e) {
      alert('Błąd chmury (upload): ' + e.message)
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
        alert('Najpierw zaloguj się w aplikacji.') 
        return 
      }
      
      const origin = window.location.origin
      const frontendUrl = `${origin}/app`
      
      const url = `${apiBase}/spotify/login?frontend=${encodeURIComponent(frontendUrl)}&token=${encodeURIComponent(token)}`
      console.log('[Importer] redirect →', url)
      
      setConnecting(true)
      window.location.assign(url)
    } catch (e) {
      setConnecting(false)
      alert('Nie udało się rozpocząć logowania do Spotify: ' + (e?.message || e))
    }
  }

  async function disconnectSpotify() {
    if (!confirm('Czy na pewno chcesz odłączyć konto Spotify?')) return
    
    try {
      const res = await fetch(`${apiBase}/api/spotify/disconnect`, {
        method: 'POST',
        headers: { ...(await authHeaders()) },
      })
      const data = await safeJson(res)
      
      if (!data.ok) throw new Error(data.error || 'disconnect failed')
      
      setSpName(null)
      setFlash({ type: 'ok', text: 'Odłączono od Spotify' })
      setTimeout(() => setFlash(null), 3000)
    } catch (e) {
      alert('Błąd odłączania: ' + e.message)
    }
  }

  return (
    <div style={{ minHeight:'100svh', display:'grid', placeItems:'center', padding:'24px', fontFamily:'system-ui, sans-serif' }}>
      <div style={{ width:'min(1100px, 96vw)', background:'#fff', border:'1px solid #e5e7eb', borderRadius:12, padding:16, boxShadow:'0 6px 24px rgba(0,0,0,0.06)' }}>
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
                <button onClick={disconnectSpotify} title="Odłącz konto Spotify"
                  style={{ padding:'5px 9px', border:'1px solid #dc2626', background:'#fee2e2', color:'#dc2626', borderRadius:8, fontSize:12, cursor:'pointer' }}>
                  Odłącz
                </button>
              </div>
            ) : (
              <button onClick={connectSpotify} disabled={connecting} title="Połącz konto Spotify"
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

              <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:6 }}>
                <button onClick={()=>folderInputRef.current?.click()} style={{ padding:'6px 10px' }}>Wybierz folder (całość)</button>
                <input ref={folderInputRef} type="file" style={{ display:'none' }} webkitdirectory="true" directory="true" multiple onChange={e=>handleFiles(e.target.files)} />
                <button onClick={()=>multiInputRef.current?.click()} style={{ padding:'6px 10px' }}>Wybierz pliki</button>
                <input ref={multiInputRef} type="file" style={{ display:'none' }} multiple accept=".mp3,.m4a,.wav,.flac,.aac,.ogg" onChange={e=>handleFiles(e.target.files)} />
                <span style={{ fontSize:12, color:'#666' }}>Liczba plików: {files.length}</span>
              </div>

              <div style={{ marginTop:8, marginBottom:8 }}>
                <div style={{ fontSize:12 }}>Minimalny score: {minScore.toFixed(3)}</div>
                <input type="range" min={0} max={1} step={0.001} value={minScore} onChange={e=>setMinScore(Number(e.target.value))} style={{ width:420 }} />
                <div style={{ fontSize:11, color:'#666', marginTop:2 }}>(Próg działa po stronie serwera — im niższy, tym więcej trafień)</div>
              </div>

              <div style={{ display:'flex', gap:8, marginTop:10 }}>
                <button onClick={scanAndMatch} disabled={scanning || !files.length} style={{ padding:'6px 10px' }}>
                  {scanning ? 'Dopasowuję…' : 'Skanuj i dopasuj'}
                </button>
                <button onClick={createPlaylist} disabled={!matched.some(m=>m.spotifyId)} style={{ padding:'6px 10px' }}>
                  Utwórz playlistę
                </button>
                <button onClick={uploadToCloud} disabled={!selectedForCloud.size} style={{ padding:'6px 10px' }}>
                  Przenieś do chmury ({selectedForCloud.size})
                </button>
              </div>
            </div>

            <div style={{ marginTop:12 }}>
              <table width="100%" cellPadding={6} style={{ borderCollapse:'collapse' }}>
                <thead style={{ background:'#f5f5f5' }}>
                  <tr>
                    <th style={{ textAlign:'right', width:40 }}>#</th>
                    <th style={{ textAlign:'left' }}>Plik / Tytuł</th>
                    <th style={{ textAlign:'left' }}>Artysta</th>
                    <th style={{ textAlign:'left' }}>Spotify</th>
                    <th style={{ textAlign:'right' }}>Score</th>
                    <th style={{ textAlign:'center' }}>Do chmury</th>
                  </tr>
                </thead>
                <tbody>
                  {files.map((f,i)=>{
                    const m = matched[i]
                    const checked = selectedForCloud.has(i)
                    return (
                      <tr key={i} style={{ borderTop:'1px solid #eee' }}>
                        <td style={{ textAlign:'right', color:'#666' }}>{i+1}</td>
                        <td>{f.name}</td>
                        <td>{f.artist || '-'}</td>
                        <td>{m?.spotifyUrl ? (<a href={m.spotifyUrl} target="_blank" rel="noreferrer">{m.name ? `${m.name} — ${m.artists || ''}` : 'Otwórz w Spotify'}</a>) : <span style={{ color:'#999' }}>—</span>}</td>
                        <td style={{ textAlign:'right' }}>{m?.score != null ? m.score.toFixed(3) : '—'}</td>
                        <td style={{ textAlign:'center' }}>
                          <input type="checkbox" checked={checked} onChange={e=>{
                            setSelectedForCloud(prev=>{ const next=new Set(prev); if(e.target.checked) next.add(i); else next.delete(i); return next })
                          }}/>
                        </td>
                      </tr>
                    )
                  })}
                  {!files.length && (<tr><td colSpan={6} style={{ color:'#777', fontStyle:'italic' }}>Dodaj pliki by rozpocząć.</td></tr>)}
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
            </div>

            <table width="100%" cellPadding={6} style={{ borderCollapse:'collapse' }}>
              <thead style={{ background:'#f5f5f5' }}>
                <tr>
                  <th style={{ textAlign:'left' }}>Nazwa</th>
                  <th style={{ textAlign:'left' }}>Rozmiar</th>
                  <th style={{ textAlign:'left' }}>Podgląd / Pobierz</th>
                </tr>
              </thead>
              <tbody>
                {cloudFiles.map((f,idx)=>(
                  <tr key={idx} style={{ borderTop:'1px solid #eee' }}>
                    <td>{f.name}</td>
                    <td>{bytes(f.size)}</td>
                    <td><audio src={f.url} controls preload="none" style={{ width:280 }} />{' '}<a href={f.url} download target="_blank" rel="noreferrer">Otwórz</a></td>
                  </tr>
                ))}
                {!cloudFiles.length && (<tr><td colSpan={3} style={{ color:'#777', fontStyle:'italic' }}>Brak plików w chmurze.</td></tr>)}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}