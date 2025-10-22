// src/lib/tracks.js
export const CLEAN_PARENS_RX = /\s*\((?:official|music\s*video|video|audio|lyrics?|original\s*mix|extended\s*mix|radio\s*edit|remaster(?:ed)?(?:\s*\d{4})?|copy.*)\)\s*$/gi;
export const CLEAN_COPY_RX   = /-\s*copy(\s*\(\d+\))?/gi;

export function cleanTitle(s = "") {
  return s.replace(CLEAN_PARENS_RX, "").replace(CLEAN_COPY_RX, "").replace(/\s{2,}/g, " ").trim();
}

export function cleanArtist(s = "") {
  return s.replace(/\s*-\s*topic$/i, "").trim();
}

export function readTagFromName(name = "") {
  const noExt = name.replace(/\.(mp3|m4a|wav|flac|aac|ogg)$/i, "").replace(/[_·•]+/g, " ");
  const seps = [" - ", " – ", " — "];
  const sep = seps.find(s => noExt.includes(s));
  if (sep) {
    const [artist, ...rest] = noExt.split(sep);
    return { artist: artist.trim(), title: rest.join(sep).trim() };
  }
  return { artist: "", title: noExt.trim() };
}

export function msToMMSS(ms) {
  const s = Math.round((ms || 0) / 1000);
  const mm = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export function measureDurationMs(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const a = new Audio();
    a.preload = "metadata";
    a.src = url;
    a.onloadedmetadata = () => {
      const ms = Number.isFinite(a.duration) ? Math.round(a.duration * 1000) : 0;
      URL.revokeObjectURL(url);
      resolve(ms || 0);
    };
    a.onerror = () => { URL.revokeObjectURL(url); resolve(0); };
  });
}
