import { useState, useEffect, useCallback } from "react";

// ─── CONSTANTES ───────────────────────────────────────────────────────────────

const PROGRAMMES = ["Programme Connu", "Programme Inconnu ", "Programme Inconnu 2 ou Libre"];

const CATEGORIES = [
  { id: "unlimited",    label: "Elite",    desc: "Catégorie élite, figures sans restrictions, 50 pilotes dans le mondes à ce niveau.", icon: "🤴" },
  { id: "advanced",     label: "Excellence",     desc: "Catégorie qui permet de se sélectionner en Elite si le score finale est > 70% ",         icon: "🕵️‍♂️" },
  { id: "intermediate", label: "National 1", desc: "Première catégorie sur avion monoplace, niveau très compétitif avec des championnats internationnaux.",icon: "🦸‍♂️" },
  { id: "primary",      label: "National 2",      desc: "Catégorie la plus difficile et complète en biplace, un titre dans cette catégorie annonce un fort potentiel.",        icon: "🔴" },
  { id: "junior",       label: "Promotion",       desc: "Catégorie biplace avec les premiers facteurs de charges négatifs.",         icon: "🟡" },
  { id: "feminine",     label: "Espoir",     desc: "Catégorie biplace d'accession à la compétition en voltige aérienne.",        icon: "🟢" },
];

const TYPES_PARI = [
  { id: "gagnant", label: "Gagnant",        desc: "Pariez sur le 1er du classement",          icon: "🥇", scope: "pilote" },
  { id: "top3",    label: "Top 3",          desc: "Pariez sur un pilote dans le top 3",        icon: "🏅", scope: "pilote" },
  { id: "bottom3", label: "3 derniers",     desc: "Pariez sur un pilote dans les 3 derniers",  icon: "🔻", scope: "pilote" },
  { id: "note",    label: "Note d'un pilote",desc: "Pariez sur la fourchette de note",          icon: "📐", scope: "note"   },
];

const FOURCHETTES = [
  { id: "90plus",  label: "≥ 83 pts", base: 1.4 },
  { id: "85_90",   label: "83–80 pts",base: 1.8 },
  { id: "80_85",   label: "77–83 pts",base: 2.2 },
  { id: "moins80", label: "< 77 pts", base: 2.8 },
];

const FLAGS = { France:"🇫🇷", Croatie:"🇭🇷", "Royaume-Uni":"🇬🇧", Japon:"🇯🇵", Espagne:"🇪🇸", Allemagne:"🇩🇪", Suède:"🇸🇪", Portugal:"🇵🇹" };

// ─── PILOTES ──────────────────────────────────────────────────────────────────

const INITIAL_PILOTS = []; // Chargé depuis le serveur au démarrage

// ─── MOTEUR DE COTES ──────────────────────────────────────────────────────────

function forceBase(p, programme) {
  const s     = (programme && p.scores?.[programme] !== undefined)
    ? p.scores[programme] : (p.score_moyen || 60);
  const parti = Math.max(1, p.participations || p.experience || 1);
  const pods  = Math.min((p.podiums || 0) / parti, 0.5) * 100;
  const exp   = Math.min(parti, 20) * 5;
  return p.score_moyen * 0.85 + pods * 0.1 + (p.regularite || 75) * 0.03 + exp * 0.02;
}

function calculerCotes(pilots, paris, programme, typePari, categorieId) {
  if (!pilots.length) return {};
  const parisRelatifs = paris.filter(p => {
    const progMatch = programme ? p.programme === programme : !p.programme;
    return p.typePari === typePari && progMatch && p.categorieId === categorieId && !p.clos;
  });
  const totalMise = parisRelatifs.reduce((s, p) => s + p.mise, 0) || 1;
  const multType = { gagnant:1.0, top3:3.0, bottom3:3.0, note:1.5 };
  const mult = multType[typePari] || 1;

  // Forces brutes
  const raw = pilots.map(p => ({
    id: p.id,
    f: forceBase(p, programme) * mult
  }));

  // Normalisation relative : on divise par la force minimale
  // → le meilleur pilote a une force relative élevée, le moins bon proche de 1
  const minF = Math.min(...raw.map(x => x.f));
  const maxF = Math.max(...raw.map(x => x.f));
  const plafond = 8;
  const forces = pilots.map(p => {
    const base = Math.pow(forceBase(p, programme), 12) * mult;
    const misesPilote = parisRelatifs.filter(x => x.piloteId === p.id).reduce((s, x) => s + x.mise, 0);
    const facteur = 1 - (misesPilote / totalMise) * 0.4;
    return { id: p.id, force: base * Math.max(0.15, facteur) };
  });
  const total = forces.reduce((s, f) => s + f.force, 0);
  const result = {};
  forces.forEach(f => {
    const prob = total > 0 ? f.force / total : 1 / forces.length;
    const raw  = (!isNaN(prob) && prob > 0) ? 0.25 / prob : 1.5;
    result[f.id] = Math.min(plafond, Math.max(1.01, Math.round(raw * 100) / 100));
  });
  return result;
}

function calculerCoteNote(paris, piloteId, fourchetteId, programme) {
  const rel = paris.filter(p => p.typePari === "note" && p.piloteId === piloteId && p.fourchetteId === fourchetteId && p.programme === (programme ?? undefined) && !p.clos);
  const base = FOURCHETTES.find(f => f.id === fourchetteId)?.base ?? 1.8;
  const influence = Math.min(0.5, rel.reduce((s,p) => s+p.mise, 0) * 0.02);
  return Math.min(3.5, Math.max(1.05, Math.round((base + influence) * 100) / 100));
}

const EMAIL_API = "";

// ─── EMAIL ────────────────────────────────────────────────────────────────────

function buildDesc(pari) {
  const typeLabel = TYPES_PARI.find(t => t.id === pari.typePari)?.label ?? pari.typePari;
  const prog      = pari.programme ? pari.programme : "Général";
  return pari.typePari === "note"
    ? "Note " + (pari.fourchetteLabel ?? "") + " de " + pari.piloteNom + " (" + prog + ")"
    : typeLabel + " : " + pari.piloteNom + " — " + prog;
}
 
async function genererEmail(pari) {
  try {
    const catLabel = CATEGORIES.find(c => c.id === pari.categorieId)?.label ?? "";
    const desc     = buildDesc(pari);
    const r = await fetch(EMAIL_API + "/api/email/confirmation", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pari, catLabel, desc }),
    });
    const data = await r.json();
    return { ok: data.ok };
  } catch { return { ok: false }; }
}
 
async function genererEmailResultat(pari, gagne, gainFinal) {
  try {
    const catLabel = CATEGORIES.find(c => c.id === pari.categorieId)?.label ?? "";
    const desc     = buildDesc(pari);
    const r = await fetch(EMAIL_API + "/api/email/resultat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pari, gagne, gainFinal, catLabel, desc }),
    });
    const data = await r.json();
    return { ok: data.ok };
  } catch { return { ok: false }; }
}

async function envoyerEmailStatut(pari, statut, bonusBieres) {
  try {
    const typeLabel = TYPES_PARI.find(t => t.id === pari.typePari)?.label ?? pari.typePari;
    const catLabel  = CATEGORIES.find(c => c.id === pari.categorieId)?.label ?? "";
    const prog      = pari.programme ? pari.programme : "Général";
    const desc      = pari.typePari === "note"
      ? "Note " + (pari.fourchetteLabel ?? "") + " de " + pari.piloteNom + " (" + prog + ")"
      : typeLabel + " : " + pari.piloteNom + " — " + prog;
    const r = await fetch("/api/email/statut", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pari, statut, bonusBieres, catLabel, desc }),
    });
    const data = await r.json();
    return { ok: data.ok };
  } catch { return { ok: false }; }
}

// ─── UI ATOMS ─────────────────────────────────────────────────────────────────

const NF = ({ nat }) => <span>{FLAGS[nat] ?? "🏳️"}</span>;

const Pill = ({ children, v = "yellow" }) => {
  const cls = { yellow:"bg-yellow-400 text-black", black:"bg-black text-yellow-400", gray:"bg-stone-200 text-stone-700", red:"bg-red-100 text-red-700", green:"bg-green-100 text-green-800" };
  return <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${cls[v] ?? cls.gray}`}>{children}</span>;
};

const Avatar = ({ initials, size="md" }) => {
  const s = { sm:"w-8 h-8 text-xs", md:"w-10 h-10 text-sm", lg:"w-16 h-16 text-xl" };
  return <div className={`${s[size]} rounded-xl bg-black text-yellow-400 font-black flex items-center justify-center flex-shrink-0`}>{initials}</div>;
};

const CoteTag = ({ value, highlight }) => {
  const color = value <= 2 ? "bg-green-200 text-green-900" : value <= 5 ? "bg-lime-100 text-lime-800" : value <= 2 ? "bg-yellow-100 text-yellow-800" : value <= 6 ? "bg-orange-100 text-orange-800" : "bg-red-100 text-red-800";
  if (highlight) return <div className="text-center px-3 py-1.5 rounded-lg font-black text-base bg-yellow-400 text-black">{value}x</div>;
  return <div className={`text-center px-2 py-1 rounded-lg font-black text-sm ${color}`}>{value}x</div>;
};

const InputF = ({ label, ...props }) => (
  <div>
    {label && <label className="text-xs font-bold text-stone-500 uppercase tracking-wider block mb-1">{label}</label>}
    <input {...props} className={`w-full bg-white border-2 border-stone-200 focus:border-yellow-400 text-stone-900 rounded-xl px-4 py-3 focus:outline-none transition-colors text-sm ${props.className||""}`} />
  </div>
);

const Card = ({ children, className="" }) => (
  <div className={`bg-white border-2 border-stone-100 rounded-2xl p-5 ${className}`}>{children}</div>
);

// ─── PAGE ACCUEIL ─────────────────────────────────────────────────────────────

function PageAccueil({ pilots, paris, setView, setSelectedPilot }) {
  const [selCat, setSelCat] = useState("unlimited");
  const cat = CATEGORIES.find(c => c.id === selCat);
  const catPilots = pilots.filter(p => p.categorieId === selCat);
  const cotes = calculerCotes(catPilots, paris, null, "gagnant", selCat);
  const sorted = [...catPilots].sort((a,b) => (cotes[a.id]??99)-(cotes[b.id]??99));
  const totalBieres = paris.filter(p => !p.clos).reduce((s,p) => s+p.mise, 0);

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-2xl bg-black p-7">
        <div className="absolute top-0 right-0 w-40 h-40 opacity-5" style={{backgroundImage:"radial-gradient(circle,#facc15 2px,transparent 2px)",backgroundSize:"16px 16px"}} />
        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
            <span className="text-yellow-400 text-xs font-bold tracking-widest uppercase">Live · Compétition en cours</span>
          </div>
          <h1 className="text-3xl font-black text-white leading-tight mb-1" style={{fontFamily:"'Bebas Neue',sans-serif",letterSpacing:"0.06em"}}>
            AEROFESTIVAL<br/>VILLENEUVE SUR LOT
          </h1>
          <p className="text-stone-400 text-sm mb-1">6 catégories · Pariez en 🍺 · Cotes dynamiques</p>
          {totalBieres > 0 && <p className="text-yellow-400 font-bold text-sm">{totalBieres} 🍺 en jeu · {paris.filter(p=>!p.clos).length} paris actifs</p>}
          <div className="flex gap-2 mt-4">
            <button onClick={() => setView("pari")} className="px-5 py-2.5 bg-yellow-400 hover:bg-yellow-300 text-black font-bold rounded-xl text-sm uppercase tracking-wider transition-all">Parier 🍺</button>
            <button onClick={() => setView("carousel")} className="px-5 py-2.5 bg-white/10 hover:bg-white/20 text-white font-bold rounded-xl text-sm uppercase tracking-wider transition-all">📺 Live</button>
          </div>
        </div>
      </div>

      {/* Sélecteur catégorie */}
      <div>
        <p className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-2">Catégorie</p>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {CATEGORIES.map(c => (
            <button key={c.id} onClick={() => setSelCat(c.id)}
              className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border-2 transition-all ${selCat===c.id?"bg-black text-yellow-400 border-black":"bg-white border-stone-200 text-stone-600 hover:border-stone-400"}`}>
              {c.icon} {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* Cotes gagnant */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-black text-stone-900 text-base">🏆 Cotes Gagnant — {cat?.label}</h2>
          <button onClick={() => setView("classements")} className="text-xs text-yellow-600 font-bold hover:underline">Tous →</button>
        </div>
        {catPilots.length === 0 ? (
          <div className="bg-stone-50 border-2 border-stone-100 rounded-xl p-6 text-center text-stone-400 text-sm">Aucun pilote dans cette catégorie</div>
        ) : (
          <div className="space-y-2">
            {sorted.map((p,i) => {
              const mise = paris.filter(x => x.piloteId===p.id && x.typePari==="gagnant" && !x.programme && !x.clos).reduce((s,x)=>s+x.mise,0);
              return (
                <div key={p.id} onClick={() => { setSelectedPilot(p); setView("pilote"); }}
                  className="flex items-center gap-3 bg-white border-2 border-stone-100 hover:border-yellow-400 rounded-xl px-4 py-3 cursor-pointer transition-all">
                  <span className={`w-6 h-6 rounded-full text-xs font-black flex items-center justify-center flex-shrink-0 ${i===0?"bg-yellow-400 text-black":"bg-stone-100 text-stone-500"}`}>{i+1}</span>
                  <Avatar initials={p.photo} size="sm" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5"><NF nat={p.nationalite} /><span className="font-bold text-stone-900 text-sm">{p.prenom} {p.nom}</span></div>
                    {mise > 0 && <span className="text-xs text-yellow-600">{mise} 🍺 misées</span>}
                  </div>
                  <CoteTag value={cotes[p.id]??1.5} highlight={i===0} />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Paris récents */}
      {paris.filter(p=>!p.clos).length > 0 && (
        <div>
          <h2 className="font-black text-stone-900 text-base mb-3">🍺 Paris récents</h2>
          <div className="space-y-2">
            {[...paris].filter(p=>!p.clos).reverse().slice(0,5).map((p,i) => {
              const tl = TYPES_PARI.find(t=>t.id===p.typePari)?.label ?? p.typePari;
              const cl = CATEGORIES.find(c=>c.id===p.categorieId);
              return (
                <div key={i} className="flex items-center gap-3 bg-stone-50 border border-stone-200 rounded-xl px-4 py-2.5">
                  <div className="flex-1 min-w-0 text-sm">
                    <span className="font-bold text-stone-800">{p.parieur}</span>
                    <span className="text-stone-400 mx-1.5">·</span>
                    <span className="text-stone-600">{p.piloteNom}</span>
                    <span className="text-stone-400 text-xs ml-1">({cl?.icon} {tl})</span>
                  </div>
                  <span className="text-yellow-600 font-black text-sm">{p.mise} 🍺</span>
                  <Pill v="black">{p.cote}x</Pill>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── FICHE PILOTE ─────────────────────────────────────────────────────────────

function FichePilote({ pilot, setView }) {
  const [histTab, setHistTab] = useState(null);
  return (
    <div className="space-y-5">
      <button onClick={() => setView("pilotes")} className="text-stone-500 hover:text-stone-900 text-sm font-medium flex items-center gap-1 transition-colors">← Retour</button>
      <div className="bg-black rounded-2xl p-5 flex items-start gap-4">
        <div className="w-16 h-16 rounded-2xl bg-yellow-400 text-black font-black text-xl flex items-center justify-center flex-shrink-0">{pilot.photo}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5"><NF nat={pilot.nationalite} /><span className="text-stone-400 text-xs">{pilot.nationalite}</span></div>
          <h2 className="text-2xl font-black text-white" style={{fontFamily:"'Bebas Neue',sans-serif",letterSpacing:"0.05em"}}>{pilot.prenom} {pilot.nom.toUpperCase()}</h2>
          <p className="text-yellow-400 text-sm font-medium">{pilot.avion}</p>
        </div>
      </div>
      <p className="text-stone-600 text-sm leading-relaxed px-1">{pilot.bio}</p>
      <div className="grid grid-cols-2 gap-2">
        {[
          ["🌍", "Nationalité",    pilot.nationalite],
          ["🏟️", "Club",           pilot.club ?? "—"],
          ["✈️", "Machine",        pilot.avion],
          ["🎯", "Régularité",     pilot.regularite ? `${pilot.regularite}%` : "—"],
          ["📊", "Moyenne",        pilot.score_moyen ? `${pilot.score_moyen}/100` : "—"],
          ["🔢", "Participations", pilot.participations ?? pilot.experience ?? "—"],
        ].map(([icon, label, val]) => (
          <div key={label} className="bg-white border-2 border-stone-100 rounded-xl p-3 flex items-center gap-2">
            <span className="text-lg flex-shrink-0">{icon}</span>
            <div className="min-w-0">
              <div className="font-black text-stone-900 text-sm truncate">{val}</div>
              <div className="text-stone-400 text-xs">{label}</div>
            </div>
          </div>
        ))}
      </div>
      <button onClick={() => setView("pari")} className="w-full py-4 bg-black hover:bg-stone-900 text-yellow-400 font-black rounded-xl transition-all text-sm uppercase tracking-wider">
        Parier sur {pilot.prenom} {pilot.nom} 🍺
      </button>
    </div>
  );
}

// ─── PAGE CLASSEMENTS ─────────────────────────────────────────────────────────

function PageClassements({ pilots, paris }) {
  const [catId, setCatId] = useState("unlimited");
  const [scope, setScope] = useState("general");
  const [type, setType] = useState("gagnant");
  const programme = scope === "general" ? null : scope;
  const catPilots = pilots.filter(p => p.categorieId === catId);
  const cotes = calculerCotes(catPilots, paris, programme, type, catId);
  const sorted = [...catPilots].sort((a,b) => (cotes[a.id]??99)-(cotes[b.id]??99));
  const cat = CATEGORIES.find(c => c.id === catId);

  return (
    <div className="space-y-5">
      <h2 className="font-black text-stone-900 text-2xl" style={{fontFamily:"'Bebas Neue',sans-serif",letterSpacing:"0.05em"}}>CLASSEMENTS & COTES</h2>
      <div>
        <p className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-2">Catégorie</p>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {CATEGORIES.map(c => (
            <button key={c.id} onClick={() => setCatId(c.id)}
              className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border-2 transition-all ${catId===c.id?"bg-black text-yellow-400 border-black":"bg-white border-stone-200 text-stone-600 hover:border-stone-400"}`}>
              {c.icon} {c.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-2">Programme</p>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {["general",...PROGRAMMES].map(s => (
            <button key={s} onClick={() => setScope(s)}
              className={`flex-shrink-0 px-3 py-2 rounded-lg text-xs font-bold border-2 transition-all ${scope===s?"bg-black text-yellow-400 border-black":"bg-white text-stone-600 border-stone-200 hover:border-stone-400"}`}>
              {s==="general"?"🏆 Général":s.replace("Programme ","")}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-2">Type de pari</p>
        <div className="grid grid-cols-2 gap-2">
          {TYPES_PARI.filter(t=>t.scope!=="note").map(t => (
            <button key={t.id} onClick={() => setType(t.id)}
              className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-bold border-2 transition-all ${type===t.id?"bg-yellow-400 border-yellow-400 text-black":"bg-white border-stone-200 text-stone-600 hover:border-yellow-400"}`}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2 py-2 border-t-2 border-stone-100">
        <span className="text-xl">{cat?.icon}</span>
        <span className="font-black text-stone-700 text-sm">{cat?.label}</span>
        <span className="text-stone-400 text-xs">— {catPilots.length} pilotes</span>
      </div>
      {catPilots.length===0 ? (
        <div className="bg-stone-50 border-2 border-stone-100 rounded-xl p-6 text-center text-stone-400">Aucun pilote dans cette catégorie</div>
      ) : (
        <div className="space-y-2">
          {sorted.map((p,i) => {
            const score = scope==="general" ? p.score_moyen : (p.scores[scope]??0);
            const mise = paris.filter(x => x.piloteId===p.id && x.typePari===type && x.programme===(scope==="general"?undefined:scope) && !x.clos).reduce((s,x)=>s+x.mise,0);
            const cv = cotes[p.id]??1.5;
            return (
              <div key={p.id} className={`flex items-center gap-3 rounded-xl px-4 py-3 border-2 transition-all ${i===0?"bg-yellow-400 border-yellow-400":"bg-white border-stone-100 hover:border-stone-300"}`}>
                <div className={`w-7 h-7 rounded-full flex items-center justify-center font-black text-xs flex-shrink-0 ${i===0?"bg-black text-yellow-400":i===1?"bg-stone-700 text-white":i===2?"bg-stone-400 text-white":"bg-stone-100 text-stone-500"}`}>{i+1}</div>
                <Avatar initials={p.photo} size="sm" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5"><NF nat={p.nationalite} /><span className={`font-bold text-sm ${i===0?"text-black":"text-stone-900"}`}>{p.prenom} {p.nom}</span></div>
                  <div className="flex gap-2 items-center">
                    <span className={`text-xs ${i===0?"text-black/60":"text-stone-400"}`}>{score}/100</span>
                    {mise>0 && <span className={`text-xs font-bold ${i===0?"text-black":"text-yellow-600"}`}>{mise} 🍺</span>}
                  </div>
                </div>
                <CoteTag value={cv} highlight={i===0} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── PAGE CAROUSEL ────────────────────────────────────────────────────────────

function CarouselSlide({ categorieId, pilots, paris }) {
  const cat       = CATEGORIES.find(c => c.id === categorieId);
  const catPilots = pilots.filter(p => p.categorieId === categorieId);
  const totalBieres = paris.filter(p => p.categorieId === categorieId && !p.clos).reduce((s,p) => s+p.mise, 0);
  const cotesGen  = calculerCotes(catPilots, paris, null, "gagnant", categorieId);
  const sorted    = [...catPilots].sort((a,b) => (cotesGen[a.id]??99)-(cotesGen[b.id]??99));

  if (!catPilots.length) return (
    <div className="h-full flex flex-col items-center justify-center text-stone-400 space-y-3">
      <span className="text-5xl">{cat?.icon}</span>
      <p className="font-bold text-stone-500">{cat?.label}</p>
      <p className="text-sm">Aucun pilote inscrit</p>
    </div>
  );

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-2xl">{cat?.icon}</span>
          <div>
            <h3 className="font-black text-stone-900 text-lg leading-none" style={{fontFamily:"'Bebas Neue',sans-serif",letterSpacing:"0.06em"}}>{cat?.label.toUpperCase()}</h3>
            <p className="text-stone-400 text-xs">{cat?.desc}</p>
          </div>
        </div>
        {totalBieres > 0 && <div className="bg-yellow-400 text-black px-2 py-1 rounded-lg text-xs font-black">{totalBieres} 🍺</div>}
      </div>

      {/* Liste pilotes */}
      <div className="flex-1 overflow-auto space-y-2">
        {sorted.map((pilot, i) => {
          const cote    = cotesGen[pilot.id] ?? 1.5;
          const nbParis = paris.filter(p => p.piloteId === pilot.id && p.categorieId === categorieId && !p.clos).length;
          return (
            <div key={pilot.id} className={`flex items-center gap-3 rounded-xl px-4 py-3 ${i === 0 ? "bg-yellow-400" : "bg-white border border-stone-200"}`}>
              <span className={`w-7 h-7 rounded-full text-xs font-black flex items-center justify-center flex-shrink-0 ${i === 0 ? "bg-black text-yellow-400" : "bg-stone-100 text-stone-500"}`}>{i + 1}</span>
              <div className="w-7 h-7 rounded-lg bg-black text-yellow-400 font-black text-xs flex items-center justify-center flex-shrink-0">{pilot.photo}</div>
              <span className={`font-bold text-sm flex-1 ${i === 0 ? "text-black" : "text-stone-900"}`}>{pilot.prenom} {pilot.nom}</span>
              {nbParis > 0 && <span className={`text-xs font-medium ${i === 0 ? "text-black/60" : "text-stone-400"}`}>{nbParis} paris</span>}
              <CoteTag value={cote} highlight={i === 0} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PageCarousel({ pilots, paris }) {
  const [current, setCurrent] = useState(0);
  const [autoPlay, setAutoPlay] = useState(true);
  const total = CATEGORIES.length;
  const next  = useCallback(() => setCurrent(c => (c+1)%total), [total]);
  const prev  = () => setCurrent(c => (c-1+total)%total);

  useEffect(() => {
    if (!autoPlay) return;
    const id = setInterval(next, 6000);
    return () => clearInterval(id);
  }, [autoPlay, next]);

  const cat = CATEGORIES[current];

  return (
    <div className="flex flex-col" style={{height:"calc(100vh - 130px)"}}>
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <h2 className="font-black text-stone-900 text-xl" style={{fontFamily:"'Bebas Neue',sans-serif",letterSpacing:"0.06em"}}>📺 PARIS EN DIRECT</h2>
        <button onClick={() => setAutoPlay(a => !a)}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border-2 ${autoPlay ? "bg-green-100 text-green-700 border-green-200" : "bg-stone-100 text-stone-500 border-stone-200"}`}>
          {autoPlay ? "⏸ Auto" : "▶ Manuel"}
        </button>
      </div>

      <div className="flex items-center gap-2 mb-4 flex-shrink-0 overflow-x-auto pb-1">
        {CATEGORIES.map((c,i) => (
          <button key={c.id} onClick={() => { setCurrent(i); setAutoPlay(false); }}
            className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all ${i === current ? "bg-black text-yellow-400" : "bg-stone-100 text-stone-500 hover:bg-stone-200"}`}>
            {c.icon} {c.label}
          </button>
        ))}
      </div>

      {autoPlay && (
        <div className="h-1 bg-stone-100 rounded-full mb-4 flex-shrink-0 overflow-hidden">
          <div key={current} className="h-full bg-yellow-400 rounded-full" style={{animation:"progbar 6s linear forwards"}} />
        </div>
      )}

      <div className="flex-1 bg-white border-2 border-stone-100 rounded-2xl p-4 overflow-hidden relative">
        <CarouselSlide key={cat.id} categorieId={cat.id} pilots={pilots} paris={paris} />
        <button onClick={() => { prev(); setAutoPlay(false); }} className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-white border-2 border-stone-200 rounded-full flex items-center justify-center text-stone-600 hover:border-yellow-400 transition-all shadow-sm z-20">‹</button>
        <button onClick={() => { next(); setAutoPlay(false); }} className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-white border-2 border-stone-200 rounded-full flex items-center justify-center text-stone-600 hover:border-yellow-400 transition-all shadow-sm z-20">›</button>
      </div>

      <div className="flex justify-center mt-3 flex-shrink-0">
        <span className="text-stone-400 text-xs font-medium">{current+1} / {total} — {cat.label}</span>
      </div>
      <style>{`@keyframes progbar{from{width:0%}to{width:100%}}`}</style>
    </div>
  );
}

// ─── PAGE PARIS ───────────────────────────────────────────────────────────────

function PageParis({ pilots, paris, addPari, setView, parisOuverts }) {
  const [step, setStep] = useState(1);
  const [prenom, setPrenom] = useState(""); const [nom, setNom] = useState(""); const [email, setEmail] = useState(""); const [emailErr, setEmailErr] = useState("");
  const [catId, setCatId] = useState(null); const [typePari, setTypePari] = useState(null); const [scope, setScope] = useState("general");
  const [pilote, setPilote] = useState(null); const [fourchette, setFourchette] = useState(null); const [mise, setMise] = useState("");
  const [confirmed, setConfirmed] = useState(false); const [emailEnvoi, setEmailEnvoi] = useState(null);

  const programme = scope==="general" ? null : scope;
  const catPilots = catId ? pilots.filter(p => p.categorieId===catId) : [];
  const cotes = typePari && typePari!=="note" && catId ? calculerCotes(catPilots, paris, programme, typePari, catId) : {};
  const coteNote = pilote && fourchette ? calculerCoteNote(paris, pilote.id, fourchette.id, programme) : null;
  const coteFinale = typePari==="note" ? coteNote : (pilote ? cotes[pilote.id] : null);
  const labelPari = () => {
    if (!typePari) return "";
    const prog = scope==="general"?"Général":scope.replace("Programme ","");
    const tl = TYPES_PARI.find(t=>t.id===typePari)?.label ?? "";
    if (typePari==="note" && fourchette) return `Note ${fourchette.label} — ${prog}`;
    return `${tl} — ${prog}`;
  };

  const handleConfirm = async () => {
    if (!pilote || !mise || !typePari || coteFinale===null || !catId) return;
    const pari = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
      parieur: `${prenom} ${nom}`, email, piloteId: pilote.id, piloteNom: `${pilote.prenom} ${pilote.nom}`,
      categorieId: catId, typePari, programme: programme??undefined,
      fourchetteId: fourchette?.id, fourchetteLabel: fourchette?.label,
      mise: parseInt(mise), cote: coteFinale, gain: Math.round(parseInt(mise)*coteFinale),
      date: new Date().toLocaleTimeString("fr-FR"), clos: false,
    };
    addPari(pari); setConfirmed(true); setEmailEnvoi("sending");
    const res = await genererEmail(pari);
    setEmailEnvoi(res);
  };

  const validateEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

  if (!parisOuverts) return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4 text-center">
      <div className="w-20 h-20 bg-stone-100 border-2 border-stone-200 rounded-2xl flex items-center justify-center text-4xl">🔒</div>
      <h2 className="text-2xl font-black text-stone-900">Paris clôturés</h2>
      <p className="text-stone-500 max-w-xs">L'administrateur a clôturé les paris.</p>
      <button onClick={() => setView("accueil")} className="px-6 py-3 bg-black text-yellow-400 font-bold rounded-xl text-sm uppercase hover:bg-stone-900 transition-all">Retour à l'accueil</button>
    </div>
  );

  if (confirmed && coteFinale!==null && pilote) return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-5 text-center">
      <div className="w-20 h-20 bg-yellow-400 rounded-2xl flex items-center justify-center text-4xl">🍺</div>
      <h2 className="text-2xl font-black text-stone-900">Pari enregistré !</h2>
      <div className="bg-white border-2 border-stone-100 rounded-2xl p-5 w-full max-w-sm space-y-2 text-left">
        {[["Parieur",`${prenom} ${nom}`],["Email",email],["Catégorie",CATEGORIES.find(c=>c.id===catId)?.label??""],["Pilote",`${pilote.prenom} ${pilote.nom}`],["Pari",labelPari()],["Mise",`${mise} 🍺`]].map(([l,v]) => (
          <div key={l} className="flex justify-between text-sm"><span className="text-stone-400 font-medium">{l}</span><span className="text-stone-900 font-bold text-right max-w-[60%]">{v}</span></div>
        ))}
        <div className="flex justify-between items-center border-t-2 border-stone-100 pt-3 mt-1">
          <span className="text-stone-700 font-bold">Gain potentiel</span>
          <span className="text-2xl font-black text-yellow-600">{Math.round(parseInt(mise)*coteFinale)} 🍺</span>
        </div>
      </div>
      {emailEnvoi==="sending" && <div className="flex items-center gap-2 text-stone-500 text-sm"><div className="w-4 h-4 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />Génération email…</div>}
      {emailEnvoi?.ok && (
        <div className="bg-green-50 border-2 border-green-200 rounded-xl p-4 w-full max-w-sm text-left text-sm space-y-2">
          <div className="font-bold text-green-800">✉️ Email généré</div>
          <div className="text-stone-600 text-xs">Objet : {emailEnvoi.objet}</div>
        </div>
      )}
      {emailEnvoi==="error" && <p className="text-red-500 text-sm">⚠️ Email non envoyé, pari enregistré.</p>}
      <button onClick={() => setView("accueil")} className="px-8 py-3 bg-black text-yellow-400 font-bold rounded-xl text-sm uppercase hover:bg-stone-900 transition-all">Retour à l'accueil</button>
    </div>
  );

  const stepLabels = ["Identité","Catégorie","Type","Contexte","Pilote","Mise"];

  return (
    <div className="space-y-5">
      <button onClick={() => setView("accueil")} className="text-stone-500 hover:text-stone-900 text-sm font-medium flex items-center gap-1 transition-colors">← Retour</button>
      <h2 className="font-black text-stone-900 text-2xl" style={{fontFamily:"'Bebas Neue',sans-serif",letterSpacing:"0.05em"}}>PLACER UN PARI 🍺</h2>
      <div className="flex items-center">
        {stepLabels.map((_,i) => (
          <div key={i} className="flex items-center flex-1 last:flex-none">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-black flex-shrink-0 transition-all ${step===i+1?"bg-yellow-400 text-black":step>i+1?"bg-black text-yellow-400":"bg-stone-200 text-stone-400"}`}>{step>i+1?"✓":i+1}</div>
            {i<stepLabels.length-1 && <div className={`flex-1 h-0.5 rounded-full transition-all mx-1 ${step>i+1?"bg-black":"bg-stone-200"}`} />}
          </div>
        ))}
      </div>

      {step===1 && (
        <div className="space-y-4">
          <h3 className="font-black text-stone-900">Votre identité</h3>
          <InputF label="Prénom" value={prenom} onChange={e=>setPrenom(e.target.value)} placeholder="Votre prénom" />
          <InputF label="Nom" value={nom} onChange={e=>setNom(e.target.value)} placeholder="Votre nom" />
          <div>
            <label className="text-xs font-bold text-stone-500 uppercase tracking-wider block mb-1">Email (confirmation)</label>
            <input type="email" value={email} onChange={e=>{setEmail(e.target.value);setEmailErr("");}} onBlur={() => {if(email&&!validateEmail(email))setEmailErr("Email invalide");}} placeholder="votre@email.com"
              className={`w-full bg-white border-2 text-stone-900 rounded-xl px-4 py-3 focus:outline-none transition-colors text-sm ${emailErr?"border-red-400":"border-stone-200 focus:border-yellow-400"}`} />
            {emailErr && <p className="text-red-500 text-xs mt-1">{emailErr}</p>}
          </div>
          <button disabled={!prenom||!nom||!email||!validateEmail(email)} onClick={() => setStep(2)} className="w-full py-3 bg-black disabled:bg-stone-200 disabled:text-stone-400 text-yellow-400 font-bold rounded-xl text-sm uppercase tracking-wider transition-all">Continuer →</button>
        </div>
      )}

      {step===2 && (
        <div className="space-y-4">
          <h3 className="font-black text-stone-900">Choisissez une catégorie</h3>
          <div className="space-y-2">
            {CATEGORIES.map(cat => {
              const count = pilots.filter(p=>p.categorieId===cat.id).length;
              return (
                <button key={cat.id} onClick={() => {setCatId(cat.id);setStep(3);}} className="w-full flex items-center gap-4 bg-white border-2 border-stone-100 hover:border-yellow-400 rounded-xl p-4 text-left transition-all group">
                  <span className="text-3xl">{cat.icon}</span>
                  <div className="flex-1"><div className="font-black text-stone-900 group-hover:text-yellow-600 transition-colors">{cat.label}</div><div className="text-stone-500 text-sm mt-0.5">{cat.desc}</div></div>
                  <Pill v="gray">{count} pilote{count>1?"s":""}</Pill>
                </button>
              );
            })}
          </div>
          <button onClick={() => setStep(1)} className="text-stone-500 hover:text-stone-900 text-sm font-medium transition-colors">← Retour</button>
        </div>
      )}

      {step===3 && (
        <div className="space-y-4">
          <h3 className="font-black text-stone-900">Général ou programme ?</h3>
          <div className="space-y-2">
            {["general",...PROGRAMMES].map(s => (
              <button key={s} onClick={() => {setScope(s);setStep(4);}} className="w-full flex items-center gap-3 bg-white border-2 border-stone-100 hover:border-yellow-400 rounded-xl px-4 py-3 text-left transition-all group">
                <span className="text-lg">{s==="general"?"🏆":"✈️"}</span>
                <span className="font-bold text-stone-900 group-hover:text-yellow-600 transition-colors flex-1">{s==="general"?"Classement Général":s}</span>
                <span className="text-stone-400">→</span>
              </button>
            ))}
          </div>
          <button onClick={() => setStep(3)} className="text-stone-500 hover:text-stone-900 text-sm font-medium transition-colors">← Retour</button>
        </div>
      )}

      {step===4 && (
        <div className="space-y-4">
          <h3 className="font-black text-stone-900">Type de pari</h3>
          <div className="space-y-2">
            {TYPES_PARI.map(t => (
              <button key={t.id} onClick={() => {setTypePari(t.id);setStep(5);}} className="w-full flex items-start gap-4 bg-white border-2 border-stone-100 hover:border-yellow-400 rounded-xl p-4 text-left transition-all group">
                <span className="text-3xl">{t.icon}</span>
                <div><div className="font-black text-stone-900 group-hover:text-yellow-600 transition-colors">{t.label}</div><div className="text-stone-500 text-sm mt-0.5">{t.desc}</div></div>
              </button>
            ))}
          </div>
          <button onClick={() => setStep(2)} className="text-stone-500 hover:text-stone-900 text-sm font-medium transition-colors">← Retour</button>
        </div>
      )}

      {step===5 && (
        <div className="space-y-4">
          <h3 className="font-black text-stone-900">Choisissez un pilote</h3>
          {catPilots.length===0 && <div className="bg-stone-50 border-2 border-stone-200 rounded-xl p-6 text-center text-stone-400 text-sm">Aucun pilote dans cette catégorie.</div>}
          <div className="space-y-2">
            {[...catPilots].sort((a,b) => (cotes[a.id]??2)-(cotes[b.id]??2)).map(p => {
              const c = typePari!=="note" ? cotes[p.id] : null;
              const sel = pilote?.id===p.id;
              return (
                <button key={p.id} onClick={() => {setPilote(p);if(typePari!=="note")setStep(6);}}
                  className={`w-full flex items-center gap-3 bg-white rounded-xl px-4 py-3 text-left transition-all border-2 ${sel?"border-yellow-400 bg-yellow-50":"border-stone-100 hover:border-yellow-400"}`}>
                  <Avatar initials={p.photo} size="sm" />
                  <div className="flex-1 min-w-0"><div className="flex items-center gap-1.5"><NF nat={p.nationalite} /><span className="font-bold text-stone-900 text-sm">{p.prenom} {p.nom}</span></div><span className="text-stone-400 text-xs">{p.avion}</span></div>
                  {c!==null && <div className="font-black text-stone-800 text-base">{c}x</div>}
                  {typePari==="note" && sel && <span className="text-yellow-500 font-bold text-lg">✓</span>}
                </button>
              );
            })}
          </div>
          {typePari==="note" && pilote && (
            <div className="space-y-3">
              <h3 className="font-black text-stone-900 text-sm uppercase tracking-wider">Fourchette de note</h3>
              <div className="grid grid-cols-2 gap-2">
                {FOURCHETTES.map(f => {
                  const c = calculerCoteNote(paris, pilote.id, f.id, programme);
                  const sel = fourchette?.id===f.id;
                  return (
                    <button key={f.id} onClick={() => {setFourchette(f);setStep(6);}}
                      className={`flex flex-col items-center justify-center gap-1 rounded-xl py-4 border-2 transition-all font-bold ${sel?"bg-yellow-400 border-yellow-400 text-black":"bg-white border-stone-100 hover:border-yellow-400 text-stone-800"}`}>
                      <span className="text-lg">{f.label}</span><span className="text-sm">{c}x</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <button onClick={() => setStep(4)} className="text-stone-500 hover:text-stone-900 text-sm font-medium transition-colors">← Retour</button>
        </div>
      )}

      {step===6 && pilote && coteFinale!==null && (
        <div className="space-y-4">
          <h3 className="font-black text-stone-900">Votre mise en 🍺</h3>
          <div className="bg-stone-50 border-2 border-stone-100 rounded-xl p-4 flex items-center gap-3">
            <Avatar initials={pilote.photo} size="sm" />
            <div className="flex-1 min-w-0"><div className="font-bold text-stone-900 text-sm">{pilote.prenom} {pilote.nom}</div><div className="text-stone-500 text-xs">{labelPari()}</div></div>
            <div className="font-black text-stone-900 text-xl">{coteFinale}x</div>
          </div>
          <div>
            <label className="text-xs font-bold text-stone-500 uppercase tracking-wider block mb-2">Nombre de 🍺</label>
            <div className="flex items-center gap-2">
              <button onClick={() => setMise(m => String(Math.max(0,parseInt(m||"0")-1)))} className="w-12 h-12 bg-stone-100 hover:bg-stone-200 rounded-xl font-black text-stone-800 text-xl transition-all flex-shrink-0">−</button>
              <input type="number" min="1" value={mise} onChange={e => setMise(e.target.value)} className="flex-1 bg-white border-2 border-stone-200 focus:border-yellow-400 text-stone-900 rounded-xl px-4 py-3 text-xl font-black text-center focus:outline-none" />
              <button onClick={() => setMise(m => String(parseInt(m||"0")+1))} className="w-12 h-12 bg-stone-100 hover:bg-stone-200 rounded-xl font-black text-stone-800 text-xl transition-all flex-shrink-0">+</button>
            </div>
            <div className="flex gap-2 mt-2">
              {[1,2,5,10].map(n => <button key={n} onClick={() => setMise(String(n))} className="flex-1 py-2 bg-stone-100 hover:bg-yellow-400 hover:text-black border-2 border-stone-100 hover:border-yellow-400 text-stone-600 rounded-lg text-sm font-bold transition-all">{n}🍺</button>)}
            </div>
          </div>
          {mise && parseInt(mise)>0 && (
            <div className="bg-yellow-50 border-2 border-yellow-200 rounded-xl p-4 space-y-2">
              <div className="flex justify-between text-sm"><span className="text-stone-600">Mise</span><span className="font-bold text-stone-900">{mise} 🍺</span></div>
              <div className="flex justify-between text-sm"><span className="text-stone-600">Cote</span><span className="font-bold text-stone-900">{coteFinale}x</span></div>
              <div className="flex justify-between items-center border-t-2 border-yellow-200 pt-2">
                <span className="font-black text-stone-900">Gain potentiel</span>
                <span className="font-black text-yellow-600 text-2xl">{Math.round(parseInt(mise)*coteFinale)} 🍺</span>
              </div>
            </div>
          )}
          <div className="flex gap-3">
            <button onClick={() => setStep(5)} className="px-4 py-3 bg-stone-100 hover:bg-stone-200 text-stone-700 font-bold rounded-xl text-sm transition-all">← Retour</button>
            <button disabled={!mise||parseInt(mise)<=0} onClick={handleConfirm} className="flex-1 py-3 bg-black disabled:bg-stone-200 disabled:text-stone-400 text-yellow-400 font-bold rounded-xl text-sm uppercase tracking-wider transition-all">Confirmer 🍺</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── PAGE ADMIN ───────────────────────────────────────────────────────────────

const emptyHistEntry = (annee) => ({ annee:String(annee), competition:"", classement:"", avion:"", scores:Object.fromEntries(PROGRAMMES.map(p=>[p,""])) });
const emptyForm = () => ({ nom:"", prenom:"", nationalite:"", age:"", experience:"", victoires:"", podiums:"", anneeDebut:"", avion:"", score_moyen:"", regularite:"", bio:"", categorieId:"unlimited", scores:Object.fromEntries(PROGRAMMES.map(p=>[p,""])), historique:Array.from({length:5},(_,i)=>emptyHistEntry(2020+i)) });

function PageAdmin({ pilots, setPilots, paris, setParis, parisOuverts, setParisOuverts, resultats, setResultats }) {
  const [mode, setMode] = useState("dashboard");
  const [editingPilot, setEditingPilot] = useState(null);
  const [adminPass, setAdminPass] = useState("");
  const [auth, setAuth] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [histOpen, setHistOpen] = useState(false);
  const [filterCat, setFilterCat] = useState("all");
  const [filterClos, setFilterClos] = useState("all");
  const [recherche, setRecherche] = useState("");
  // Saisie résultats
  const [resCat, setResCat] = useState(CATEGORIES[0].id);
  const [resProg, setResProg] = useState(PROGRAMMES[0]); // programme en cours de saisie
  const [validationLog, setValidationLog] = useState([]);
  const [validating, setValidating] = useState(false);
  const [nbGagnants, setNbGagnants] = useState(3);

  if (!auth) return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-5">
      <div className="w-16 h-16 bg-black rounded-2xl flex items-center justify-center text-3xl">🔐</div>
      <h2 className="text-2xl font-black text-stone-900">Administration</h2>
      <div className="w-full max-w-sm space-y-3">
        <InputF type="password" value={adminPass} onChange={e=>setAdminPass(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&adminPass==="admin123")setAuth(true);}} placeholder="Mot de passe admin" />
        <button onClick={() => {if(adminPass==="admin123")setAuth(true);else alert("Mot de passe incorrect");}} className="w-full py-3 bg-black text-yellow-400 font-bold rounded-xl text-sm uppercase transition-all hover:bg-stone-900">Connexion</button>
      </div>
    </div>
  );

  const upH = (i,f,v) => setForm(x => { const h=[...x.historique]; h[i]={...h[i],[f]:v}; return {...x,historique:h}; });
  const upHS = (i,prog,v) => setForm(x => { const h=[...x.historique]; h[i]={...h[i],scores:{...h[i].scores,[prog]:v}}; return {...x,historique:h}; });

  const handleSave = () => {
    if (!form.nom||!form.prenom) return;
    const cleanHist = form.historique.filter(h=>h.competition.trim()).map(h => ({
      annee:parseInt(h.annee)||2024, competition:h.competition, classement:parseInt(h.classement)||0, avion:h.avion,
      scores:Object.fromEntries(PROGRAMMES.map(p=>[p,parseFloat(h.scores[p])||0]))
    }));
    const pilot = {
      id: editingPilot ? editingPilot.id : Date.now(),
      nom:form.nom, prenom:form.prenom, nationalite:form.nationalite,
      age:parseInt(form.age)||30, experience:parseInt(form.experience)||5,
      victoires:parseInt(form.victoires)||0, podiums:parseInt(form.podiums)||0,
      anneeDebut:parseInt(form.anneeDebut)||2020, avion:form.avion||"Extra 300",
      score_moyen:parseFloat(form.score_moyen)||80, regularite:parseInt(form.regularite)||80,
      photo:((form.prenom[0]??"X")+(form.nom[0]??"X")).toUpperCase(),
      palmares:editingPilot?.palmares??[], bio:form.bio||"Pilote professionnel de voltige aérienne.",
      categorieId:form.categorieId,
      scores:Object.fromEntries(PROGRAMMES.map(p=>[p,parseFloat(form.scores[p])||parseFloat(form.score_moyen)||80])),
      historique:cleanHist,
    };
    setPilots(prev => editingPilot ? prev.map(p => p.id===editingPilot.id?pilot:p) : [...prev,pilot]);
    setMode("dashboard"); setEditingPilot(null); setForm(emptyForm());
  };

  const handleEdit = p => {
    setEditingPilot(p);
    setForm({ nom:p.nom, prenom:p.prenom, nationalite:p.nationalite, age:String(p.age), experience:String(p.experience), victoires:String(p.victoires), podiums:String(p.podiums), anneeDebut:String(p.anneeDebut), avion:p.avion, score_moyen:String(p.score_moyen), regularite:String(p.regularite), bio:p.bio, categorieId:p.categorieId, scores:Object.fromEntries(PROGRAMMES.map(prog=>[prog,String(p.scores[prog])])),
      historique: p.historique?.length>0 ? p.historique.map(h=>({annee:String(h.annee),competition:h.competition,classement:String(h.classement),avion:h.avion,scores:Object.fromEntries(PROGRAMMES.map(prog=>[prog,String(h.scores[prog]??"")]))})) : emptyForm().historique });
    setMode("addPilot");
  };

  if (mode==="addPilot") return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={() => {setMode("dashboard");setEditingPilot(null);setForm(emptyForm());}} className="text-stone-500 hover:text-stone-900 text-sm font-medium transition-colors">← Retour</button>
        <h2 className="text-xl font-black text-stone-900">{editingPilot?"Modifier":"Ajouter"} un pilote</h2>
      </div>
      <Card>
        <p className="text-xs font-bold text-stone-700 uppercase tracking-wider mb-3">Informations générales</p>
        <div className="space-y-3">
          {[["prenom","Prénom","text"],["nom","Nom","text"],["nationalite","Nationalité","text"],["avion","Avion","text"],["age","Âge","number"],["experience","Expérience (ans)","number"],["victoires","Victoires","number"],["podiums","Podiums","number"],["anneeDebut","Année début","number"],["score_moyen","Score moyen (/100)","number"],["regularite","Régularité (%)","number"]].map(([k,l,t]) => (
            <InputF key={k} label={l} type={t} value={form[k]} onChange={e=>setForm(x=>({...x,[k]:e.target.value}))} />
          ))}
          <div>
            <label className="text-xs font-bold text-stone-500 uppercase tracking-wider block mb-1">Catégorie</label>
            <div className="grid grid-cols-2 gap-2">
              {CATEGORIES.map(cat => (
                <button key={cat.id} onClick={() => setForm(x=>({...x,categorieId:cat.id}))}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl border-2 text-sm font-bold transition-all ${form.categorieId===cat.id?"bg-yellow-400 border-yellow-400 text-black":"bg-white border-stone-200 text-stone-600 hover:border-yellow-400"}`}>
                  {cat.icon} {cat.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs font-bold text-stone-500 uppercase tracking-wider block mb-1">Biographie</label>
            <textarea value={form.bio} onChange={e=>setForm(x=>({...x,bio:e.target.value}))} rows={3} className="w-full bg-white border-2 border-stone-200 focus:border-yellow-400 text-stone-900 rounded-xl px-4 py-3 focus:outline-none text-sm resize-none" />
          </div>
        </div>
      </Card>
      <Card>
        <p className="text-xs font-bold text-stone-700 uppercase tracking-wider mb-3">Scores actuels par programme</p>
        <div className="space-y-3">
          {PROGRAMMES.map(prog => <InputF key={prog} label={prog.replace("Programme ","")} type="number" value={form.scores[prog]} onChange={e=>setForm(x=>({...x,scores:{...x.scores,[prog]:e.target.value}}))} placeholder="ex: 88.5" />)}
        </div>
      </Card>
      <Card>
        <button onClick={() => setHistOpen(!histOpen)} className="w-full flex items-center justify-between font-black text-stone-900 text-xs uppercase tracking-wider">
          <span>📚 Historique (5 compétitions)</span><span className="text-stone-400">{histOpen?"▲":"▼"}</span>
        </button>
        <p className="text-stone-400 text-xs mt-1 mb-3">Résultats des 5 dernières compétitions</p>
        {histOpen && (
          <div className="space-y-4">
            {form.historique.map((h,i) => (
              <div key={i} className="border-2 border-stone-100 rounded-xl overflow-hidden">
                <div className="bg-stone-50 px-4 py-2 flex items-center gap-3">
                  <span className="text-yellow-500 font-black text-sm w-5">#{i+1}</span>
                  <input type="number" value={h.annee} onChange={e=>upH(i,"annee",e.target.value)} placeholder="Année" className="w-20 bg-transparent border-b-2 border-stone-300 text-stone-700 text-sm focus:outline-none focus:border-yellow-400 text-center" />
                </div>
                <div className="p-4 space-y-3">
                  <InputF label="Compétition" value={h.competition} onChange={e=>upH(i,"competition",e.target.value)} placeholder="FAI World Championship" />
                  <div className="grid grid-cols-2 gap-3">
                    <InputF label="Classement" type="number" value={h.classement} onChange={e=>upH(i,"classement",e.target.value)} placeholder="1" />
                    <InputF label="Avion" value={h.avion} onChange={e=>upH(i,"avion",e.target.value)} placeholder="Extra 330SC" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-stone-500 uppercase tracking-wider mb-2">Scores</p>
                    <div className="grid grid-cols-2 gap-2">
                      {PROGRAMMES.map(prog => <InputF key={prog} label={prog.replace("Programme ","")} type="number" value={h.scores?.[prog]??""} onChange={e=>upHS(i,prog,e.target.value)} placeholder="0" />)}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
      <button onClick={handleSave} disabled={!form.nom||!form.prenom} className="w-full py-3 bg-black disabled:bg-stone-200 disabled:text-stone-400 text-yellow-400 font-bold rounded-xl text-sm uppercase transition-all hover:bg-stone-900">
        {editingPilot?"Sauvegarder ✓":"Ajouter le pilote ✓"}
      </button>
    </div>
  );

  if (mode==="gestionParis") {
    const pf = paris.filter(p => {
      if (filterCat!=="all" && p.categorieId!==filterCat) return false;
      if (filterClos==="ouvert" && p.clos) return false;
      if (filterClos==="clos" && !p.clos) return false;
      if (recherche.trim()) {
        const q = recherche.trim().toLowerCase();
        if (!p.parieur.toLowerCase().includes(q) && !p.email.toLowerCase().includes(q) && !p.piloteNom.toLowerCase().includes(q)) return false;
      }
      return true;
    });
    return (
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <button onClick={() => { setMode("dashboard"); setRecherche(""); }} className="text-stone-500 hover:text-stone-900 text-sm font-medium transition-colors">← Retour</button>
          <h2 className="font-black text-stone-900 text-lg">Gestion des paris</h2>
          <Pill v="black">{paris.length}</Pill>
        </div>
        <div className={`flex items-center justify-between p-4 rounded-2xl border-2 ${parisOuverts?"bg-green-50 border-green-200":"bg-red-50 border-red-200"}`}>
          <div>
            <div className={`font-black text-base ${parisOuverts?"text-green-800":"text-red-800"}`}>{parisOuverts?"🟢 Paris ouverts":"🔴 Paris clôturés"}</div>
            <div className="text-xs text-stone-500 mt-0.5">{parisOuverts?"Les utilisateurs peuvent parier":"Aucun nouveau pari possible"}</div>
          </div>
          <button onClick={() => setParisOuverts(v=>!v)} className={`px-4 py-2 rounded-xl font-bold text-sm transition-all ${parisOuverts?"bg-red-500 hover:bg-red-600 text-white":"bg-green-500 hover:bg-green-600 text-white"}`}>
            {parisOuverts?"🔒 Clôturer":"🔓 Rouvrir"}
          </button>
        </div>

        {/* Barre de recherche */}
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-sm">🔍</span>
          <input
            type="text" value={recherche} onChange={e => setRecherche(e.target.value)}
            placeholder="Rechercher par nom, email ou pilote…"
            className="w-full bg-white border-2 border-stone-200 focus:border-yellow-400 text-stone-900 rounded-xl pl-9 pr-9 py-3 text-sm focus:outline-none transition-colors"
          />
          {recherche && (
            <button onClick={() => setRecherche("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700 font-bold text-lg leading-none">×</button>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {["all",...CATEGORIES.map(c=>c.id)].map(cat => (
              <button key={cat} onClick={() => setFilterCat(cat)}
                className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold border-2 transition-all ${filterCat===cat?"bg-black text-yellow-400 border-black":"bg-white border-stone-200 text-stone-500 hover:border-stone-400"}`}>
                {cat==="all"?"Toutes":`${CATEGORIES.find(c=>c.id===cat)?.icon} ${CATEGORIES.find(c=>c.id===cat)?.label}`}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            {[["all","Tous"],["ouvert","🟢 Ouverts"],["clos","🔴 Clôturés"]].map(([f,l]) => (
              <button key={f} onClick={() => setFilterClos(f)} className={`px-3 py-1.5 rounded-lg text-xs font-bold border-2 transition-all ${filterClos===f?"bg-black text-yellow-400 border-black":"bg-white border-stone-200 text-stone-500"}`}>{l}</button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          {[[pf.length,"Paris"],[`${pf.reduce((s,p)=>s+p.mise,0)} 🍺`,"Misées"],[pf.filter(p=>p.clos).length,"Clôturés"]].map(([v,l]) => (
            <div key={l} className="bg-stone-50 border border-stone-200 rounded-xl py-2">
              <div className="font-black text-stone-900">{v}</div><div className="text-xs text-stone-400">{l}</div>
            </div>
          ))}
        </div>
        {pf.length===0 ? <div className="text-center text-stone-400 py-8">Aucun pari correspondant</div> : (
          <div className="space-y-2">
            {[...pf].reverse().map(p => {
              const cat = CATEGORIES.find(c=>c.id===p.categorieId);
              const tl = TYPES_PARI.find(t=>t.id===p.typePari)?.label??p.typePari;
              return (
                <div key={p.id} className={`bg-white border-2 rounded-xl px-4 py-3 ${p.clos?"border-stone-200 opacity-60":"border-stone-100"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-stone-900 text-sm">{p.parieur}</span>
                        {cat && <span className="text-xs">{cat.icon}</span>}
                        {p.clos && <Pill v="red">Clôturé</Pill>}
                      </div>
                      <div className="text-stone-400 text-xs mt-0.5">{p.email}</div>
                      <div className="text-stone-500 text-xs mt-0.5">{p.piloteNom} · {tl}{p.programme?` · ${p.programme.replace("Programme ","")}` : " · Général"}{p.fourchetteLabel?` · ${p.fourchetteLabel}`:""}</div>
                      <div className="text-stone-400 text-xs">{p.cote}x · {p.date}</div>
                    </div>
                    <div className="flex flex-col items-end gap-2 flex-shrink-0">
                      <span className="font-black text-yellow-600 text-sm">{p.mise} 🍺</span>
                      <div className="flex gap-1">
                        <button onClick={() => setParis(prev=>prev.map(x=>x.id===p.id?{...x,clos:!x.clos}:x))}
                          className={`px-2 py-1 rounded-lg text-xs font-bold transition-all ${p.clos?"bg-green-100 text-green-700 hover:bg-green-200":"bg-orange-100 text-orange-700 hover:bg-orange-200"}`} title={p.clos?"Rouvrir":"Clôturer"}>
                          {p.clos?"🔓":"🔒"}
                        </button>
                        <button onClick={() => setParis(prev=>prev.filter(x=>x.id!==p.id))} className="px-2 py-1 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg text-xs font-bold transition-all" title="Supprimer">🗑️</button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ── MODE SAISIE RÉSULTATS ─────────────────────────────────────────────────
  if (mode === "saisieResultats") {
    const catPilots = pilots.filter(p => p.categorieId === resCat);
    const progsCat = PROGRAMMES; // tous les programmes
    const isLastProg = resProg === progsCat[progsCat.length - 1];

    // Lecture / écriture d'une note
    const getNote = (piloteId, prog) =>
      (resultats[resCat] && resultats[resCat][piloteId] && resultats[resCat][piloteId][prog] !== undefined)
        ? resultats[resCat][piloteId][prog]
        : "";

    const setNote = (piloteId, prog, val) => {
      const num = val === "" ? undefined : parseFloat(val);
      setResultats(prev => ({
        ...prev,
        [resCat]: {
          ...(prev[resCat] ?? {}),
          [piloteId]: { ...(prev[resCat]?.[piloteId] ?? {}), [prog]: num }
        }
      }));
    };

    // Classement pour un programme donné
    const classementProg = (prog) =>
      [...catPilots]
        .map(p => ({ pilot: p, note: resultats[resCat]?.[p.id]?.[prog] }))
        .filter(x => x.note !== undefined && !isNaN(x.note))
        .sort((a, b) => b.note - a.note);

    // Classement général (moyenne de tous les programmes)
    const classementGeneral = [...catPilots]
      .map(p => {
        const notes = progsCat.map(pr => resultats[resCat]?.[p.id]?.[pr]).filter(n => n !== undefined && !isNaN(n));
        const moy = notes.length === progsCat.length ? notes.reduce((s, n) => s + n, 0) / notes.length : null;
        return { pilot: p, moyenne: moy };
      })
      .filter(x => x.moyenne !== null)
      .sort((a, b) => b.moyenne - a.moyenne);

    const clProg = classementProg(resProg);

    // ── TIRAGE AU SORT ────────────────────────────────────────────────────────
    // Pondération par cote : pari à 8x = 80 tickets, pari à 3.5x = 35 tickets
    const tirageAuSort = (parisGagnants, nb) => {
      if (!parisGagnants.length) return [];
      if (parisGagnants.length <= nb) return parisGagnants.map(p => p.id);
      const pool = [];
      parisGagnants.forEach(p => {
        const tickets = Math.max(1, Math.round((p.cote || 1.5) * 10));
        for (let i = 0; i < tickets; i++) pool.push(p.id);
      });
      const gagnantsIds = new Set();
      const shuffled = [...pool].sort(() => Math.random() - 0.5);
      for (const id of shuffled) {
        gagnantsIds.add(id);
        if (gagnantsIds.size >= nb) break;
      }
      return [...gagnantsIds];
    };

    // Évalue un pari (gagné ou non) selon un classement donné
    const evaluerPari = (pari, clPr, isGeneral) => {
      const total = clPr.length;
      const rang  = clPr.findIndex(x => x.pilot.id === pari.piloteId);
      if (pari.typePari === "gagnant")  return rang === 0;
      if (pari.typePari === "top3")     return rang >= 0 && rang < 3;
      if (pari.typePari === "bottom3")  return rang >= 0 && rang >= total - 3;
      if (pari.typePari === "note") {
        const note = isGeneral
          ? clPr.find(x => x.pilot.id === pari.piloteId)?.moyenne
          : resultats[resCat]?.[pari.piloteId]?.[pari.programme];
        if (note === undefined) return false;
        const f = FOURCHETTES.find(f => f.id === pari.fourchetteId);
        return f ? note >= f.min && note < f.max : false;
      }
      return false;
    };

    // Valide + tire au sort parmi les gagnants d'un lot de paris
    const validerEtTirer = async (parisAValider, clPr, isGeneral) => {
      const evalues   = parisAValider.map(p => ({ ...p, gagne: evaluerPari(p, clPr, isGeneral) }));
      const gagnants  = evalues.filter(p => p.gagne);
      const perdants  = evalues.filter(p => !p.gagne);
      const tiresIds  = tirageAuSort(gagnants, nbGagnants);
      const log = [];
      for (const pari of evalues) {
        const estTire     = tiresIds.includes(pari.id);
        const bonusBieres = estTire ? Math.round((pari.cote - 1) * pari.mise * 10) / 10 : 0;
        const statut      = !pari.gagne ? "perdu" : estTire ? "gagne_tire" : "gagne_non_tire";
        setParis(prev => prev.map(x => x.id === pari.id ? { ...x, clos: true, gagne: pari.gagne, estTire, bonusBieres, statut } : x));
        const emailRes = await envoyerEmailStatut(pari, statut, bonusBieres);
        log.push({ parieur: pari.parieur, pilote: pari.piloteNom, statut, bonusBieres, emailOk: emailRes.ok, general: isGeneral });
      }
      return log;
    };

    const handleValiderProg = async () => {
      if (clProg.length === 0) return;
      setValidating(true);
      setValidationLog([]);
      const parisAValider = paris.filter(p => p.categorieId === resCat && p.programme === resProg && !p.clos);
      const log = await validerEtTirer(parisAValider, clProg, false);
      let logGen = [];
      if (isLastProg) {
        const parisGen = paris.filter(p => p.categorieId === resCat && !p.programme && !p.clos);
        const clGen    = classementGeneral.map(x => ({ pilot: x.pilot, note: x.moyenne, moyenne: x.moyenne }));
        logGen = await validerEtTirer(parisGen, clGen, true);
      }
      setValidationLog([...log, ...logGen]);
      setValidating(false);
    };

    const parisProgOuverts = paris.filter(p => p.categorieId === resCat && p.programme === resProg && !p.clos);
    const parisGenOuverts  = paris.filter(p => p.categorieId === resCat && !p.programme && !p.clos);
    const progValide = (prog) => paris.some(p => p.categorieId === resCat && p.programme === prog && p.clos);

    return (
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <button onClick={() => { setMode("dashboard"); setValidationLog([]); }}
            className="text-stone-500 hover:text-stone-900 text-sm font-medium transition-colors">
            ← Retour
          </button>
          <h2 className="font-black text-stone-900 text-lg">📊 Résultats & validation</h2>
        </div>

        {/* Sélecteur catégorie */}
        <div>
          <p className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-2">Catégorie</p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {CATEGORIES.map(c => (
              <button key={c.id}
                onClick={() => { setResCat(c.id); setResProg(PROGRAMMES[0]); setValidationLog([]); }}
                className={"flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border-2 transition-all " + (resCat === c.id ? "bg-black text-yellow-400 border-black" : "bg-white border-stone-200 text-stone-600 hover:border-stone-400")}>
                {c.icon} {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* Saisie nombre de gagnants */}
        <div className="bg-yellow-50 border-2 border-yellow-200 rounded-2xl p-4">
          <p className="text-xs font-bold text-stone-600 uppercase tracking-wider mb-3">🎲 Gagnants à tirer au sort</p>
          <div className="flex items-center gap-3">
            <button onClick={() => setNbGagnants(n => Math.max(1, n - 1))}
              className="w-10 h-10 bg-black text-yellow-400 rounded-xl font-black text-xl flex-shrink-0 hover:bg-stone-900 transition-all">−</button>
            <div className="flex-1 text-center">
              <div className="text-3xl font-black text-stone-900">{nbGagnants}</div>
              <div className="text-xs text-stone-500 mt-0.5">gagnant{nbGagnants > 1 ? "s" : ""} tiré{nbGagnants > 1 ? "s" : ""} au sort</div>
            </div>
            <button onClick={() => setNbGagnants(n => n + 1)}
              className="w-10 h-10 bg-black text-yellow-400 rounded-xl font-black text-xl flex-shrink-0 hover:bg-stone-900 transition-all">+</button>
          </div>
          <p className="text-xs text-stone-400 mt-2 text-center">Cote élevée = plus de tickets dans le tirage</p>
        </div>

        {/* Sélecteur programme — avec indicateur de progression */}
        <div>
          <p className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-2">Programme</p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {progsCat.map((prog, idx) => {
              const estValide = progValide(prog);
              const estActif = resProg === prog;
              return (
                <button key={prog}
                  onClick={() => { setResProg(prog); setValidationLog([]); }}
                  className={"flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border-2 transition-all " +
                    (estActif ? "bg-black text-yellow-400 border-black" :
                     estValide ? "bg-green-100 text-green-700 border-green-300" :
                     "bg-white border-stone-200 text-stone-600 hover:border-stone-400")}>
                  {estValide ? "✅" : (idx + 1) + "."} {prog.replace("Programme ", "").trim()}
                </button>
              );
            })}
            <button
              onClick={() => { setResProg("general"); setValidationLog([]); }}
              className={"flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border-2 transition-all " +
                (resProg === "general" ? "bg-yellow-400 text-black border-yellow-400" :
                 classementGeneral.length === catPilots.length && catPilots.length > 0 ? "bg-yellow-50 text-yellow-700 border-yellow-300" :
                 "bg-stone-100 text-stone-400 border-stone-200")}>
              🏆 Général
            </button>
          </div>
        </div>

        {catPilots.length === 0 ? (
          <div className="bg-stone-50 border-2 border-stone-100 rounded-xl p-6 text-center text-stone-400 text-sm">
            Aucun pilote dans cette catégorie
          </div>
        ) : resProg === "general" ? (
          /* ── VUE GÉNÉRAL ── */
          <div className="space-y-4">
            {classementGeneral.length < catPilots.length && (
              <div className="bg-yellow-50 border-2 border-yellow-200 rounded-xl p-3 text-sm text-yellow-800">
                ⚠️ Saisissez d&apos;abord toutes les notes des {progsCat.length} programmes pour voir le classement général complet.
                ({classementGeneral.length} pilotes sur {catPilots.length} ont toutes leurs notes)
              </div>
            )}
            {classementGeneral.length > 0 && (
              <div className="bg-white border-2 border-stone-100 rounded-2xl overflow-hidden">
                <div className="bg-black px-4 py-2.5 flex items-center justify-between">
                  <p className="text-yellow-400 text-xs font-bold uppercase tracking-wider">Classement général — {CATEGORIES.find(c => c.id === resCat)?.label}</p>
                  <p className="text-stone-400 text-xs">Moyenne des {progsCat.length} programmes</p>
                </div>
                <div className="divide-y divide-stone-100">
                  {classementGeneral.map(({ pilot, moyenne }, i) => (
                    <div key={pilot.id} className={"flex items-center gap-3 px-4 py-3 " + (i === 0 ? "bg-yellow-50" : "")}>
                      <span className={"w-7 h-7 rounded-full text-xs font-black flex items-center justify-center flex-shrink-0 " + (i === 0 ? "bg-yellow-400 text-black" : i === 1 ? "bg-stone-700 text-white" : i === 2 ? "bg-stone-400 text-white" : "bg-stone-100 text-stone-500")}>
                        {i + 1}
                      </span>
                      <div className="w-7 h-7 rounded-lg bg-black text-yellow-400 font-black text-xs flex items-center justify-center flex-shrink-0">{pilot.photo}</div>
                      <span className="font-bold text-stone-900 text-sm flex-1">{pilot.prenom} {pilot.nom}</span>
                      <div className="text-right">
                        <div className="font-black text-stone-900">{moyenne.toFixed(1)} pts</div>
                        <div className="text-stone-400 text-xs">
                          {progsCat.map(pr => {
                            const n = resultats[resCat]?.[pilot.id]?.[pr];
                            return n !== undefined ? n.toFixed(1) : "—";
                          }).join(" · ")}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="bg-stone-50 border-2 border-stone-100 rounded-xl p-3">
              <p className="text-xs text-stone-500 font-medium">
                Paris généraux en attente : <span className="font-black text-stone-800">{parisGenOuverts.length}</span>
                {parisGenOuverts.length > 0 && " (gagnant, top 3, 3 derniers, note moyenne)"}
              </p>
            </div>
            <button
              onClick={async () => {
                if (classementGeneral.length === 0) return;
                setValidating(true); setValidationLog([]);
                const log = await validerParisGeneraux();
                setValidationLog(log); setValidating(false);
              }}
              disabled={validating || classementGeneral.length === 0 || parisGenOuverts.length === 0}
              className="w-full py-4 bg-yellow-400 disabled:bg-stone-200 disabled:text-stone-400 text-black font-black rounded-2xl text-sm uppercase tracking-wider transition-all hover:bg-yellow-300 flex items-center justify-center gap-2"
            >
              {validating
                ? <><div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />Validation en cours...</>
                : parisGenOuverts.length === 0
                  ? "Aucun pari général à valider"
                  : "🏆 Valider " + parisGenOuverts.length + " paris généraux"}
            </button>
          </div>
        ) : (
          /* ── VUE PROGRAMME ── */
          <div className="space-y-4">
            {/* Grille de saisie */}
            <div className="bg-white border-2 border-stone-100 rounded-2xl overflow-hidden">
              <div className="bg-black px-4 py-2.5 flex items-center justify-between">
                <p className="text-yellow-400 text-xs font-bold uppercase tracking-wider">{resProg} — {CATEGORIES.find(c => c.id === resCat)?.label}</p>
                <span className="text-stone-400 text-xs">note sur 100</span>
              </div>
              <div className="divide-y divide-stone-100">
                {catPilots.map((p, i) => {
                  const note = getNote(p.id, resProg);
                  const noteNum = note !== "" ? parseFloat(note) : null;
                  return (
                    <div key={p.id} className={"flex items-center gap-3 px-4 py-3 " + (i % 2 === 0 ? "bg-white" : "bg-stone-50")}>
                      <div className="w-8 h-8 rounded-lg bg-black text-yellow-400 font-black text-xs flex items-center justify-center flex-shrink-0">{p.photo}</div>
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-stone-900 text-sm">{p.prenom} {p.nom}</div>
                        <div className="text-stone-400 text-xs">{p.avion}</div>
                      </div>
                      <input
                        type="number" min="0" max="100" step="0.1"
                        value={note}
                        onChange={e => setNote(p.id, resProg, e.target.value)}
                        placeholder="—"
                        className="w-20 bg-stone-50 border-2 border-stone-200 focus:border-yellow-400 text-stone-900 rounded-lg px-2 py-2 text-center text-sm font-bold focus:outline-none transition-colors"
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Classement temps réel du programme */}
            {clProg.length > 0 && (
              <div className="bg-stone-50 border-2 border-stone-100 rounded-2xl p-4">
                <p className="text-xs font-bold text-stone-500 uppercase tracking-wider mb-3">Classement {resProg}</p>
                <div className="space-y-1.5">
                  {clProg.map(({ pilot, note }, i) => (
                    <div key={pilot.id} className={"flex items-center gap-3 rounded-xl px-3 py-2 " + (i === 0 ? "bg-yellow-400" : "bg-white border border-stone-200")}>
                      <span className={"w-6 h-6 rounded-full text-xs font-black flex items-center justify-center flex-shrink-0 " + (i === 0 ? "bg-black text-yellow-400" : i === 1 ? "bg-stone-700 text-white" : i === 2 ? "bg-stone-400 text-white" : "bg-stone-100 text-stone-500")}>
                        {i + 1}
                      </span>
                      <span className={"font-bold text-sm flex-1 " + (i === 0 ? "text-black" : "text-stone-900")}>{pilot.prenom} {pilot.nom}</span>
                      <span className={"font-black text-sm " + (i === 0 ? "text-black" : "text-stone-600")}>{note.toFixed(1)} pts</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Infos paris en attente */}
            <div className="bg-stone-50 border-2 border-stone-100 rounded-xl p-3 text-xs text-stone-500 space-y-1">
              <p>Paris de ce programme en attente : <span className="font-black text-stone-800">{parisProgOuverts.length}</span></p>
              {isLastProg && parisGenOuverts.length > 0 && (
                <p className="text-yellow-700 font-medium">+ {parisGenOuverts.length} paris généraux seront aussi validés après ce dernier programme.</p>
              )}
            </div>

            {/* Bouton valider */}
            <button
              onClick={handleValiderProg}
              disabled={validating || clProg.length === 0 || parisProgOuverts.length === 0}
              className={"w-full py-4 font-black rounded-2xl text-sm uppercase tracking-wider transition-all flex items-center justify-center gap-2 " +
                (isLastProg ? "bg-yellow-400 hover:bg-yellow-300 text-black disabled:bg-stone-200 disabled:text-stone-400" : "bg-black hover:bg-stone-900 text-yellow-400 disabled:bg-stone-200 disabled:text-stone-400")}
            >
              {validating
                ? <><div className={"w-4 h-4 border-2 border-t-transparent rounded-full animate-spin " + (isLastProg ? "border-black" : "border-yellow-400")} />Validation et envoi en cours...</>
                : parisProgOuverts.length === 0
                  ? "Aucun pari à valider pour ce programme"
                  : isLastProg
                    ? "🏁 Valider " + parisProgOuverts.length + " paris + " + parisGenOuverts.length + " généraux"
                    : "✅ Valider " + parisProgOuverts.length + " paris — " + resProg}
            </button>
            {clProg.length === 0 && (
              <p className="text-center text-stone-400 text-xs">Saisissez au moins une note pour activer la validation.</p>
            )}
          </div>
        )}

        {/* Log résultats */}
        {validationLog.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-stone-500 uppercase tracking-wider">Résultats du tirage</p>
              <button onClick={() => setValidationLog([])} className="text-xs text-stone-400 hover:text-stone-700">Effacer</button>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              {[
                ["🏆", validationLog.filter(e => e.statut === "gagne_tire").length,     "Tirés au sort",    "bg-yellow-50 border-yellow-200"],
                ["🍺", validationLog.filter(e => e.statut === "gagne_non_tire").length,  "Bons pronostics",  "bg-green-50 border-green-200"],
                ["😔", validationLog.filter(e => e.statut === "perdu").length,           "Perdants",         "bg-stone-50 border-stone-200"],
              ].map(([icon, count, label, cls]) => (
                <div key={label} className={"border-2 rounded-xl py-2 " + cls}>
                  <div className="text-lg">{icon}</div>
                  <div className="font-black text-stone-900">{count}</div>
                  <div className="text-stone-500">{label}</div>
                </div>
              ))}
            </div>
            {validationLog.map((entry, i) => (
              <div key={i} className={"rounded-xl px-4 py-3 border-2 " +
                (entry.statut === "gagne_tire"     ? "bg-yellow-50 border-yellow-300" :
                 entry.statut === "gagne_non_tire" ? "bg-green-50 border-green-200"   :
                                                     "bg-stone-50 border-stone-200")}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-stone-900 text-sm">{entry.parieur}</span>
                    {entry.general && <span className="text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded-md font-bold">Général</span>}
                    <span className={"text-xs font-black px-2 py-0.5 rounded-full " +
                      (entry.statut === "gagne_tire"     ? "bg-yellow-400 text-black" :
                       entry.statut === "gagne_non_tire" ? "bg-green-500 text-white"  :
                                                           "bg-stone-400 text-white")}>
                      {entry.statut === "gagne_tire"     ? "🏆 TIRÉ AU SORT" :
                       entry.statut === "gagne_non_tire" ? "🍺 BON PRONOSTIC" :
                                                           "😔 PERDU"}
                    </span>
                  </div>
                  {entry.statut === "gagne_tire" && (
                    <span className="text-yellow-600 font-black text-sm">+{entry.bonusBieres} 🍺</span>
                  )}
                </div>
                <div className="text-stone-500 text-xs mt-0.5">{entry.pilote}</div>
                <div className={"text-xs mt-1 " + (entry.emailOk ? "text-green-600" : "text-red-400")}>
                  {entry.emailOk ? "✉️ Email envoyé" : "⚠️ Email non envoyé"}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="font-black text-stone-900 text-2xl" style={{fontFamily:"'Bebas Neue',sans-serif",letterSpacing:"0.05em"}}>ADMIN</h2>
        <div className="flex items-center gap-2">
          <Pill v="black">Admin</Pill>
          <button onClick={() => setAuth(false)} className="text-stone-400 hover:text-stone-700 text-xs font-medium transition-colors">Déco.</button>
          <button onClick={async () => {
            if (window.confirm("Réinitialiser les paris et résultats ?\n\n(Les pilotes sont conservés dans la base de données)")) {
              await fetch("/api/data", { method: "DELETE" }).catch(()=>{});
              window.location.reload();
            }
          }} className="text-red-400 hover:text-red-600 text-xs font-medium transition-colors">🗑 Reset</button>
        </div>
      </div>
      <div className={`flex items-center justify-between p-4 rounded-2xl border-2 ${parisOuverts?"bg-green-50 border-green-200":"bg-red-50 border-red-200"}`}>
        <div>
          <div className={`font-black ${parisOuverts?"text-green-800":"text-red-800"}`}>{parisOuverts?"🟢 Paris ouverts":"🔴 Paris clôturés"}</div>
          <div className="text-xs text-stone-500 mt-0.5">{paris.length} paris · {paris.reduce((s,p)=>s+p.mise,0)} 🍺</div>
        </div>
        <button onClick={() => setParisOuverts(v=>!v)} className={`px-4 py-2 rounded-xl font-bold text-sm transition-all ${parisOuverts?"bg-red-500 hover:bg-red-600 text-white":"bg-green-500 hover:bg-green-600 text-white"}`}>
          {parisOuverts?"🔒 Clôturer":"🔓 Rouvrir"}
        </button>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[[pilots.length,"Pilotes","👨‍✈️"],[paris.length,"Paris","🎲"],[`${paris.reduce((s,p)=>s+p.mise,0)}🍺`,"Misées","🍺"]].map(([v,l,i]) => (
          <div key={l} className="bg-black rounded-2xl p-4 text-center">
            <div className="text-2xl">{i}</div><div className="text-yellow-400 font-black text-lg">{v}</div><div className="text-stone-400 text-xs">{l}</div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => setMode("gestionParis")} className="flex items-center gap-3 bg-white border-2 border-stone-100 hover:border-yellow-400 rounded-xl p-4 text-left transition-all group">
          <span className="text-2xl">🎲</span>
          <div><div className="font-black text-stone-900 text-sm group-hover:text-yellow-600">Gérer les paris</div><div className="text-stone-400 text-xs">Voir, clôturer, supprimer</div></div>
        </button>
        <button onClick={() => {setEditingPilot(null);setForm(emptyForm());setMode("addPilot");}} className="flex items-center gap-3 bg-white border-2 border-stone-100 hover:border-yellow-400 rounded-xl p-4 text-left transition-all group">
          <span className="text-2xl">✈️</span>
          <div><div className="font-black text-stone-900 text-sm group-hover:text-yellow-600">Ajouter un pilote</div><div className="text-stone-400 text-xs">Créer un nouveau profil</div></div>
        </button>
        <button onClick={() => setMode("saisieResultats")} className="col-span-2 flex items-center gap-3 bg-black hover:bg-stone-900 rounded-xl p-4 text-left transition-all">
          <span className="text-2xl">📊</span>
          <div>
            <div className="font-black text-yellow-400 text-sm">Saisir les résultats et valider les paris</div>
            <div className="text-stone-400 text-xs">Programme par programme → Général en dernier</div>
          </div>
          <span className="ml-auto text-yellow-400 text-lg">→</span>
        </button>
      </div>
      <Card>
        <p className="text-xs font-bold text-stone-700 uppercase tracking-wider mb-3">Pilotes par catégorie</p>
        <div className="space-y-2">
          {CATEGORIES.map(cat => {
            const count = pilots.filter(p=>p.categorieId===cat.id).length;
            const mises = paris.filter(p=>p.categorieId===cat.id).reduce((s,p)=>s+p.mise,0);
            return (
              <div key={cat.id} className="flex items-center gap-3">
                <span className="text-xl w-7 flex-shrink-0">{cat.icon}</span>
                <div className="flex-1">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-stone-800 text-sm">{cat.label}</span>
                    <div className="flex gap-2"><Pill v="gray">{count} pilotes</Pill>{mises>0&&<Pill v="yellow">{mises} 🍺</Pill>}</div>
                  </div>
                  <div className="h-1.5 bg-stone-100 rounded-full mt-1 overflow-hidden">
                    <div className="h-full bg-yellow-400 rounded-full" style={{width:`${Math.min(100,count*20)}%`}} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-black text-stone-900">Pilotes ({pilots.length})</h3>
          <button onClick={() => {setEditingPilot(null);setForm(emptyForm());setMode("addPilot");}} className="px-3 py-2 bg-yellow-400 hover:bg-yellow-300 text-black font-bold rounded-xl text-xs transition-all">+ Ajouter</button>
        </div>
        <div className="space-y-2">
          {pilots.map(p => {
            const cat = CATEGORIES.find(c=>c.id===p.categorieId);
            return (
              <div key={p.id} className="flex items-center gap-3 bg-white border-2 border-stone-100 rounded-xl px-4 py-3">
                <Avatar initials={p.photo} size="sm" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2"><span className="font-bold text-stone-900 text-sm">{p.prenom} {p.nom}</span>{cat&&<span className="text-xs">{cat.icon}</span>}</div>
                  <div className="text-stone-400 text-xs">{p.nationalite} · {p.avion}</div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => handleEdit(p)} className="w-8 h-8 bg-stone-100 hover:bg-blue-100 rounded-lg text-sm flex items-center justify-center transition-all">✏️</button>
                  <button onClick={() => setPilots(prev=>prev.filter(x=>x.id!==p.id))} className="w-8 h-8 bg-stone-100 hover:bg-red-100 rounded-lg text-sm flex items-center justify-center transition-all">🗑️</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── PAGE ADMIN — MODE SAISIE RÉSULTATS ───────────────────────────────────────
// Injecté dans PageAdmin via le mode "saisieResultats" — voir plus haut

// ─── APP ──────────────────────────────────────────────────────────────────────

const NAV = [
  { id:"accueil",    label:"Accueil",  icon:"🏠" },
  { id:"carousel",   label:"Live",     icon:"📺" },
  { id:"classements",label:"Cotes",    icon:"📊" },
  { id:"pilotes",    label:"Pilotes",  icon:"👨‍✈️" },
  { id:"pari",       label:"Parier",   icon:"🍺" },
  { id:"admin",      label:"Admin",    icon:"⚙️" },
];

export default function App() {
  const [view, setView] = useState("accueil");
  const [selectedPilot, setSelectedPilot] = useState(null);
  const [loaded, setLoaded] = useState(false);

  const [pilots,       setPilots]       = useState([]);
  const [paris,        setParis]        = useState([]);
  const [parisOuverts, setParisOuverts] = useState(true);
  const [resultats,    setResultats]    = useState({});

  const API = ""; // ← remplacez par votre domaine en prod

  // Chargement initial depuis le serveur
  useEffect(() => {
    fetch(API + "/api/data")
      .then(r => r.json())
      .then(data => {
        // Pilotes : toujours depuis le serveur (source de vérité = BDD externe)
        if (data.pilots && data.pilots.length > 0) setPilots(data.pilots);
        if (data.paris)     setParis(data.paris);
        if (data.resultats) setResultats(data.resultats);
        setParisOuverts(data.parisOuverts ?? true);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  // Sauvegarde automatique sur le serveur à chaque changement
  const save = (key, value) => {
    fetch(API + "/api/data/" + key, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value })
    }).catch(err => console.warn("Sauvegarde échouée :", key, err));
  };

  useEffect(() => { if (loaded) save("pilots",       pilots);       }, [pilots,       loaded]);
  useEffect(() => { if (loaded) save("paris",        paris);        }, [paris,        loaded]);
  useEffect(() => { if (loaded) save("parisOuverts", parisOuverts); }, [parisOuverts, loaded]);
  useEffect(() => { if (loaded) save("resultats",    resultats);    }, [resultats,    loaded]);

  const totalBieres = paris.filter(p=>!p.clos).reduce((s,p)=>s+p.mise,0);

  if (!loaded) return (
    <div className="min-h-screen bg-stone-50 flex items-center justify-center">
      <div className="text-center space-y-3">
        <div className="w-12 h-12 border-4 border-yellow-400 border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-stone-500 text-sm font-medium">Chargement des données…</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen text-stone-900 relative" style={{fontFamily:"'DM Sans',sans-serif"}}>
      <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />

      {/* Image de fond */}
      <div className="fixed inset-0 z-0" style={{
        backgroundImage: "url('/beech.jpg')",
        backgroundSize: "cover",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "center center",
        opacity: 0.20,
        filter: "blur(1px)",
      }} />

      {/* Contenu */}
      <div className="relative z-10 min-h-screen">

        {/* Header */}
        <div className="sticky top-0 z-50 bg-white border-b-2 border-stone-100">
          <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center text-yellow-400 text-sm font-black">✈</div>
              <span className="font-black text-stone-900 text-sm tracking-wider" style={{fontFamily:"'Bebas Neue',sans-serif",letterSpacing:"0.1em"}}>AEROFESTIVAL 2026</span>
              <span>🍺</span>
            </div>
            <div className="flex items-center gap-2">
              {!parisOuverts && <Pill v="red">🔒</Pill>}
              <div className={`w-1.5 h-1.5 rounded-full ${parisOuverts?"bg-green-500 animate-pulse":"bg-red-400"}`} />
              <span className={`text-xs font-bold ${parisOuverts?"text-green-600":"text-red-500"}`}>{parisOuverts?"LIVE":"CLÔ"}</span>
              {paris.length>0 && <Pill v="black">{totalBieres} 🍺</Pill>}
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="max-w-2xl bg-white mx-auto px-4 py-5 pb-28">
          {view==="accueil" && <PageAccueil pilots={pilots} paris={paris} setView={setView} setSelectedPilot={setSelectedPilot} />}
          {view==="carousel" && <PageCarousel pilots={pilots} paris={paris} />}
          {view==="classements" && <PageClassements pilots={pilots} paris={paris} />}
          {view==="pilotes" && (
            <div className="space-y-4">
              <h2 className="font-black text-stone-900 text-2xl" style={{fontFamily:"'Bebas Neue',sans-serif",letterSpacing:"0.05em"}}>LES PILOTES</h2>
              {CATEGORIES.map(cat => {
                const cp = pilots.filter(p=>p.categorieId===cat.id);
                if (!cp.length) return null;
                return (
                  <div key={cat.id}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-lg">{cat.icon}</span>
                      <h3 className="font-black text-stone-700 text-sm uppercase tracking-wider">{cat.label}</h3>
                      <Pill v="gray">{cp.length}</Pill>
                    </div>
                    <div className="space-y-2">
                      {cp.map(p => (
                        <div key={p.id} onClick={() => {setSelectedPilot(p);setView("pilote");}}
                          className="flex items-center gap-4 bg-white border-2 border-stone-100 hover:border-yellow-400 rounded-2xl p-4 cursor-pointer transition-all">
                          <Avatar initials={p.photo} size="md" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2"><NF nat={p.nationalite} /><span className="font-black text-stone-900">{p.prenom} {p.nom}</span></div>
                            <div className="text-stone-500 text-sm">{p.avion}</div>
                            <div className="flex gap-1.5 mt-1"><Pill v="yellow">{p.podiums} Podiums</Pill><Pill v="black">{p.score_moyen}/100</Pill></div>
                          </div>
                          <span className="text-stone-300 text-lg">›</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {view==="pilote" && selectedPilot && (
            <FichePilote pilot={pilots.find(p=>p.id===selectedPilot.id)??selectedPilot} setView={setView} />
          )}
          {view==="pari" && (
            <PageParis pilots={pilots} paris={paris} addPari={p=>setParis(prev=>[...prev,p])} setView={setView} parisOuverts={parisOuverts} />
          )}
          {view==="admin" && (
            <PageAdmin pilots={pilots} setPilots={setPilots} paris={paris} setParis={setParis} parisOuverts={parisOuverts} setParisOuverts={setParisOuverts} resultats={resultats} setResultats={setResultats} />
          )}
        </div>

        {/* Bottom Nav */}
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t-2 border-stone-100">
          <div className="max-w-2xl mx-auto px-1 py-2 flex justify-around">
            {NAV.map(item => {
              const active = view===item.id || (view==="pilote" && item.id==="pilotes");
              return (
                <button key={item.id} onClick={() => setView(item.id)}
                  className={`flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-xl transition-all ${active?"bg-yellow-400 text-black":"text-stone-400 hover:text-stone-700"}`}>
                  <span className="text-base">{item.icon}</span>
                  <span className="text-xs font-bold">{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>

      </div>
    </div>
  );
}