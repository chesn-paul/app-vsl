import express from "express";
import cors from "cors";
import { Resend } from "resend";
import Database from "better-sqlite3";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app      = express();
const resend   = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = "Aerofestival 2026 Paris <arbitre@pari-aerofestival.com>";

// ─── BASE DE DONNÉES ──────────────────────────────────────────────────────────
const db = new Database("voltige.db");
db.exec(`CREATE TABLE IF NOT EXISTS store (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);

const dbGet = (key, fallback) => {
  const row = db.prepare("SELECT value FROM store WHERE key = ?").get(key);
  return row ? JSON.parse(row.value) : fallback;
};
const dbSet = (key, value) => {
  db.prepare("INSERT OR REPLACE INTO store (key, value) VALUES (?, ?)").run(key, JSON.stringify(value));
};

// ─── IMPORT PILOTES ───────────────────────────────────────────────────────────
const CAT_MAP = {
  elite:"unlimited", excellence:"advanced",
  national1:"intermediate", national2:"primary",
  promotion:"junior", espoir:"feminine",
};

function importPilots() {
  const jsonPath = join(__dirname, "bdd_pilote.json");
  if (!existsSync(jsonPath)) { console.log("  ⚠️  bdd_pilote.json introuvable"); return; }
  let raw = readFileSync(jsonPath, "utf8");
  raw = raw.replace(/""/g, '"').replace(/"\s*\n\s*"/g, "");
  const data   = JSON.parse(raw);
  const pilots = data.map(p => ({
    id: p.id, nom: p.nom ?? "", prenom: p.prenom ?? "",
    civilite: p.civilite === "Mme" ? "Mme" : "M.",
    nationalite: p.nationalite ?? "France",
    participations: p.experience ?? 1, victoires: 0, podiums: p.podiums ?? 0,
    avion: p.avion ?? "", club: p.club ?? "",
    score_moyen: p.score_moyen ?? 70, regularite: p.regularite ?? 75,
    photo: ((p.prenom||"X")[0]+(p.nom||"X")[0]).toUpperCase(),
    categorieId: CAT_MAP[p.categorieId] ?? "junior",
    palmares: p.palmares ?? [], bio: p.bio ?? "",
    scores: {}, historique: [],
  }));
  dbSet("pilots", pilots);
  console.log(`  ✅ ${pilots.length} pilotes importés`);
}

const dbPilots = dbGet("pilots", []);
const jsonPath = join(__dirname, "bdd_pilote.json");
if (existsSync(jsonPath)) {
  let raw = readFileSync(jsonPath, "utf8");
  raw = raw.replace(/""/g, '"').replace(/"\s*\n\s*"/g, "");
  const jsonPilots = JSON.parse(raw);
  if (dbPilots.length !== jsonPilots.length) {
    console.log(`\n📥 Mise à jour pilotes (${dbPilots.length} → ${jsonPilots.length})...`);
    importPilots();
  } else {
    console.log(`\n✅ ${dbPilots.length} pilotes en base`);
  }
} else if (!dbPilots.length) {
  importPilots();
}

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use((req, _res, next) => {
  console.log(`${new Date().toLocaleTimeString()} — ${req.method} ${req.path}`);
  next();
});

// ─── ROUTES API ───────────────────────────────────────────────────────────────
app.get("/api/data", (req, res) => {
  res.json({
    pilots:       dbGet("pilots",       null),
    paris:        dbGet("paris",        []),
    parisOuverts: dbGet("parisOuverts", true),
    resultats:    dbGet("resultats",    {}),
  });
});

app.post("/api/data/:key", (req, res) => {
  const { key } = req.params;
  const allowed = ["pilots", "paris", "parisOuverts", "resultats"];
  if (!allowed.includes(key)) return res.status(400).json({ ok: false, error: "Clé non autorisée" });
  dbSet(key, req.body.value);
  console.log(`  💾 Sauvegardé : ${key}`);
  res.json({ ok: true });
});

app.delete("/api/data", (req, res) => {
  db.prepare("DELETE FROM store WHERE key != 'pilots'").run();
  console.log("  🗑 Paris et résultats réinitialisés");
  res.json({ ok: true });
});

// ─── EMAILS ───────────────────────────────────────────────────────────────────
const baseStyle = `
  body{margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;}
  .w{max-width:600px;margin:40px auto;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e0e0e0;}
  .h{background:#000;padding:28px 36px;text-align:center;}
  .h h1{margin:0;color:#facc15;font-size:26px;letter-spacing:2px;text-transform:uppercase;}
  .h p{margin:4px 0 0;color:#999;font-size:12px;letter-spacing:1px;text-transform:uppercase;}
  .b{padding:32px 36px;}
  .b p{color:#333;font-size:15px;line-height:1.6;margin:0 0 10px;}
  .recap{background:#f9f9f9;border-left:4px solid #facc15;border-radius:4px;padding:16px 20px;margin:20px 0;}
  .recap table{width:100%;border-collapse:collapse;}
  .recap td{padding:5px 0;font-size:14px;color:#333;vertical-align:top;}
  .recap td:first-child{color:#888;width:140px;font-weight:bold;}
  .hl{background:#facc15;color:#000;text-align:center;border-radius:6px;padding:18px;margin:20px 0;}
  .hl .m{font-size:34px;font-weight:bold;}
  .hl .l{font-size:12px;color:#333;margin-top:4px;text-transform:uppercase;letter-spacing:1px;}
  .f{background:#000;padding:16px 36px;text-align:center;}
  .f p{margin:0;color:#666;font-size:12px;}
  .f span{color:#facc15;}
  .bw{display:inline-block;background:#facc15;color:#000;font-weight:bold;padding:3px 12px;border-radius:20px;font-size:13px;}
  .bl{display:inline-block;background:#333;color:#facc15;font-weight:bold;padding:3px 12px;border-radius:20px;font-size:13px;}
`;
const footer = () => `<div class="f"><p><span>VOLTIGE PARIS</span> — Application de paris de voltige aérienne</p><p style="margin-top:4px;">Les bières seront à régler lors de la soirée 🍺</p></div>`;
const rows   = (data) => `<div class="recap"><table>${data.map(([l,v])=>`<tr><td>${l}</td><td><strong>${v}</strong></td></tr>`).join("")}</table></div>`;

const htmlConfirmation = (pari, catLabel, desc) => `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${baseStyle}</style></head><body><div class="w"><div class="h"><h1>✈ Voltige Paris 🍺</h1><p>Confirmation de pari</p></div><div class="b"><p>Bonjour <strong>${pari.parieur}</strong>,</p><p>Votre pari a bien été enregistré. Bonne chance !</p>${rows([["Catégorie",catLabel],["Pari",desc],["Mise",pari.mise+" 🍺"],["Cote",pari.cote+"x"],["Gain potentiel",pari.gain+" 🍺"],["Heure",pari.date]])}<div class="hl"><div class="m">${pari.gain} 🍺</div><div class="l">Gain potentiel si vous gagnez</div></div></div>${footer()}</div></body></html>`;

const htmlGagne = (pari, gainFinal, catLabel, desc) => `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${baseStyle}</style></head><body><div class="w"><div class="h"><h1>✈ Voltige Paris 🍺</h1><p>Résultat de votre pari</p></div><div class="b"><p>Bonjour <strong>${pari.parieur}</strong>,</p><p>Excellent pronostic ! <span class="bw">🏆 TIRÉ AU SORT</span></p>${rows([["Catégorie",catLabel],["Pari",desc],["Mise",pari.mise+" 🍺"],["Cote",pari.cote+"x"],["Bières offertes","+"+gainFinal+" 🍺"]])}<div class="hl"><div class="m">🏆 +${gainFinal} 🍺</div><div class="l">Bières offertes à récupérer au bar</div></div><p>Présentez cet email pour récupérer vos bières gratuites.</p></div>${footer()}</div></body></html>`;

const htmlBonPronostic = (pari, catLabel, desc) => `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${baseStyle}</style></head><body><div class="w"><div class="h"><h1>✈ Voltige Paris 🍺</h1><p>Résultat de votre pari</p></div><div class="b"><p>Bonjour <strong>${pari.parieur}</strong>,</p><p>Vous aviez le bon pronostic ! <span class="bw">🍺 BON PRONOSTIC</span></p><p>Malheureusement vous n'avez pas été tiré au sort cette fois-ci.</p>${rows([["Catégorie",catLabel],["Pari",desc],["Mise",pari.mise+" 🍺"],["Cote",pari.cote+"x"]])}<p style="color:#555;font-size:14px;margin-top:16px;">Votre pronostic était correct, bravo ! Tentez votre chance au prochain programme. 🎲</p></div>${footer()}</div></body></html>`;

const htmlPerdu = (pari, catLabel, desc) => `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${baseStyle}</style></head><body><div class="w"><div class="h"><h1>✈ Voltige Paris 🍺</h1><p>Résultat de votre pari</p></div><div class="b"><p>Bonjour <strong>${pari.parieur}</strong>,</p><p>Cette fois-ci ça n'a pas joué. <span class="bl">😔 PERDU</span></p>${rows([["Catégorie",catLabel],["Pari",desc],["Mise",pari.mise+" 🍺"],["Cote",pari.cote+"x"]])}<p style="color:#888;font-size:13px;margin-top:20px;">Meilleure chance lors du prochain programme !</p></div>${footer()}</div></body></html>`;

async function sendEmail(to, subject, html) {
  console.log(`  ✉️  À : ${to} | ${subject}`);
  const { data, error } = await resend.emails.send({ from: FROM_EMAIL, to, subject, html });
  if (error) { console.error("  ❌ Resend :", JSON.stringify(error)); throw new Error(JSON.stringify(error)); }
  console.log("  ✅ ID :", data.id);
}

app.post("/api/email/confirmation", async (req, res) => {
  const { pari, catLabel, desc } = req.body;
  try { await sendEmail(pari.email, "Confirmation de votre pari ✈ " + desc, htmlConfirmation(pari, catLabel, desc)); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.post("/api/email/statut", async (req, res) => {
  const { pari, statut, bonusBieres, catLabel, desc } = req.body;
  try {
    let html, subject;
    if (statut === "gagne_tire") {
      html = htmlGagne(pari, bonusBieres, catLabel, desc);
      subject = "🏆 Tiré au sort — +" + bonusBieres + " bières offertes !";
    } else if (statut === "gagne_non_tire") {
      html = htmlBonPronostic(pari, catLabel, desc);
      subject = "🍺 Bon pronostic ! (non tiré au sort cette fois)";
    } else {
      html = htmlPerdu(pari, catLabel, desc);
      subject = "😔 Résultat de votre pari — " + desc;
    }
    await sendEmail(pari.email, subject, html);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.get("/test", async (req, res) => {
  try {
    const fakePari = { parieur:"Test", email:"votre@email.com", mise:2, cote:4.5, gain:4, date:"12:00:00" };
    await sendEmail(fakePari.email, "Test Voltige Paris", htmlConfirmation(fakePari, "Elite", "Gagnant : Oddon — Général"));
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ─── FRONT STATIQUE (en production) ──────────────────────────────────────────
// Cette section doit être EN DERNIER — après toutes les routes API
app.use(express.static(join(__dirname, "dist")));
app.get("/{*path}", (req, res) => {
  res.sendFile(join(__dirname, "dist", "index.html"));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n✅  Serveur démarré sur le port ${PORT}`);
  console.log(`💾  Base de données : voltige.db\n`);
});