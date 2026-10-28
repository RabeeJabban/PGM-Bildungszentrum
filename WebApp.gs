var AKTUELL_ = '';
let TZ_ = null;

// ================= Zugang =================

function doGet(e) {
  var eltern = (e && e.parameter && e.parameter.e) ? String(e.parameter.e).trim() : '';
  if (eltern) {
    var s = schuleFuerCode_(eltern);
    if (!s) return info('Kein Zugriff', 'Bitte den Link der Schule verwenden.');
    var tEltern = HtmlService.createTemplateFromFile('Eltern');
    tEltern.code = eltern;
    tEltern.schule = s.name;
    tEltern.kuerzel = s.kuerzel;
    return tEltern.evaluate()
            .setTitle('PGM Bildungszentrum')
            .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
            .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  var token = (e && e.parameter && e.parameter.t) ? String(e.parameter.t).trim() : '';

  // 1. MITARBEITER-AUFRUF MIT TOKEN (?t=...)
  if (token) {
    var m = findeToken(token);

    if (!m) {
      var gesperrt = leseTab('Mitarbeiter').some(function(x) {
        var xTok = String(x.Token || x.token || x.TOKEN || '').trim();
        return xTok === token;
      });
      return gesperrt
        ? info('Zugang gesperrt', 'Dein Zugang ist zurzeit deaktiviert. Bitte wende dich an die Leitung.')
        : info('Kein Zugriff', 'Bitte den persönlichen Link verwenden.');
    }

    var rolleRaw = rolle_(m);
    var t = HtmlService.createTemplateFromFile(rolleRaw === 'admin' ? 'Planer' : 'Betreuer');
    t.name = String(m.Name || m.Vorname || '');
    t.rolle = rolleRaw;
    t.token = token;
    return t.evaluate()
            .setTitle(rolleRaw === 'admin' ? 'PGM Planer' : 'Mein PGM')
            .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
            .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  // 2. ERSTAUFRUF OHNE TOKEN -> Index.html (Login)
  var tpl = HtmlService.createTemplateFromFile('Index');
  // Adresse der Web-App. Ohne sie landet die Weiterleitung nach dem Login
  // im Sandbox-Rahmen und der Nutzer sieht eine weisse Seite.
  tpl.appUrl = appUrl_();
  return tpl.evaluate()
          .setTitle('PGM Portal - Login')
          .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
          .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function info(titel, text) {
  var html = '<div style="font-family:-apple-system,sans-serif;padding:50px 24px;text-align:center;color:#4b5563">' +
             '<h3 style="margin:0 0 8px">' + titel + '</h3>' +
             '<p style="margin:0;font-size:14px">' + text + '</p>' +
             '</div>';
  return HtmlService.createHtmlOutput(html);
}

// Rolle aus der Tabelle, immer klein und ohne Leerzeichen. Sonst zaehlt
// "Admin" mit grossem A oder ein Leerzeichen am Ende als andere Rolle und
// die Rechte greifen nicht.
function rolle_(m) {
  return String((m && (m.Rolle || m.rolle)) || '').toLowerCase().trim();
}
function istAdmin_(m) { return rolle_(m) === 'admin'; }

function findeToken(token) {
  var t = String(token || '').trim();
  if (t.length < 4) return null;

  // 1. Sitzung aus der Anmeldung mit E-Mail und Einmal-Code
  var name = sitzungName_(t);
  if (name) {
    return leseTab('Mitarbeiter').find(function(x) {
      var xAktiv = String(x.Aktiv || x.aktiv || 'ja').trim().toLowerCase();
      return String(x.Name || '').trim() === name &&
             (xAktiv === 'ja' || xAktiv === 'true');
    }) || null;
  }

  // 2. Persoenlicher Token aus der Tabelle. Das ist der Entwicklerzugang.
  var treffer = leseTab('Mitarbeiter').find(function(x) {
    var xTok = String(x.Token || x.token || x.TOKEN || '').trim();
    var xAktiv = String(x.Aktiv || x.aktiv || 'ja').trim().toLowerCase();
    return xTok === t && (xAktiv === 'ja' || xAktiv === 'true');
  });

  return treffer || null;
}
function michSelbst() { return findeToken(AKTUELL_); }

// Chef oder Mitarbeiter mit "ja" in der Spalte Kinder
function darfKinder_() {
  const m = michSelbst();
  if (!m) throw new Error('Keine Berechtigung');
  if (istAdmin_(m)) return m;
  if (String(m.Kinder || '').trim().toLowerCase() === 'ja') return m;
  throw new Error('Keine Berechtigung, Kinder zu pflegen');
}

// Chef oder Mitarbeiter mit "ja" in der Spalte Mitarbeiter
function darfTeam_() {
  const m = michSelbst();
  if (!m) throw new Error('Keine Berechtigung');
  if (istAdmin_(m)) return m;
  if (String(m.Mitarbeiter || '').trim().toLowerCase() === 'ja') return m;
  throw new Error('Keine Berechtigung, das Team zu pflegen');
}

function nurAdmin() {
  const m = michSelbst();
  if (!m || !istAdmin_(m)) throw new Error('Keine Berechtigung');
  return m;
}

// ================= Hilfen =================

function tz_() {
  if (!TZ_) TZ_ = ss_().getSpreadsheetTimeZone();
  return TZ_;
}

// Uhrzeit aus dem Sheet als "HH:mm", auch wenn Sheets ein Datum daraus gemacht hat
function planZeit_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, tz_(), 'HH:mm');
  return String(v || '').trim();
}

// ================= Personen =================

function personenFuer(datum, tag) {
  const abwesend = leseTab('Abwesend')
    .filter(a => formatDatum(a.Datum) === datum)
    .map(a => String(a.Mitarbeiter).trim());

  const frei = leseTab('Verfuegbarkeit').filter(v => String(v.Tag).trim() === tag);
  const d = new Date(datum);

  return leseTab('Mitarbeiter')
    .filter(m => String(m.Aktiv).trim() === 'ja' && !istAdmin_(m))
    .map(m => {
      const da = abwesend.indexOf(String(m.Name).trim()) < 0;
      let verf = false, von = '', bis = '';

      if (rolle_(m) === 'praktikant') {
        const v = m.Von ? new Date(m.Von) : null;
        const b = m.Bis ? new Date(m.Bis) : null;
        verf = (!v || isNaN(v) || d >= v) && (!b || isNaN(b) || d <= b);
        von = '11:30'; bis = '15:45';
      } else {
        const v = frei.find(f => String(f.Mitarbeiter).trim() === String(m.Name).trim());
        if (v) { verf = true; von = planZeit_(v.Von); bis = planZeit_(v.Bis); }
      }

      const p = parseInt(String(m.P || '').trim(), 10);
      return { name: String(m.Name).trim(), rolle: String(m.Rolle),
               stufe: (p >= 1 && p <= 9) ? p : 99,
               verfuegbar: !!(verf && da), abwesend: !da,
               von: String(von), bis: String(bis) };
    });
}

function planZeilen(datum) {
  return leseTab('Plan')
    .filter(z => formatDatum(z.Datum) === datum)
    .map(z => ({
      schule: String(z.Schule || ''), zeit: planZeit_(z.Zeit),
      aufgabe: String(z.Aufgabe || ''), gruppe: String(z.Gruppe || ''),
      raum: String(z.Raum || ''), mitarbeiter: String(z.Mitarbeiter || ''),
      kinder: String(z.Kinder || ''), status: String(z.Status || ''),
      von: planZeit_(z.Von), bis: planZeit_(z.Bis)
    }));
}

function raeumeListe() {
  const raeume = [];
  leseTab('Raeume').forEach(r => {
    const ecken = String(r.Bezeichnungen).split(',').map(x => x.trim());
    const gesamt = Number(r.Plaetze) || 0;
    raeume.push({ name: String(r.Raum), kapazitaet: gesamt, teilVon: '' });
    if (ecken.length > 1) {
      const proEcke = Math.floor(gesamt / ecken.length);
      ecken.forEach(t => raeume.push({ name: t, kapazitaet: proEcke,
                                       teilVon: String(r.Raum) }));
    }
  });
  return raeume;
}

// ================= Tagesplan (Chef) =================

function ladeTag(token, datum, neuRechnen) {
  AKTUELL_ = token;
  const m = nurAdmin();

  const tag = wochentag(datum);
  const gespeichert = planZeilen(datum);
  const p = planStruktur_(datum, !!neuRechnen, gespeichert);
  const personen = personenFuer(datum, tag);

  return {
    tag: tag, datum: datum,
    eingefroren: p.eingefroren,
    abholung: p.abholung, gruppen: p.gruppen,
    personen: personen,
    raeume: raeumeListe(),
    feste: festeFuerTag(tag, personen),
    gespeichert: gespeichert,
    darfMeldung: true,
    darfNachricht: true,
    darfKinderschutz: true,
    meldungen: { eltern: meldungenTag_(datum).filter(x => !x.von && x.kind),
                 intern: meldungenVerlauf_() },
    meldungKarte: meldungKarte_(datum),
    ks: ksKurz_(m),
    anwesend: anwesendFuer_(datum),
    planGesehen: sahLesen_(datum),
    // wer ueberhaupt in der App angemeldet ist. Wer hier fehlt, kann den
    // Plan gar nicht sehen.
    angemeldet: Object.keys(angemeldetNamen_())
  };
}

// feste Einsätze dieses Wochentags, nur aktive und verfügbare Personen
function festeFuerTag(tag, personen) {
  const verf = {};
  personen.forEach(p => { if (p.verfuegbar) verf[p.name] = p; });

  return leseTab('Fest')
    .filter(f => String(f.Tag).trim() === tag)
    .filter(f => verf[String(f.Mitarbeiter).trim()])
    .map(f => ({
      name: String(f.Mitarbeiter).trim(),
      art: String(f.Art || '').trim(),
      schule: String(f.Schule || '').trim(),
      raum: String(f.Raum || '').trim()
    }));
}

function speicherePlan(token, datum, zeilen, status) {
  AKTUELL_ = token;
  nurAdmin();

  const sh = ss_().getSheetByName('Plan');
  if (!sh) throw new Error('Tab Plan fehlt');

  // Frueher wurde hier der ganze Tab geleert und komplett neu geschrieben.
  // Ging dabei etwas schief oder liefen zwei Speichervorgaenge gleichzeitig,
  // waren alle anderen Tage weg. Jetzt werden nur die Zeilen dieses einen
  // Tages entfernt und die neuen angehaengt. Der Rest wird nie angefasst.
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const spalten = sh.getLastColumn();
    const kopf = sh.getRange(1, 1, 1, spalten).getValues()[0];
    const namen = kopf.map(k => String(k).trim());
    const zeitSp = ['Zeit', 'Von', 'Bis'].map(n => namen.indexOf(n))
                                         .filter(i => i >= 0);

    // 1. alte Zeilen dieses Tages loeschen, von unten nach oben
    const letzte = sh.getLastRow();
    if (letzte > 1) {
      const spalteA = sh.getRange(2, 1, letzte - 1, 1).getValues();
      for (let r = spalteA.length - 1; r >= 0; r--) {
        if (formatDatum(spalteA[r][0]) === datum) sh.deleteRow(r + 2);
      }
    }

    // 2. neue Zeilen anhaengen
    const neu = zeilen.map(z => {
      const zeile = [datum, z.schule, z.zeit, z.aufgabe, z.gruppe, z.raum,
                     z.mitarbeiter, z.kinder, status, z.von || '', z.bis || ''];
      while (zeile.length < spalten) zeile.push('');
      return zeile.slice(0, spalten);
    });

    if (neu.length) {
      const ab = sh.getLastRow() + 1;
      zeitSp.forEach(i => sh.getRange(ab, i + 1, neu.length).setNumberFormat('@'));
      sh.getRange(ab, 1, neu.length, spalten).setValues(neu);
    }

    // Neue Freigabe heisst: alle muessen sie neu gesehen haben.
    if (String(status).trim() === 'Freigegeben') sahLeeren_(datum);
    cacheLeeren('Plan');
  } finally {
    lock.releaseLock();
  }
  return 'ok';
}

// löscht alle Zeilen eines Tages
function loescheTag(token, datum) {
  AKTUELL_ = token;
  nurAdmin();

  const sh = ss_().getSheetByName('Plan');
  const w = sh.getDataRange().getValues();
  let n = 0;
  for (let r = w.length - 1; r >= 1; r--) {
    if (formatDatum(w[r][0]) === datum) { sh.deleteRow(r + 1); n++; }
  }
  cacheLeeren('Plan');
  return n;
}

// ================= Dashboard (Chef) =================

function ladeDashboard(token) {
  AKTUELL_ = token;
  nurAdmin();

  const feste = leseTab('Fest').map((f, i) => ({
    zeile: i,
    name: String(f.Mitarbeiter || ''),
    tag: String(f.Tag || ''),
    art: String(f.Art || ''),
    schule: String(f.Schule || ''),
    raum: String(f.Raum || '')
  }));

  const verf = {};
  leseTab('Verfuegbarkeit').forEach(v => {
    const n = String(v.Mitarbeiter).trim();
    if (!verf[n]) verf[n] = {};
    verf[n][String(v.Tag).trim()] = planZeit_(v.Von) + ' - ' + planZeit_(v.Bis);
  });

  const alleMa = leseTab('Mitarbeiter').filter(m => !istAdmin_(m));

  const personen = alleMa
    .filter(m => String(m.Aktiv).trim() === 'ja')
    .map(m => ({ name: String(m.Name).trim(), rolle: String(m.Rolle),
                 zeiten: verf[String(m.Name).trim()] || {} }));

  const team = alleMa.map(m => ({
    name: String(m.Name).trim(), rolle: String(m.Rolle),
    aktiv: String(m.Aktiv).trim() === 'ja',
    kinder: String(m.Kinder || '').trim().toLowerCase() === 'ja'
  }));

  const abwesend = leseTab('Abwesend').map((a, i) => ({
    zeile: i,
    datum: formatDatum(a.Datum),
    name: String(a.Mitarbeiter || ''),
    grund: String(a.Grund || '')
  })).sort((a, b) => b.datum.localeCompare(a.datum));

  const schulen = leseTab('Schulen').map(s => String(s.Kuerzel));

  return { feste: feste, personen: personen, team: team, abwesend: abwesend,
           raeume: raeumeListe(), schulen: schulen };
}

function setzeAktiv(token, name, aktiv) {
  AKTUELL_ = token;
  darfTeam_();

  const sh = ss_().getSheetByName('Mitarbeiter');
  const w = sh.getDataRange().getValues();
  const kopf = w[0].map(k => String(k).trim());
  const iN = kopf.indexOf('Name'), iA = kopf.indexOf('Aktiv'), iR = kopf.indexOf('Rolle');
  if (iN < 0 || iA < 0) throw new Error('Spalte Name oder Aktiv fehlt');

  for (let r = 1; r < w.length; r++) {
    if (String(w[r][iN]).trim() !== String(name).trim()) continue;
    if (iR >= 0 && String(w[r][iR]).trim() === 'admin') {
      throw new Error('Der Chef kann nicht deaktiviert werden');
    }
    sh.getRange(r + 1, iA + 1).setValue(aktiv ? 'ja' : 'nein');
    cacheLeeren('Mitarbeiter');
    return 'ok';
  }
  throw new Error('Person nicht gefunden');
}

// Recht "Kinder pflegen" setzen
function setzeKinderRecht(token, name, wert) {
  AKTUELL_ = token;
  darfTeam_();

  const sh = ss_().getSheetByName('Mitarbeiter');
  const w = sh.getDataRange().getValues();
  const kopf = w[0].map(k => String(k).trim());
  const iN = kopf.indexOf('Name'), iK = kopf.indexOf('Kinder');
  if (iN < 0 || iK < 0) throw new Error('Spalte Name oder Kinder fehlt');

  for (let r = 1; r < w.length; r++) {
    if (String(w[r][iN]).trim() !== String(name).trim()) continue;
    sh.getRange(r + 1, iK + 1).setValue(wert ? 'ja' : '');
    cacheLeeren('Mitarbeiter');
    return 'ok';
  }
  throw new Error('Person nicht gefunden');
}

// Recht "Team pflegen" setzen, nur der Chef
function setzeTeamRecht(token, name, wert) {
  AKTUELL_ = token;
  nurAdmin();

  const sh = ss_().getSheetByName('Mitarbeiter');
  const w = sh.getDataRange().getValues();
  const kopf = w[0].map(k => String(k).trim());
  const iN = kopf.indexOf('Name'), iT = kopf.indexOf('Mitarbeiter');
  if (iN < 0 || iT < 0) throw new Error('Spalte Name oder Mitarbeiter fehlt');

  for (let r = 1; r < w.length; r++) {
    if (String(w[r][iN]).trim() !== String(name).trim()) continue;
    sh.getRange(r + 1, iT + 1).setValue(wert ? 'ja' : '');
    cacheLeeren('Mitarbeiter');
    return 'ok';
  }
  throw new Error('Person nicht gefunden');
}

// Liste aller Betreuer und Praktikanten mit allen Angaben
// Wer hat gerade eine gueltige Anmeldung? Liefert je Name die Zahl der
// Geraete und den Zeitpunkt der letzten Anmeldung.
function angemeldetNamen_() {
  var p = props_().getProperties();
  var jetzt = Date.now();
  var raus = {};
  Object.keys(p).forEach(function (k) {
    if (k.indexOf('SESS_') !== 0) return;
    var d;
    try { d = JSON.parse(p[k]); } catch (err) { return; }
    if (!d || !d.name) return;
    if (d.exp && jetzt > d.exp) return;
    var e = raus[d.name] || { geraete: 0, seit: 0 };
    e.geraete++;
    if ((d.seit || 0) > e.seit) e.seit = d.seit || 0;
    raus[d.name] = e;
  });
  return raus;
}

function teamListe(token) {
  AKTUELL_ = token;
  darfTeam_();
  const an = angemeldetNamen_();
  return leseTab('Mitarbeiter')
    .filter(m => !istAdmin_(m))
    .map(m => ({
      name: String(m.Name).trim(), nachname: String(m.Nachname || '').trim(),
      email: String(m.Email || '').trim(), rolle: String(m.Rolle || 'betreuer').trim(),
      token: String(m.Token || '').trim(),
      aktiv: String(m.Aktiv).trim() === 'ja',
      kinder: String(m.Kinder || '').trim().toLowerCase() === 'ja',
      team: String(m.Mitarbeiter || '').trim().toLowerCase() === 'ja',
      meldung: String(m.Meldung || '').trim().toLowerCase() === 'ja',
      kinderschutz: String(m.Kinderschutz || '').trim().toLowerCase() === 'ja',
      nachricht: String(m.Nachricht || '').trim().toLowerCase() === 'ja',
      von: m.Von ? formatDatum(m.Von) : '', bis: m.Bis ? formatDatum(m.Bis) : '',
      angemeldet: !!an[String(m.Name).trim()],
      seit: (an[String(m.Name).trim()] && an[String(m.Name).trim()].seit)
        ? Utilities.formatDate(new Date(an[String(m.Name).trim()].seit),
                               'Europe/Berlin', 'dd.MM. HH:mm') : ''
    }))
    .sort((a, b) => (a.rolle === b.rolle ? a.name.localeCompare(b.name)
                                         : (a.rolle === 'praktikant' ? 1 : -1)));
}

function mitarbeiterSpeichern(token, altName, neu) {
  AKTUELL_ = token;
  darfTeam_();

  const g = v => String(v || '').trim();
  const name = g(neu.name), tok = g(neu.token);
  const rolle = g(neu.rolle) === 'praktikant' ? 'praktikant' : 'betreuer';
  if (!name) throw new Error('Bitte einen Namen eintragen');
  if (tok.length < 6) throw new Error('Der Token braucht mindestens 6 Zeichen');

  const sh = ss_().getSheetByName('Mitarbeiter');
  const w = sh.getDataRange().getValues();
  const kopf = w[0].map(k => String(k).trim());
  const iN = kopf.indexOf('Name');
  if (iN < 0) throw new Error('Spalte Name fehlt');

  let zeile = -1;
  for (let r = 1; r < w.length; r++) {
    const n = String(w[r][iN]).trim();
    if (altName && n === g(altName)) { zeile = r; continue; }
    if (!altName && n === name) throw new Error('Diesen Namen gibt es schon');
    if (String(w[r][kopf.indexOf('Token')] || '').trim() === tok && r !== zeile) {
      throw new Error('Diesen Token hat schon jemand anderes');
    }
  }
  if (altName && zeile < 0) throw new Error('Person nicht gefunden');

  const werte = zeile >= 0 ? w[zeile].slice() : kopf.map(() => '');
  const setz = (n, v) => { const i = kopf.indexOf(n); if (i >= 0) werte[i] = v; };
  setz('Name', zeile >= 0 ? String(w[zeile][iN]).trim() : name);   // Name bleibt beim Bearbeiten
  setz('Nachname', g(neu.nachname));
  setz('Email', g(neu.email));
  setz('Rolle', rolle);
  setz('Token', tok);
  setz('Aktiv', neu.aktiv ? 'ja' : 'nein');
  setz('Kinder', neu.kinder ? 'ja' : '');
  setz('Meldung', neu.meldung ? 'ja' : '');
  setz('Kinderschutz', neu.kinderschutz ? 'ja' : '');
  setz('Nachricht', neu.nachricht ? 'ja' : '');
  setz('Von', rolle === 'praktikant' ? g(neu.von) : '');
  setz('Bis', rolle === 'praktikant' ? g(neu.bis) : '');

  const nr = zeile >= 0 ? zeile + 1 : sh.getLastRow() + 1;
  ['Token', 'Von', 'Bis'].forEach(n => {
    const i = kopf.indexOf(n); if (i >= 0) sh.getRange(nr, i + 1).setNumberFormat('@');
  });
  sh.getRange(nr, 1, 1, kopf.length).setValues([werte]);

  cacheLeeren('Mitarbeiter');
  return 'ok';
}

function festHinzu(token, eintrag) {
  AKTUELL_ = token;
  nurAdmin();
  ss_().getSheetByName('Fest').appendRow([
    eintrag.name, eintrag.tag, eintrag.art || '',
    eintrag.schule || '', eintrag.raum || '']);
  cacheLeeren('Fest');
  return 'ok';
}

function festLoeschen(token, name, tag, art, schule, raum) {
  AKTUELL_ = token;
  nurAdmin();

  const g = v => String(v === undefined || v === null ? '' : v).trim();
  const sh = ss_().getSheetByName('Fest');
  const werte = sh.getDataRange().getValues();

  for (let r = werte.length - 1; r >= 1; r--) {
    if (g(werte[r][0]) !== g(name)) continue;
    if (g(werte[r][1]) !== g(tag)) continue;
    if (g(werte[r][2]) !== g(art)) continue;
    if (g(werte[r][3]) !== g(schule)) continue;
    if (g(werte[r][4]) !== g(raum)) continue;
    sh.deleteRow(r + 1);
    cacheLeeren('Fest');
    return 'ok';
  }
  throw new Error('Eintrag nicht gefunden');
}

// Traegt eine Abwesenheit ein. Ist ein Bis-Datum dabei, wird fuer jeden
// Arbeitstag von Montag bis Donnerstag eine eigene Zeile geschrieben.
// Dadurch bleibt der Rest der App unveraendert und einzelne Tage lassen
// sich spaeter wieder herausnehmen.
function abwesendHinzu(token, datum, name, grund, bis) {
  AKTUELL_ = token;
  nurAdmin();

  const von = String(datum || '').trim();
  const ende = String(bis || '').trim() || von;
  if (!von) throw new Error('Bitte ein Datum wählen');
  if (ende < von) throw new Error('Das Bis-Datum liegt vor dem Von-Datum');

  const sh = ss_().getSheetByName('Abwesend');
  const schon = {};
  leseTab('Abwesend').forEach(a => {
    if (String(a.Name).trim() === String(name).trim()) {
      schon[formatDatum(a.Datum)] = true;
    }
  });

  const neu = [];
  const d = new Date(von + 'T12:00:00');
  const letzte = new Date(ende + 'T12:00:00');
  let schutz = 0;
  while (d <= letzte && schutz++ < 400) {
    const wt = d.getDay();               // 0 = Sonntag, 5 = Freitag, 6 = Samstag
    const tag = formatDatum(d);
    if (wt >= 1 && wt <= 4 && !schon[tag]) neu.push([tag, name, grund || '']);
    d.setDate(d.getDate() + 1);
  }

  if (!neu.length) {
    throw new Error('In diesem Zeitraum gibt es keinen Arbeitstag ' +
                    'oder die Tage sind schon eingetragen');
  }
  sh.getRange(sh.getLastRow() + 1, 1, neu.length, 3).setValues(neu);
  cacheLeeren('Abwesend');
  return { tage: neu.length };
}

function abwesendLoeschen(token, datum, name) {
  AKTUELL_ = token;
  nurAdmin();

  const sh = ss_().getSheetByName('Abwesend');
  const werte = sh.getDataRange().getValues();
  for (let r = werte.length - 1; r >= 1; r--) {
    if (formatDatum(werte[r][0]) === datum
        && String(werte[r][1]).trim() === name) {
      sh.deleteRow(r + 1);
      cacheLeeren('Abwesend');
      return 'ok';
    }
  }
  throw new Error('Eintrag nicht gefunden');
}

// Loescht alle Abwesenheitstage einer Person von von bis bis, in einem Zug.
// Die Liste im Planer zeigt einen Zeitraum als eine Zeile, also muss sie
// sich auch als eine Zeile loeschen lassen.
function abwesendZeitraumLoeschen(token, name, von, bis) {
  AKTUELL_ = token;
  nurAdmin();

  const n = String(name || '').trim();
  const a = String(von || '').trim();
  const b = String(bis || '').trim() || a;
  if (!n || !a) throw new Error('Person und Datum fehlen');

  const sh = ss_().getSheetByName('Abwesend');
  const werte = sh.getDataRange().getValues();
  let weg = 0;
  for (let r = werte.length - 1; r >= 1; r--) {
    const d = formatDatum(werte[r][0]);
    if (String(werte[r][1]).trim() === n && d >= a && d <= b) {
      sh.deleteRow(r + 1);
      weg++;
    }
  }
  if (!weg) throw new Error('Kein Eintrag in diesem Zeitraum gefunden');
  cacheLeeren('Abwesend');
  return { weg: weg };
}

// ================= Mitarbeiter-App =================

// ---------- eingefrorene Tage ----------
// Ab dem Tag selbst wird nicht mehr neu gerechnet: die App zeigt genau das,
// was gespeichert ist. Neue Kinder wirken sich nur auf kommende Tage aus.

function kinderIndex_() {
  const idx = {};
  leseTab('Schueler').forEach(k => {
    const n = String(k.Vorname).trim() + ' ' + String(k.Nachname).trim();
    (idx[n] = idx[n] || []).push({
      name: n, klasse: String(k.Klasse).trim(),
      stufe: parseInt(k.Klasse, 10) || 0,
      schule: String(k.Schule).trim(),
      sgruppe: schulGruppe(String(k.Schule).trim())
    });
  });
  return idx;
}

function kindFinden_(idx, name, schulen, klasse) {
  const l = idx[String(name).trim()];
  if (!l) return null;                      // abgemeldete Kinder fallen raus
  if (l.length === 1) return l[0];
  if (klasse) {                             // bei gleichen Namen entscheidet die Klasse
    const t = l.find(x => x.klasse === String(klasse).trim());
    if (t) return t;
  }
  return l.find(x => String(schulen || '').indexOf(x.schule) >= 0) || l[0];
}

// "Mehmet Mehmedov (2c)" -> {name:'Mehmet Mehmedov', klasse:'2c'}
// Eintraege ohne Klammer funktionieren weiter, dann bleibt die Klasse leer.
function kindTeile_(s) {
  const t = String(s).trim();
  const m = t.match(/^(.*?)\s*\(([^()]*)\)$/);
  return m ? { name: m[1].trim(), klasse: m[2].trim() } : { name: t, klasse: '' };
}

// so wird ein Kind in der Spalte Kinder gespeichert
function kindText_(k) {
  return k.klasse ? k.name + ' (' + k.klasse + ')' : k.name;
}

// baut Abholungen und Gruppen aus den gespeicherten Zeilen
function ausZeilen_(zeilen) {
  const idx = kinderIndex_();
  const abh = {}, grp = {}, reihenA = [], reihenG = [];

  zeilen.forEach(z => {
    if (z.aufgabe === 'Empfang') return;
    const kinder = String(z.kinder || '').split(',').map(s => s.trim())
      .filter(Boolean)
      .map(s => { const t = kindTeile_(s);
                  return kindFinden_(idx, t.name, z.schule, t.klasse); })
      .filter(Boolean);

    if (z.aufgabe === 'Abholung') {
      const key = z.schule + '|' + z.zeit;
      if (!abh[key]) { abh[key] = { schule: z.schule, zeit: z.zeit, kinder: [] };
                       reihenA.push(abh[key]); }
      kinder.forEach(k => {
        if (!abh[key].kinder.some(x => x.name === k.name && x.klasse === k.klasse)) {
          abh[key].kinder.push(k);
        }
      });
    } else {
      const basis = String(z.gruppe).replace(/[a-z]$/, '');
      const key = z.aufgabe + '|' + basis + '|' + z.zeit;
      if (!grp[key]) {
        const von = minuten(z.von || z.zeit);
        let bis = minuten(z.bis || '');
        if (!bis || bis <= von) bis = von + BLOCK_DAUER;
        grp[key] = { art: z.aufgabe, nr: basis, block: z.zeit,
                     von: von, bis: bis, kinder: [] };
        reihenG.push(grp[key]);
      }
      kinder.forEach(k => grp[key].kinder.push(k));
    }
  });

  const abholung = reihenA.map(a => ({
    schule: a.schule, zeit: a.zeit, anzahl: a.kinder.length,
    bedarf: Math.max(Math.ceil(a.kinder.length / PRO_BETREUER), 1), kinder: a.kinder
  })).sort((x, y) => minuten(x.zeit) - minuten(y.zeit)
                     || x.schule.localeCompare(y.schule));

  const gruppen = reihenG.map(g => ({
    art: g.art, nr: g.nr, block: g.block, von: g.von, bis: g.bis,
    kinder: g.kinder, groesse: g.kinder.length,
    bedarf: Math.max(Math.ceil(g.kinder.length / PRO_BETREUER), 1),
    zuKlein: g.kinder.length < MIN_GRUPPE,
    schulen: eindeutig(g.kinder.map(k => k.schule)).join(' + '),
    stufen: eindeutig(g.kinder.map(k => k.klasse)).sort().join(', ')
  })).sort((x, y) => x.von - y.von);

  return { abholung: abholung, gruppen: gruppen };
}

// liefert die Tagesstruktur, gerechnet oder eingefroren
function planStruktur_(datum, neuRechnen, zeilen) {
  const eingefroren = !neuRechnen
    && datum <= formatDatum(new Date())
    && zeilen.some(z => z.aufgabe !== 'Empfang');

  if (!eingefroren) {
    const p = planeTag(wochentag(datum));
    return { abholung: p.abholung, gruppen: p.gruppen, eingefroren: false };
  }
  const s = ausZeilen_(zeilen);
  return { abholung: s.abholung, gruppen: s.gruppen, eingefroren: true };
}

// alle Einsätze eines Tages aus dem freigegebenen Plan,
// bei Abholungen je Kind die Gruppe mit Raum, in die es danach geht
function einsaetzeFuer_(datum) {
  const zeilen = planZeilen(datum).filter(z => z.status === 'Freigegeben');
  const p = planStruktur_(datum, false, zeilen);
  const einsaetze = [];

  p.abholung.forEach(a => {
    const z = zeilen.find(x => x.aufgabe === 'Abholung'
                               && x.schule === a.schule && x.zeit === a.zeit);
    einsaetze.push({
      art: 'Abholung', titel: 'Abholung ' + a.schule, kurz: a.schule,
      von: hhmm_(minuten(a.zeit)), bis: hhmm_(minuten(a.zeit) + ABHOL_DAUER),
      schule: a.schule, raum: '', zeit: a.zeit,
      mitarbeiter: z ? z.mitarbeiter : '',
      kinder: a.kinder.map(k => k.name).join(', '),
      kinderInfo: a.kinder.map(k => ({ name: k.name, klasse: k.klasse, schule: k.schule }))
    });
  });

  p.gruppen.forEach(g => {
    const treffer = zeilen.filter(x =>
      x.aufgabe === g.art
      && String(x.gruppe).replace(/[a-z]$/, '') === String(g.nr)
      && x.zeit === g.block);

    if (treffer.length) {
      const pool = g.kinder.slice();
      treffer.forEach(z => {
        const info = String(z.kinder || '').split(',').map(s => s.trim()).filter(Boolean)
          .map(s => {
            const t = kindTeile_(s);
            let i = t.klasse
              ? pool.findIndex(k => k.name === t.name && k.klasse === t.klasse) : -1;
            if (i < 0) i = pool.findIndex(k => k.name === t.name);
            const k = i >= 0 ? pool.splice(i, 1)[0] : null;
            return { name: t.name,
                     klasse: k ? k.klasse : t.klasse,
                     schule: k ? k.schule : '' };
          });
        einsaetze.push({
          art: g.art, titel: g.art + ' ' + z.gruppe, kurz: g.art + ' ' + z.gruppe,
          von: hhmm_(g.von), bis: hhmm_(g.bis),
          schule: g.schulen, raum: z.raum, zeit: g.block,
          mitarbeiter: z.mitarbeiter,
          kinder: info.map(k => k.name).join(', '), kinderInfo: info
        });
      });
    } else {
      einsaetze.push({
        art: g.art, titel: g.art + ' ' + g.nr, kurz: g.art + ' ' + g.nr,
        von: hhmm_(g.von), bis: hhmm_(g.bis),
        schule: g.schulen, raum: '', zeit: g.block, mitarbeiter: '',
        kinder: g.kinder.map(k => k.name).join(', '),
        kinderInfo: g.kinder.map(k => ({ name: k.name, klasse: k.klasse, schule: k.schule }))
      });
    }
  });

  zeilen.filter(z => z.aufgabe === 'Empfang').forEach(z => {
    const von = z.von || z.zeit;
    einsaetze.push({
      art: 'Empfang', titel: 'Empfang', kurz: 'Empfang',
      von: von, bis: z.bis || hhmm_(minuten(von) + 30),
      schule: '', raum: '', zeit: z.zeit,
      mitarbeiter: z.mitarbeiter, kinder: ''
    });
  });

  // Ziel je Kind der Abholung: Gruppe, Raum, Betreuer
  const gruppen = einsaetze.filter(e => e.art === 'EZ' || e.art === 'BUT');
  einsaetze.filter(e => e.art === 'Abholung').forEach(a => {
    a.kinderInfo.forEach(k => {
      const g = gruppen.find(x => (x.kinderInfo || []).some(i =>
        i.name === k.name && i.schule === k.schule && i.klasse === k.klasse));
      k.ziel = g ? { titel: g.titel, raum: g.raum, wer: g.mitarbeiter,
                     von: g.von, bis: g.bis } : null;
    });
  });

  return { einsaetze: einsaetze, freigegeben: zeilen.length > 0 };
}

// ===== Wer hat den freigegebenen Plan gesehen? =====
// Vermerkt wird pro Tag eine Liste "Name|HH:mm", getrennt durch Semikolon.
// Beim Freigeben wird die Liste geleert, damit man sieht, wer die neue
// Fassung gesehen hat und nicht die alte.

function sahSchluessel_(datum) { return 'SAH_' + String(datum).trim(); }

function sahLesen_(datum) {
  var roh = props_().getProperty(sahSchluessel_(datum));
  var raus = {};
  if (!roh) return raus;
  roh.split(';').forEach(function (teil) {
    var p = teil.split('|');
    if (p[0]) raus[p[0]] = p[1] || '';
  });
  return raus;
}

function sahVermerken_(datum, name) {
  var da = sahLesen_(datum);
  if (da[name]) return;                      // der erste Blick zaehlt
  da[name] = Utilities.formatDate(new Date(), 'Europe/Berlin', 'HH:mm');
  var text = Object.keys(da).map(function (n) { return n + '|' + da[n]; }).join(';');
  if (text.length > 8000) return;            // Notbremse gegen das 9-KB-Limit
  props_().setProperty(sahSchluessel_(datum), text);
}

function sahLeeren_(datum) {
  props_().deleteProperty(sahSchluessel_(datum));
}

function meinTag(token, datum) {
  AKTUELL_ = token;
  const m = michSelbst();
  if (!m) throw new Error('Keine Berechtigung');

  const name = String(m.Name).trim();
  const e = einsaetzeFuer_(datum);

  const meine = e.einsaetze.filter(z =>
    z.mitarbeiter.split(',').map(s => s.trim()).indexOf(name) >= 0);

  // Nur der freigegebene Plan zaehlt, und nur wer an dem Tag eingeteilt ist.
  if (e.freigegeben && meine.length) sahVermerken_(datum, name);

  const verf = leseTab('Verfuegbarkeit')
    .filter(v => String(v.Mitarbeiter).trim() === name)
    .map(v => ({ tag: String(v.Tag), von: planZeit_(v.Von), bis: planZeit_(v.Bis) }));

  const prakt = leseTab('Mitarbeiter')
    .filter(x => rolle_(x) === 'praktikant')
    .map(x => String(x.Name).trim());

  return {
    name: name, rolle: String(m.Rolle),
    datum: datum,
    freigegeben: e.freigegeben,
    // nur die eigenen Einsaetze, damit die App schnell laedt.
    // Der ganze Tag kommt erst auf Klick ueber tagAlle().
    meine: meine, alle: meine, nurMeine: true,
    anzahlAlle: e.einsaetze.length,
    verfuegbarkeit: verf, praktikanten: prakt,
    darfKinder: String(m.Kinder || '').trim().toLowerCase() === 'ja',
    darfTeam: String(m.Mitarbeiter || '').trim().toLowerCase() === 'ja',
    darfMeldung: darfAlleMeldungen_(m),
    darfNachricht: darfNachricht_(m),
    darfKinderschutz: darfKinderschutz_(m),
    meldungen: meldungenFuer_(datum, m, meine),
    meldungKarte: meldungKarteFuer_(datum, m, meine),
    ks: ksKurz_(m),
    anwesend: anwesendFuer_(datum)
  };
}

// "Wo ist das Kind heute?" für den Empfang
// Alles, was der Reiter Kinder braucht, in einem einzigen Aufruf.
// Dadurch laeuft die Suche im Handy und fragt nicht bei jedem
// Buchstaben den Server - das war vorher der Bremsklotz.
function kinderDaten(token) {
  AKTUELL_ = token;
  const m = michSelbst();
  if (!m) throw new Error('Keine Berechtigung');
  const darfSuche = SUCHE_ROLLEN.indexOf(rolle_(m)) >= 0;

  const datum = formatDatum(new Date());
  const e = einsaetzeFuer_(datum);
  const anw = anwesendFuer_(datum);
  const abh = e.einsaetze.filter(x => x.art === 'Abholung');

  const wo = leseTab('Schueler').map(k => {
    const name = String(k.Vorname).trim() + ' ' + String(k.Nachname).trim();
    const schule = String(k.Schule).trim(), klasse = String(k.Klasse).trim();
    let a = null, info = null;
    abh.forEach(x => {
      if (a) return;
      const i = x.kinderInfo.find(z =>
        z.name === name && z.schule === schule && z.klasse === klasse);
      if (i) { a = x; info = i; }
    });
    return {
      name: name, schule: schule, klasse: klasse,
      status: anw[name + '|' + schule + '|' + klasse] || '',
      heute: !!a,
      abholung: a ? { von: a.von, bis: a.bis, wer: a.mitarbeiter } : null,
      ziel: info ? info.ziel : null
    };
  });

  let kontakt = [], schulen = [];
  if (darfSuche) {
    const liste = leseTab(TEILNEHMER_TAB);
    schulen = eindeutig(liste.map(k => spalte_(k, 'schule')).filter(Boolean)).sort();
    kontakt = liste.map(k => ({
      name: kindName_(k), schule: spalte_(k, 'schule'),
      klasse: spalte_(k, 'klasse'), telefon: spalte_(k, 'telefon'),
      allein: String(spalte_(k, 'allein')).toLowerCase()
    })).filter(k => k.name);
  }
  if (!schulen.length) {
    schulen = eindeutig(wo.map(x => x.schule).filter(Boolean)).sort();
  }

  return {
    jetzt: Utilities.formatDate(new Date(), 'Europe/Berlin', 'HH:mm'),
    freigegeben: e.freigegeben, schulen: schulen,
    wo: wo, kontakt: kontakt, darfSuche: darfSuche
  };
}

function woIstKind(token, suche) {
  AKTUELL_ = token;
  const m = michSelbst();
  if (!m) throw new Error('Keine Berechtigung');

  const n = String(suche || '').trim().toLowerCase();
  if (n.length < 2) return { suche: false, treffer: [] };

  const datum = formatDatum(new Date());
  const e = einsaetzeFuer_(datum);
  const anw = anwesendFuer_(datum);
  const abh = e.einsaetze.filter(x => x.art === 'Abholung');

  const treffer = [];
  leseTab('Schueler').forEach(k => {
    const name = String(k.Vorname) + ' ' + String(k.Nachname);
    if (name.toLowerCase().indexOf(n) < 0) return;
    const schule = String(k.Schule), klasse = String(k.Klasse);

    let a = null, info = null;
    abh.forEach(x => {
      if (a) return;
      const i = x.kinderInfo.find(z =>
        z.name === name && z.schule === schule && z.klasse === klasse);
      if (i) { a = x; info = i; }
    });

    treffer.push({
      name: name, schule: schule, klasse: klasse,
      status: anw[name + '|' + schule + '|' + klasse] || '',
      heute: !!a,
      abholung: a ? { von: a.von, wer: a.mitarbeiter } : null,
      ziel: info ? info.ziel : null
    });
  });

  const rang = t => !t.heute ? 5
    : (t.status === '✓' ? 0 : (t.status === '' ? 1 : (t.status === 'F' ? 2 : 3)));
  treffer.sort((x, y) => rang(x) - rang(y) || x.name.localeCompare(y.name));

  return {
    suche: true, freigegeben: e.freigegeben,
    jetzt: Utilities.formatDate(new Date(), 'Europe/Berlin', 'HH:mm'),
    treffer: treffer.slice(0, 20), mehr: treffer.length > 20
  };
}

function speichereVerfuegbarkeit(token, eintraege) {
  AKTUELL_ = token;
  const m = michSelbst();
  if (!m) throw new Error('Keine Berechtigung');

  const sh = ss_().getSheetByName('Verfuegbarkeit');
  if (!sh) throw new Error('Tab Verfuegbarkeit fehlt');
  const name = String(m.Name).trim();

  // Wie beim Plan: der Tab wird nicht mehr geleert und neu geschrieben.
  // Es werden nur die eigenen Zeilen entfernt und die neuen angehaengt.
  // Sonst koennte ein Fehler mittendrin die Zeiten aller anderen loeschen.
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const breite = sh.getLastColumn();

    const letzte = sh.getLastRow();
    if (letzte > 1) {
      const spalteA = sh.getRange(2, 1, letzte - 1, 1).getValues();
      for (let r = spalteA.length - 1; r >= 0; r--) {
        if (String(spalteA[r][0]).trim() === name) sh.deleteRow(r + 2);
      }
    }

    const neu = eintraege.map(e => {
      const zeile = [name, e.tag, e.von, e.bis];
      while (zeile.length < breite) zeile.push('');
      return zeile.slice(0, breite);
    });

    if (neu.length) {
      const ab = sh.getLastRow() + 1;
      sh.getRange(ab, 3, neu.length, 2).setNumberFormat('@');
      sh.getRange(ab, 1, neu.length, breite).setValues(neu);
    }

    cacheLeeren('Verfuegbarkeit');
  } finally {
    lock.releaseLock();
  }
  return 'ok';
}

// ---------- Abwesend melden ----------

function meineAbwesenheiten(token) {
  AKTUELL_ = token;
  const m = michSelbst();
  if (!m) throw new Error('Keine Berechtigung');
  const name = String(m.Name).trim();
  const heute = formatDatum(new Date());
  return leseTab('Abwesend')
    .filter(a => String(a.Mitarbeiter).trim() === name)
    .map(a => ({ datum: formatDatum(a.Datum), grund: String(a.Grund || '') }))
    .filter(a => a.datum >= heute)
    .sort((a, b) => a.datum.localeCompare(b.datum));
}

function meldeAbwesend(token, datum, grund) {
  AKTUELL_ = token;
  const m = michSelbst();
  if (!m) throw new Error('Keine Berechtigung');
  const name = String(m.Name).trim();
  if (!datum || datum < formatDatum(new Date())) {
    throw new Error('Das Datum liegt in der Vergangenheit');
  }
  const schon = leseTab('Abwesend').some(a =>
    formatDatum(a.Datum) === datum && String(a.Mitarbeiter).trim() === name);
  if (schon) throw new Error('Für diesen Tag bist du schon eingetragen');

  ss_().getSheetByName('Abwesend').appendRow([datum, name, grund || '']);
  cacheLeeren('Abwesend');

  const betroffen = planZeilen(datum).filter(z =>
    z.status === 'Freigegeben' &&
    z.mitarbeiter.split(',').map(s => s.trim()).indexOf(name) >= 0);
  if (betroffen.length) mailAbwesend_(name, datum, grund, betroffen);
  return betroffen.length ? 'geplant' : 'ok';
}

function loescheAbwesend(token, datum) {
  AKTUELL_ = token;
  const m = michSelbst();
  if (!m) throw new Error('Keine Berechtigung');
  const name = String(m.Name).trim();
  const sh = ss_().getSheetByName('Abwesend');
  const w = sh.getDataRange().getValues();
  for (let r = w.length - 1; r >= 1; r--) {
    if (formatDatum(w[r][0]) === datum && String(w[r][1]).trim() === name) {
      sh.deleteRow(r + 1);
      cacheLeeren('Abwesend');
      return 'ok';
    }
  }
  throw new Error('Eintrag nicht gefunden');
}

function mailAbwesend_(name, datum, grund, zeilen) {
  const chef = leseTab('Mitarbeiter').find(x => istAdmin_(x));
  if (!chef || !chef.Email) return;
  const liste = zeilen.map(z =>
    '- ' + z.aufgabe + ' ' + z.gruppe + ' (' + (z.von || z.zeit) + ')').join('\n');
  try {
    MailApp.sendEmail(String(chef.Email),
      'Abwesenheit: ' + name + ' am ' + datum,
      name + ' hat sich für ' + datum + ' abgemeldet.' +
      (grund ? '\nGrund: ' + grund : '') +
      '\n\nBetroffene Einsätze im freigegebenen Plan:\n' + liste +
      '\n\nBitte im PGM Planer neu besetzen.');
  } catch (e) {
    Logger.log('Mail fehlgeschlagen: ' + e.message);
  }
}

// ================= Kind suchen =================

const TEILNEHMER_TAB = 'Teilnehmer Liste';
const SUCHE_ROLLEN = ['admin', 'betreuer', 'praktikant'];

function spalte_(k, begriff) {
  const b = begriff.toLowerCase();
  const key = Object.keys(k).find(x =>
    String(x).toLowerCase().replace(/[^a-zäöü]/g, '').indexOf(b) >= 0);
  return key ? String(k[key] || '').trim() : '';
}

function kindName_(k) {
  const vor = spalte_(k, 'vorname');
  const nach = spalte_(k, 'nachname');
  if (vor && nach && vor !== nach) return vor + ' ' + nach;
  return spalte_(k, 'name');
}

function sucheKind(token, name, schule) {
  AKTUELL_ = token;
  const m = michSelbst();
  if (!m || SUCHE_ROLLEN.indexOf(rolle_(m)) < 0) {
    throw new Error('Keine Berechtigung');
  }

  const liste = leseTab(TEILNEHMER_TAB);
  const schulen = eindeutig(liste.map(k => spalte_(k, 'schule'))
                                 .filter(Boolean)).sort();

  const n = String(name || '').trim().toLowerCase();
  const s = String(schule || '').trim();
  if (n.length < 2 && !s) {
    return { schulen: schulen, treffer: [], suche: false, mehr: false };
  }

  const alle = liste.filter(k => {
    if (s && spalte_(k, 'schule') !== s) return false;
    if (n.length >= 2 && kindName_(k).toLowerCase().indexOf(n) < 0) return false;
    return true;
  });

  const treffer = alle.slice(0, 30).map(k => ({
    name: kindName_(k),
    schule: spalte_(k, 'schule'),
    klasse: spalte_(k, 'klasse'),
    telefon: spalte_(k, 'telefon'),
    allein: spalte_(k, 'allein').toLowerCase()
  }));

  return { schulen: schulen, treffer: treffer, suche: true, mehr: alle.length > 30 };
}

// ================= Anwesenheit =================

const ANW_TAB = 'Anwesenheit';
const ANW_FARBEN = {
  '✓': ['#dcfce7', '#166534'],
  'E': ['#fef9c3', '#854d0e'],
  'F': ['#fee2e2', '#b91c1c']
};

function anwKopfText_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, tz_(), 'dd.MM.yyyy');
  return String(v).trim();
}

function anwDatumText_(datum) {
  const t = String(datum).split('-');
  return t[2] + '.' + t[1] + '.' + t[0];
}

function anwesendFuer_(datum) {
  const sh = ss_().getSheetByName(ANW_TAB);
  if (!sh || sh.getLastRow() < 1) return {};
  const w = sh.getDataRange().getValues();
  const sp = w[0].map(anwKopfText_).indexOf(anwDatumText_(datum));
  const raus = {};
  if (sp < 0) return raus;
  for (let r = 1; r < w.length; r++) {
    const v = String(w[r][sp] || '').trim();
    if (!v) continue;
    raus[String(w[r][0]).trim() + '|' + String(w[r][1]).trim() + '|' +
         String(w[r][2]).trim()] = v;
  }
  return raus;
}

function setzeAnwesend(token, datum, schule, zeit, kind, klasse, wert) {
  AKTUELL_ = token;
  const m = michSelbst();
  if (!m) throw new Error('Keine Berechtigung');
  if (['✓', 'E', 'F'].indexOf(wert) < 0) throw new Error('Ungültiger Wert');
  if (datum !== formatDatum(new Date())) {
    throw new Error('Eintragen geht nur am selben Tag');
  }

  const name = String(m.Name).trim();
  const eingeteilt = planZeilen(datum).some(z =>
    z.status === 'Freigegeben' && z.aufgabe === 'Abholung' &&
    z.schule === schule && z.zeit === zeit &&
    z.mitarbeiter.split(',').map(s => s.trim()).indexOf(name) >= 0);
  if (!eingeteilt) throw new Error('Du bist für diese Abholung nicht eingeteilt');

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = ss_().getSheetByName(ANW_TAB);
    if (!sh) throw new Error('Tab Anwesenheit fehlt');
    const w = sh.getDataRange().getValues();
    const kopf = w[0].map(anwKopfText_);
    const titel = anwDatumText_(datum);

    let sp = kopf.indexOf(titel);
    if (sp < 0) {
      sp = kopf.length;
      sh.getRange(1, sp + 1).setNumberFormat('@').setValue(titel)
        .setFontWeight('bold').setBackground('#e8eaed')
        .setHorizontalAlignment('center');
    }

    let zeile = -1;
    for (let r = 1; r < w.length; r++) {
      if (String(w[r][0]).trim() === kind &&
          String(w[r][1]).trim() === schule &&
          String(w[r][2]).trim() === klasse) {
        zeile = r + 1;
        break;
      }
    }
    if (zeile < 0) {
      zeile = Math.max(sh.getLastRow(), 1) + 1;
      sh.getRange(zeile, 1, 1, 3).setValues([[kind, schule, klasse]]);
    }

    const f = ANW_FARBEN[wert];
    sh.getRange(zeile, sp + 1).setValue(wert)
      .setBackground(f[0]).setFontColor(f[1])
      .setFontWeight('bold').setHorizontalAlignment('center');
  } finally {
    lock.releaseLock();
  }
  return 'ok';
}

// ================= Kinder verwalten (Chef) =================

function kopfIdx_(kopf, begriff) {
  const b = begriff.toLowerCase();
  return kopf.findIndex(k =>
    String(k).toLowerCase().replace(/[^a-zäöü]/g, '').indexOf(b) >= 0);
}

function kinderStamm(token) {
  AKTUELL_ = token;
  darfKinder_();
  const schulen = leseTab('Schulen').map(s => String(s.Kuerzel).trim()).filter(Boolean);
  const zeiten = {};
  schulen.forEach(s => zeiten[s] = []);
  leseTab('Schueler').forEach(k => {
    const s = String(k.Schule).trim();
    if (!zeiten[s]) zeiten[s] = [];
    ['Mo', 'Di', 'Mi', 'Do'].forEach(t => {
      const z = planZeit_(k[t]);
      if (z && zeiten[s].indexOf(z) < 0) zeiten[s].push(z);
    });
  });
  Object.keys(zeiten).forEach(s => zeiten[s].sort());
  return { schulen: schulen, zeiten: zeiten };
}

// Kontakt eines Kindes aus der Teilnehmer Liste
function teilnehmerZeile_(werte, kopf, name, schule, klasse) {
  const iN = kopfIdx_(kopf, 'name'), iS = kopfIdx_(kopf, 'schule'), iK = kopfIdx_(kopf, 'klasse');
  if (iN < 0) return -1;
  const kand = [];
  for (let r = 1; r < werte.length; r++) {
    if (String(werte[r][iN]).trim() === name) kand.push(r);
  }
  if (!kand.length) return -1;
  const s = kand.find(r => iS >= 0 && String(werte[r][iS]).trim() === schule);
  if (s !== undefined) return s;
  const k = kand.find(r => iK >= 0 && String(werte[r][iK]).trim() === klasse);
  if (k !== undefined) return k;
  return kand[0];
}

function kinderSuche(token, suche) {
  AKTUELL_ = token;
  darfKinder_();
  const n = String(suche || '').trim().toLowerCase();
  if (n.length < 2) return [];

  const tsh = ss_().getSheetByName(TEILNEHMER_TAB);
  const tw = tsh ? tsh.getDataRange().getValues() : [[]];
  const tk = tw[0];

  return leseTab('Schueler')
    .filter(k => (String(k.Vorname) + ' ' + String(k.Nachname)).toLowerCase().indexOf(n) >= 0)
    .slice(0, 30)
    .map(k => {
      const name = String(k.Vorname).trim() + ' ' + String(k.Nachname).trim();
      const r = teilnehmerZeile_(tw, tk, name, String(k.Schule).trim(), String(k.Klasse).trim());
      const iT = kopfIdx_(tk, 'telefon'), iA = kopfIdx_(tk, 'allein');
      return {
        schule: String(k.Schule).trim(), vorname: String(k.Vorname).trim(),
        nachname: String(k.Nachname).trim(), klasse: String(k.Klasse).trim(),
        status: String(k.Status || '').trim().toUpperCase() === 'BUT' ? 'BUT' : 'EZ',
        Mo: planZeit_(k.Mo), Di: planZeit_(k.Di), Mi: planZeit_(k.Mi), Do: planZeit_(k.Do),
        telefon: r >= 0 && iT >= 0 ? String(tw[r][iT]).trim() : '',
        allein: r >= 0 && iA >= 0 ? String(tw[r][iA]).trim().toLowerCase() : ''
      };
    });
}

function schuelerZeile_(werte, kopf, k) {
  const i = n => kopf.indexOf(n);
  for (let r = 1; r < werte.length; r++) {
    const z = werte[r];
    if (String(z[i('Schule')]).trim() === k.schule &&
        String(z[i('Vorname')]).trim() === k.vorname &&
        String(z[i('Nachname')]).trim() === k.nachname &&
        String(z[i('Klasse')]).trim() === k.klasse) return r;
  }
  return -1;
}

function kindSpeichern(token, alt, neu) {
  AKTUELL_ = token;
  darfKinder_();

  const g = v => String(v || '').trim();
  const k = {
    schule: g(neu.schule), vorname: g(neu.vorname), nachname: g(neu.nachname),
    klasse: g(neu.klasse), status: g(neu.status) === 'BUT' ? 'BUT' : 'EZ',
    Mo: g(neu.Mo), Di: g(neu.Di), Mi: g(neu.Mi), Do: g(neu.Do),
    telefon: g(neu.telefon), allein: g(neu.allein)
  };
  if (!k.schule || !k.vorname || !k.nachname || !k.klasse) {
    throw new Error('Schule, Vorname, Nachname und Klasse sind Pflicht');
  }

  // ---- Schueler ----
  const sh = ss_().getSheetByName('Schueler');
  const w = sh.getDataRange().getValues();
  const kopf = w[0].map(x => String(x).trim());
  const rAlt = alt ? schuelerZeile_(w, kopf, alt) : -1;
  if (alt && rAlt < 0) throw new Error('Kind im Tab Schueler nicht gefunden');
  const rDoppelt = schuelerZeile_(w, kopf, k);
  if (rDoppelt >= 0 && rDoppelt !== rAlt) throw new Error('Dieses Kind gibt es schon');

  const zeile = rAlt >= 0 ? w[rAlt].slice() : kopf.map(() => '');
  const setz = (n, v) => { const i = kopf.indexOf(n); if (i >= 0) zeile[i] = v; };
  setz('Schule', k.schule); setz('Vorname', k.vorname); setz('Nachname', k.nachname);
  setz('Klasse', k.klasse); setz('Status', k.status);
  ['Mo', 'Di', 'Mi', 'Do'].forEach(t => setz(t, k[t]));

  const nr = rAlt >= 0 ? rAlt + 1 : sh.getLastRow() + 1;
  ['Klasse', 'Mo', 'Di', 'Mi', 'Do'].forEach(n => {
    const i = kopf.indexOf(n); if (i >= 0) sh.getRange(nr, i + 1).setNumberFormat('@');
  });
  sh.getRange(nr, 1, 1, kopf.length).setValues([zeile]);

  // ---- Teilnehmer Liste ----
  const tsh = ss_().getSheetByName(TEILNEHMER_TAB);
  if (tsh) {
    const tw = tsh.getDataRange().getValues();
    const tk = tw[0];
    const altName = alt ? alt.vorname + ' ' + alt.nachname : '';
    const rT = alt ? teilnehmerZeile_(tw, tk, altName, alt.schule, alt.klasse) : -1;
    const tz = rT >= 0 ? tw[rT].slice() : tk.map(() => '');
    const iN = kopfIdx_(tk, 'name'), iS = kopfIdx_(tk, 'schule'), iK = kopfIdx_(tk, 'klasse'),
          iT = kopfIdx_(tk, 'telefon'), iA = kopfIdx_(tk, 'allein');
    if (iN >= 0) tz[iN] = k.vorname + ' ' + k.nachname;
    if (iS >= 0) tz[iS] = k.schule;
    if (iK >= 0) tz[iK] = k.klasse;
    if (iT >= 0) tz[iT] = k.telefon;
    if (iA >= 0) tz[iA] = k.allein;
    const tnr = rT >= 0 ? rT + 1 : tsh.getLastRow() + 1;
    if (iT >= 0) tsh.getRange(tnr, iT + 1).setNumberFormat('@');
    tsh.getRange(tnr, 1, 1, tk.length).setValues([tz]);
  }

  cacheLeeren();
  return 'ok';
}

function kindAbmelden(token, alt, grund) {
  AKTUELL_ = token;
  // Abmelden und Wiederanmelden haengen beide an der Spalte Kinder.
  darfKinder_();

  const sh = ss_().getSheetByName('Schueler');
  const w = sh.getDataRange().getValues();
  const kopf = w[0].map(x => String(x).trim());
  const r = schuelerZeile_(w, kopf, alt);
  if (r < 0) throw new Error('Kind im Tab Schueler nicht gefunden');
  const z = w[r];
  const wert = n => { const i = kopf.indexOf(n); return i >= 0 ? planZeit_(z[i]) : ''; };

  let telefon = '', allein = '';
  const tsh = ss_().getSheetByName(TEILNEHMER_TAB);
  let rT = -1;
  if (tsh) {
    const tw = tsh.getDataRange().getValues();
    const tk = tw[0];
    rT = teilnehmerZeile_(tw, tk, alt.vorname + ' ' + alt.nachname, alt.schule, alt.klasse);
    if (rT >= 0) {
      const iT = kopfIdx_(tk, 'telefon'), iA = kopfIdx_(tk, 'allein');
      telefon = iT >= 0 ? String(tw[rT][iT]) : '';
      allein = iA >= 0 ? String(tw[rT][iA]) : '';
    }
  }

  const ab = ss_().getSheetByName('Abgemeldet');
  if (!ab) throw new Error('Tab Abgemeldet fehlt');
  const ak = ab.getRange(1, 1, 1, ab.getLastColumn()).getValues()[0].map(x => String(x).trim());
  const feld = {
    'Abgemeldet am': formatDatum(new Date()), 'Schule': wert('Schule'),
    'Nachname': wert('Nachname'), 'Vorname': wert('Vorname'), 'Klasse': wert('Klasse'),
    'Mo': wert('Mo'), 'Di': wert('Di'), 'Mi': wert('Mi'), 'Do': wert('Do'),
    'Status': wert('Status'), 'Telefonnummer': telefon, 'Darf allein': allein,
    'Grund': String(grund || '')
  };
  const nr = ab.getLastRow() + 1;
  ['Mo', 'Di', 'Mi', 'Do', 'Telefonnummer'].forEach(n => {
    const i = ak.indexOf(n); if (i >= 0) ab.getRange(nr, i + 1).setNumberFormat('@');
  });
  ab.getRange(nr, 1, 1, ak.length).setValues([ak.map(n => feld[n] !== undefined ? feld[n] : '')]);

  sh.deleteRow(r + 1);
  if (tsh && rT >= 0) tsh.deleteRow(rT + 1);

  cacheLeeren();
  return 'ok';
}


// Kinder, die eine Person an diesem Tag selbst hat
function eigeneKinder_(meine) {
  const eigene = {};
  (meine || []).forEach(z => {
    (z.kinderInfo || []).forEach(k => {
      eigene[meldungKey_(k.name, k.schule, k.klasse)] = true;
    });
  });
  return eigene;
}

// Meldungen je Kind, nur für Kinder, die die Person selbst hat
function meldungKarteFuer_(datum, m, meine) {
  const alle = meldungKarte_(datum);
  if (darfAlleMeldungen_(m)) return alle;
  const eigene = eigeneKinder_(meine);
  const raus = {};
  Object.keys(alle).forEach(k => { if (eigene[k]) raus[k] = alle[k]; });
  return raus;
}

// Meldungen, die eine Person sehen darf
function meldungenFuer_(datum, m, meine) {
  const alle = meldungenTag_(datum);
  const name = String(m.Name).trim();

  const eltern = alle.filter(x => !x.von && x.kind);
  const intern = meldungenVerlauf_();

  return {
    eltern: darfAlleMeldungen_(m)
      ? eltern
      : eltern.filter(x => {
          const eigene = eigeneKinder_(meine);
          return eigene[meldungKey_(x.kind, x.schule, x.klasse)];
        }),
    // interne Nachrichten sieht nur, wer das Recht hat. Alle anderen sehen
    // ausschliesslich, was sie selbst geschrieben haben, was an sie geht
    // und was an Alle geschickt wurde.
    intern: darfNachricht_(m)
      ? intern
      : intern.filter(x => x.von === name || x.an === name || x.an === 'Alle')
  };
}

// ================= Meldungen der Eltern =================

const MELD_TAB = 'Meldung';

function schuleFuerCode_(code) {
  const c = String(code || '').trim();
  if (c.length < 4) return null;
  const s = leseTab('Schulen').find(x => String(x.Eltern || '').trim() === c);
  return s ? { kuerzel: String(s.Kuerzel).trim(), name: String(s.Schule).trim() } : null;
}

function meldungKey_(kind, schule, klasse) {
  return String(kind).trim() + '|' + String(schule).trim() + '|' + String(klasse).trim();
}

function meldungenTag_(datum) {
  const sh = ss_().getSheetByName(MELD_TAB);
  if (!sh || sh.getLastRow() < 2) return [];
  return leseTab(MELD_TAB)
    .filter(m => formatDatum(m.Datum) === datum)
    .map(m => ({
      eingang: String(m.Eingang || ''), datum: formatDatum(m.Datum),
      schule: String(m.Schule || '').trim(), klasse: String(m.Klasse || '').trim(),
      kind: String(m.Kind || '').trim(), art: String(m.Art || '').trim(),
      uhrzeit: planZeit_(m.Uhrzeit), nachricht: String(m.Nachricht || ''),
      gesehen: String(m.Gesehen || '').trim().toLowerCase() === 'ja',
      von: String(m.Von || '').trim(), an: String(m.An || '').trim(),
      antwort: String(m.Antwort || ''),
      antwortVon: String(m.AntwortVon || '').trim(),
      antwortAm: String(m.AntwortAm || '').trim(),
      gesehenVon: String(m.GesehenVon || '').trim()
    }));
}

// schreibt eine Zeile in den Tab Meldung. Deckt alle drei Faelle ab:
// Eltern (von leer), intern ueber ein Kind, Nachricht an eine Person.
function meldungSchreiben_(feld) {
  const sh = ss_().getSheetByName(MELD_TAB);
  if (!sh) throw new Error('Tab ' + MELD_TAB + ' fehlt');
  const kopf = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
                 .map(x => String(x).trim());
  const nr = sh.getLastRow() + 1;
  ['Eingang', 'Uhrzeit', 'Datum'].forEach(n => {
    const i = kopf.indexOf(n); if (i >= 0) sh.getRange(nr, i + 1).setNumberFormat('@');
  });
  sh.getRange(nr, 1, 1, kopf.length)
    .setValues([kopf.map(k => feld[k] !== undefined ? feld[k] : '')]);
  cacheLeeren(MELD_TAB);
}

function jetztText_() {
  return Utilities.formatDate(new Date(), 'Europe/Berlin', 'dd.MM.yyyy HH:mm:ss');
}

// Nachricht von einer Person an eine andere, ohne Bezug zu einem Kind
function nachrichtSchreiben_(von, an, text) {
  meldungSchreiben_({
    'Eingang': jetztText_(), 'Datum': formatDatum(new Date()),
    'Schule': '', 'Klasse': '', 'Kind': '', 'Art': 'Nachricht',
    'Uhrzeit': '', 'Nachricht': String(text || ''), 'Gesehen': '',
    'Von': von, 'An': an, 'Antwort': '', 'AntwortVon': '', 'AntwortAm': ''
  });
}

// Meldung eines Mitarbeiters ueber ein Kind
function meldungIntern(token, d) {
  AKTUELL_ = token;
  const m = michSelbst();
  if (!m) throw new Error('Keine Berechtigung');

  const text = String((d && d.nachricht) || '').trim();
  const kind = String((d && d.kind) || '').trim();
  if (text.length < 3) throw new Error('Bitte schreib kurz, worum es geht');
  if (!kind) throw new Error('Kein Kind gewählt');

  meldungSchreiben_({
    'Eingang': jetztText_(),
    'Datum': String((d && d.datum) || formatDatum(new Date())),
    'Schule': String((d && d.schule) || '').trim(),
    'Klasse': String((d && d.klasse) || '').trim(),
    'Kind': kind, 'Art': 'Intern', 'Uhrzeit': '',
    'Nachricht': text, 'Gesehen': '',
    'Von': String(m.Name).trim(), 'An': '',
    'Antwort': '', 'AntwortVon': '', 'AntwortAm': ''
  });
  return 'ok';
}

// Nachricht an einen Mitarbeiter, nur fuer Chef und Berechtigte
function nachrichtSenden(token, an, text) {
  AKTUELL_ = token;
  const m = michSelbst();
  if (!m || !darfNachricht_(m)) throw new Error('Keine Berechtigung');
  const t = String(text || '').trim();
  if (t.length < 3) throw new Error('Bitte schreib kurz, worum es geht');
  if (!String(an || '').trim()) throw new Error('Kein Empfänger gewählt');
  nachrichtSchreiben_(String(m.Name).trim(), String(an).trim(), t);
  return 'ok';
}

// Antwort auf eine Meldung, nur fuer Chef und Berechtigte
function meldungAntwort(token, eingang, text) {
  AKTUELL_ = token;
  const m = michSelbst();
  if (!m) throw new Error('Keine Berechtigung');
  const name = String(m.Name).trim();
  const darf = darfNachricht_(m);
  const t = String(text || '').trim();
  if (t.length < 2) throw new Error('Bitte eine Antwort schreiben');

  const sh = ss_().getSheetByName(MELD_TAB);
  const w = sh.getDataRange().getValues();
  const kopf = w[0].map(x => String(x).trim());
  const iE = kopf.indexOf('Eingang');
  const iA = kopf.indexOf('Antwort');
  const iV = kopf.indexOf('AntwortVon');
  const iD = kopf.indexOf('AntwortAm');
  if (iE < 0 || iA < 0) {
    throw new Error('Im Tab Meldung fehlen die Spalten Antwort, AntwortVon, AntwortAm');
  }
  const iAn = kopf.indexOf('An');
  const ziel = String(eingang).trim();
  for (let r = 1; r < w.length; r++) {
    if (String(w[r][iE]).trim() !== ziel) continue;
    if (!darf && !(iAn >= 0 && String(w[r][iAn]).trim() === name)) {
      throw new Error('Diese Nachricht ist nicht an dich gerichtet');
    }
    sh.getRange(r + 1, iA + 1).setValue(t);
    if (iV >= 0) sh.getRange(r + 1, iV + 1).setValue(String(m.Name).trim());
    if (iD >= 0) sh.getRange(r + 1, iD + 1).setNumberFormat('@').setValue(jetztText_());

    // Die Antwort ist fuer den Absender neu, also den Gesehen-Vermerk loeschen.
    var iG = kopf.indexOf('GesehenVon');
    if (iG >= 0) sh.getRange(r + 1, iG + 1).setValue('');

    cacheLeeren(MELD_TAB);
    return 'ok';
  }
  throw new Error('Meldung nicht gefunden');
}

// Interne Nachrichten verschwinden nicht mit dem Tageswechsel,
// sondern bleiben als Verlauf stehen.
const MELD_VERLAUF_TAGE = 60;

function meldungenVerlauf_() {
  const sh = ss_().getSheetByName(MELD_TAB);
  if (!sh || sh.getLastRow() < 2) return [];
  const grenze = new Date();
  grenze.setDate(grenze.getDate() - MELD_VERLAUF_TAGE);
  const ab = formatDatum(grenze);

  return leseTab(MELD_TAB)
    .filter(m => String(m.Von || '').trim() && formatDatum(m.Datum) >= ab)
    .map(m => ({
      eingang: String(m.Eingang || ''), datum: formatDatum(m.Datum),
      schule: String(m.Schule || '').trim(), klasse: String(m.Klasse || '').trim(),
      kind: String(m.Kind || '').trim(), art: String(m.Art || '').trim(),
      uhrzeit: planZeit_(m.Uhrzeit), nachricht: String(m.Nachricht || ''),
      gesehen: String(m.Gesehen || '').trim().toLowerCase() === 'ja',
      von: String(m.Von || '').trim(), an: String(m.An || '').trim(),
      antwort: String(m.Antwort || ''),
      antwortVon: String(m.AntwortVon || '').trim(),
      antwortAm: String(m.AntwortAm || '').trim(),
      gesehenVon: String(m.GesehenVon || '').trim()
    }))
    .sort((a, b) => String(b.eingang).localeCompare(String(a.eingang)));
}

// Meldungen je Kind für die Anzeige im Plan
function meldungKarte_(datum) {
  const raus = {};
  meldungenTag_(datum).filter(m => !m.von && m.kind).forEach(m => {
    const k = meldungKey_(m.kind, m.schule, m.klasse);
    (raus[k] = raus[k] || []).push({ art: m.art, uhrzeit: m.uhrzeit,
                                     nachricht: m.nachricht });
  });
  return raus;
}

// prüft nur, ob es das Kind gibt, ohne Angaben zurückzugeben
// Nur die Zahl der Klasse, also aus "2c" wird "2". Eltern wissen den
// Buchstaben oft nicht, die Stufe aber schon.
function klasseZahl_(k) {
  const m = String(k || '').trim().match(/\d+/);
  return m ? m[0] : '';
}

// Sucht ein Kind einer Schule allein ueber den Namen. Die Klasse ist
// freiwillig und wird erst gebraucht, wenn es den Namen mehrfach gibt.
function elternKindSuchen_(s, name, klasse) {
  const n = String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
  if (n.length < 3) {
    throw new Error('Bitte den Vor- und Nachnamen des Kindes eintragen');
  }

  const treffer = leseTab('Schueler').filter(x =>
    String(x.Schule).trim() === s.kuerzel &&
    (String(x.Vorname).trim() + ' ' + String(x.Nachname).trim()).toLowerCase() === n);

  if (!treffer.length) return { nichts: true };
  if (treffer.length === 1) return { kind: treffer[0] };

  const z = klasseZahl_(klasse);
  if (!z) {
    return { mehrere: true,
             klassen: eindeutig(treffer.map(x => klasseZahl_(x.Klasse)))
                        .filter(Boolean).sort() };
  }
  const eng = treffer.filter(x => klasseZahl_(x.Klasse) === z);
  if (eng.length === 1) return { kind: eng[0] };
  if (!eng.length) return { nichts: true };
  return { unklar: true };
}

function kindPruefen(code, name, klasse) {
  const s = schuleFuerCode_(code);
  if (!s) throw new Error('Kein Zugriff');

  const r = elternKindSuchen_(s, name, klasse);
  if (r.kind) {
    return { ok: true, klasse: String(r.kind.Klasse).trim() };
  }
  if (r.mehrere) {
    return { mehrere: true, klassen: r.klassen };
  }
  if (r.unklar) {
    throw new Error('Es gibt mehrere Kinder mit diesem Namen in derselben ' +
                    'Klassenstufe. Bitte rufen Sie uns kurz an.');
  }
  throw new Error('Wir konnten das Kind nicht finden. Bitte den Namen prüfen ' +
                  'oder uns anrufen.');
}

// Meldung von der Elternseite, ohne Anmeldung
function meldungSenden(code, d) {
  const s = schuleFuerCode_(code);
  if (!s) throw new Error('Kein Zugriff');

  const name = String(d.name || '').trim().replace(/\s+/g, ' ');
  const klasse = String(d.klasse || '').trim();
  const datum = String(d.datum || '').trim();
  const art = ['Entschuldigt', 'Frueher', 'Mitteilung'].indexOf(d.art) >= 0 ? d.art : 'Mitteilung';
  if (!datum) throw new Error('Bitte ein Datum wählen');

  // dieselbe Suche wie bei kindPruefen, damit beide gleich urteilen
  const r = elternKindSuchen_(s, name, klasse);
  if (r.mehrere) {
    throw new Error('Es gibt mehrere Kinder mit diesem Namen. Bitte die ' +
                    'Klassenstufe eintragen: ' + r.klassen.join(' oder '));
  }
  if (r.unklar) {
    throw new Error('Es gibt mehrere Kinder mit diesem Namen in derselben ' +
                    'Klassenstufe. Bitte rufen Sie uns kurz an.');
  }
  if (!r.kind) {
    throw new Error('Wir konnten das Kind nicht finden. Bitte den Namen prüfen ' +
                    'oder uns anrufen.');
  }
  const kind = r.kind;

  const sh = ss_().getSheetByName(MELD_TAB);
  if (!sh) throw new Error('Meldungen sind zurzeit nicht möglich');
  const kopf = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(x => String(x).trim());

  let text = String(d.nachricht || '').trim();
  const von = String(d.absender || '').trim();
  if (von) text += (text ? ' ' : '') + '(von ' + von + ')';

  const feld = {
    'Eingang': Utilities.formatDate(new Date(), 'Europe/Berlin', 'dd.MM.yyyy HH:mm'),
    'Datum': datum, 'Schule': s.kuerzel, 'Klasse': String(kind.Klasse).trim(),
    'Kind': String(kind.Vorname).trim() + ' ' + String(kind.Nachname).trim(),
    'Art': art, 'Uhrzeit': art === 'Frueher' ? String(d.uhrzeit || '').trim() : '',
    'Nachricht': text, 'Gesehen': ''
  };

  const nr = sh.getLastRow() + 1;
  ['Eingang', 'Uhrzeit', 'Datum'].forEach(n => {
    const i = kopf.indexOf(n); if (i >= 0) sh.getRange(nr, i + 1).setNumberFormat('@');
  });
  sh.getRange(nr, 1, 1, kopf.length)
    .setValues([kopf.map(k => feld[k] !== undefined ? feld[k] : '')]);

  cacheLeeren(MELD_TAB);
  return 'ok';
}

function darfAlleMeldungen_(m) {
  return istAdmin_(m) ||
         String(m.Meldung || '').trim().toLowerCase() === 'ja';
}

// Spalte Kinderschutz im Tab Mitarbeiter: sieht das ganze Team und
// bestaetigt, dass die Unterschrift im Buero angekommen ist
function darfKinderschutz_(m) {
  return istAdmin_(m) ||
         String(m.Kinderschutz || '').trim().toLowerCase() === 'ja';
}

// Spalte Nachricht im Tab Mitarbeiter: sieht alle internen Nachrichten
// und kann einzelnen Mitarbeitern schreiben
function darfNachricht_(m) {
  return istAdmin_(m) ||
         String(m.Nachricht || '').trim().toLowerCase() === 'ja';
}

function meldungGesehen(token, eingang, kind) {
  AKTUELL_ = token;
  const m = michSelbst();
  if (!m || !darfAlleMeldungen_(m)) throw new Error('Keine Berechtigung');

  const sh = ss_().getSheetByName(MELD_TAB);
  const w = sh.getDataRange().getValues();
  const kopf = w[0].map(x => String(x).trim());
  const iE = kopf.indexOf('Eingang'), iK = kopf.indexOf('Kind'), iG = kopf.indexOf('Gesehen');
  if (iG < 0) throw new Error('Spalte Gesehen fehlt');

  for (let r = 1; r < w.length; r++) {
    if (String(w[r][iE]).trim() !== String(eingang).trim()) continue;
    if (String(w[r][iK]).trim() !== String(kind).trim()) continue;
    sh.getRange(r + 1, iG + 1).setValue('ja');
    cacheLeeren(MELD_TAB);
    return 'ok';
  }
  throw new Error('Meldung nicht gefunden');
}


// ================= Abgemeldete Kinder =================
// Beim Abmelden wandert das Kind in den Tab Abgemeldet. Hier kann man es
// wieder anmelden: es wird neu in Schueler und Teilnehmer angelegt und die
// Zeile im Tab Abgemeldet faellt weg.

const ABG_TAB = 'Abgemeldet';

function abgemeldetListe(token) {
  AKTUELL_ = token;
  darfKinder_();
  const sh = ss_().getSheetByName(ABG_TAB);
  if (!sh || sh.getLastRow() < 2) return [];

  const w = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  const kopf = w[0].map(x => String(x).trim());
  const i = n => kopf.indexOf(n);
  const hol = (z, n) => { const k = i(n); return k >= 0 ? String(z[k]).trim() : ''; };

  const raus = [];
  for (let r = 1; r < w.length; r++) {
    const z = w[r];
    const vor = hol(z, 'Vorname'), nach = hol(z, 'Nachname');
    if (!vor && !nach) continue;
    raus.push({
      vorname: vor, nachname: nach, name: (vor + ' ' + nach).trim(),
      schule: hol(z, 'Schule'), klasse: hol(z, 'Klasse'),
      status: hol(z, 'Status') === 'BUT' ? 'BUT' : 'EZ',
      Mo: planZeit_(i('Mo') >= 0 ? z[i('Mo')] : ''),
      Di: planZeit_(i('Di') >= 0 ? z[i('Di')] : ''),
      Mi: planZeit_(i('Mi') >= 0 ? z[i('Mi')] : ''),
      Do: planZeit_(i('Do') >= 0 ? z[i('Do')] : ''),
      telefon: hol(z, 'Telefonnummer'), allein: hol(z, 'Darf allein'),
      am: i('Abgemeldet am') >= 0 ? formatDatum(z[i('Abgemeldet am')]) : '',
      grund: hol(z, 'Grund')
    });
  }
  return raus.sort((a, b) => String(b.am).localeCompare(String(a.am)));
}

// findet die Zeile im Tab Abgemeldet ueber Name, Schule, Klasse und Datum
function abgemeldetZeile_(sh, s) {
  const w = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  const kopf = w[0].map(x => String(x).trim());
  const i = n => kopf.indexOf(n);
  const gl = (a, b) => String(a).trim().toLowerCase() === String(b || '').trim().toLowerCase();
  for (let r = 1; r < w.length; r++) {
    const z = w[r];
    if (!gl(i('Vorname') >= 0 ? z[i('Vorname')] : '', s.vorname)) continue;
    if (!gl(i('Nachname') >= 0 ? z[i('Nachname')] : '', s.nachname)) continue;
    if (!gl(i('Schule') >= 0 ? z[i('Schule')] : '', s.schule)) continue;
    if (!gl(i('Klasse') >= 0 ? z[i('Klasse')] : '', s.klasse)) continue;
    if (s.am && i('Abgemeldet am') >= 0 &&
        formatDatum(z[i('Abgemeldet am')]) !== s.am) continue;
    return r + 1;
  }
  return -1;
}

function kindWiederAnmelden(token, schluessel, neu) {
  AKTUELL_ = token;
  darfKinder_();

  const sh = ss_().getSheetByName(ABG_TAB);
  if (!sh) throw new Error('Tab Abgemeldet fehlt');
  const r = abgemeldetZeile_(sh, schluessel || {});
  if (r < 0) throw new Error('Der Eintrag in Abgemeldet wurde nicht gefunden. ' +
                             'Bitte die Liste neu laden.');

  // erst anlegen. Geht das schief, bleibt die Zeile in Abgemeldet stehen.
  kindSpeichern(token, null, neu);
  sh.deleteRow(r);
  cacheLeeren();
  return 'ok';
}

// ================= Kinderschutz =================

const KS_TAB = 'Kinderschutz';

// Datei-IDs der beiden Unterlagen in Drive.
// In Drive Rechtsklick auf die Datei, Link kopieren, das Stück
// zwischen /d/ und /view hier eintragen. Beide Dateien müssen
// für "Jeder mit dem Link" freigegeben sein.
const KS_KONZEPT_ID = '';
const KS_MELDEBOGEN_ID = '';

// Link zum Lesen im Browser
function ksLink_(id) {
  return id ? 'https://drive.google.com/file/d/' + id + '/view' : '';
}

// Link zum Herunterladen, damit man die Unterlagen ausdrucken kann
function ksDownload_(id) {
  return id ? 'https://drive.google.com/uc?export=download&id=' + id : '';
}

function ksStandMap_() {
  const st = {};
  leseTab(KS_TAB).forEach(z => {
    const n = String(z.Name || '').trim();
    if (!n) return;
    st[n] = {
      bestaetigt: String(z.Bestaetigt || '').trim(),
      unterschrift: String(z.Unterschrift || '').trim(),
      erinnert: String(z.Erinnert || '').trim()
    };
  });
  return st;
}

function ksAktive_() {
  return leseTab('Mitarbeiter')
    .filter(x => String(x.Name || '').trim() &&
                 String(x.Aktiv || '').trim().toLowerCase() !== 'nein')
    .map(x => ({ name: String(x.Name).trim(), rolle: String(x.Rolle || '') }));
}

// "25.09.2026" -> 20260925, zum Vergleichen
function dmyZahl_(s) {
  const t = String(s || '').trim().match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  return t ? Number(t[3] + t[2] + t[1]) : 0;
}

// Farbe des Zeichens im Kopf:
//   rot    noch nicht bestaetigt, oder nach der Bestaetigung erneut erinnert
//   grau   bestaetigt, Unterschrift im Buero fehlt noch
//   weg    alles erledigt
function ksFarbe_(s) {
  s = s || {};
  if (!s.bestaetigt) return 'rot';
  if (s.erinnert && dmyZahl_(s.erinnert) >= dmyZahl_(s.bestaetigt)) return 'rot';
  return 'grau';
}

// kurzer Stand fuer das Zeichen im Kopf
function ksKurz_(m) {
  const name = String(m.Name).trim();
  const darf = darfKinderschutz_(m);
  const st = ksStandMap_();
  const meins = st[name] || {};
  const farbe = ksFarbe_(meins);

  if (darf) {
    const offen = ksAktive_().filter(p => !(st[p.name] || {}).unterschrift).length;
    return { darf: true, meins: !!meins.bestaetigt, farbe: farbe, offen: offen };
  }
  return { darf: false, meins: !!meins.bestaetigt, farbe: farbe,
           offen: farbe === 'rot' ? 1 : 0 };
}

function ksStand(token) {
  AKTUELL_ = token;
  const m = michSelbst();
  if (!m) throw new Error('Keine Berechtigung');

  const name = String(m.Name).trim();
  const darf = darfKinderschutz_(m);
  const st = ksStandMap_();

  let liste = [];
  if (darf) {
    liste = ksAktive_().map(p => {
      const s = st[p.name] || {};
      return { name: p.name, rolle: p.rolle,
               bestaetigt: s.bestaetigt || '',
               unterschrift: s.unterschrift || '',
               erinnert: s.erinnert || '' };
    }).sort((a, b) => {
      const r = x => x.unterschrift ? 2 : (x.bestaetigt ? 1 : 0);
      return r(a) - r(b) || a.name.localeCompare(b.name);
    });
  }

  const meins = st[name] || {};
  return {
    name: name, darf: darf,
    bestaetigt: meins.bestaetigt || '',
    unterschrift: meins.unterschrift || '',
    erinnert: meins.erinnert || '',
    farbe: ksFarbe_(meins),
    liste: liste,
    konzept: ksLink_(KS_KONZEPT_ID),
    meldebogen: ksLink_(KS_MELDEBOGEN_ID),
    konzeptDl: ksDownload_(KS_KONZEPT_ID),
    meldebogenDl: ksDownload_(KS_MELDEBOGEN_ID)
  };
}

// schreibt einen Wert in den Tab Kinderschutz, legt die Zeile bei Bedarf an
function ksSetz_(name, spalte, wert) {
  const sh = ss_().getSheetByName(KS_TAB);
  if (!sh) throw new Error('Tab ' + KS_TAB + ' fehlt');
  const w = sh.getDataRange().getValues();
  const kopf = w[0].map(x => String(x).trim());
  const iN = kopf.indexOf('Name');
  const iS = kopf.indexOf(spalte);
  if (iN < 0) throw new Error('Im Tab ' + KS_TAB + ' fehlt die Spalte Name');
  if (iS < 0) throw new Error('Im Tab ' + KS_TAB + ' fehlt die Spalte ' + spalte);

  const ziel = String(name).trim();
  for (let r = 1; r < w.length; r++) {
    if (String(w[r][iN]).trim() === ziel) {
      sh.getRange(r + 1, iS + 1).setNumberFormat('@').setValue(wert);
      cacheLeeren(KS_TAB);
      return;
    }
  }
  const neu = new Array(kopf.length).fill('');
  neu[iN] = ziel; neu[iS] = wert;
  const nr = sh.getLastRow() + 1;
  sh.getRange(nr, 1, 1, kopf.length).setNumberFormat('@').setValues([neu]);
  cacheLeeren(KS_TAB);
}

// der Mitarbeiter bestaetigt selbst
function ksBestaetigen(token, an) {
  AKTUELL_ = token;
  const m = michSelbst();
  if (!m) throw new Error('Keine Berechtigung');
  const heute = Utilities.formatDate(new Date(), 'Europe/Berlin', 'dd.MM.yyyy');
  const name = String(m.Name).trim();
  ksSetz_(name, 'Bestaetigt', an ? heute : '');
  if (an) ksSetz_(name, 'Erinnert', '');   // eine alte Erinnerung ist damit erledigt
  return 'ok';
}

// der Chef haakt ab, dass die Unterschrift im Buero angekommen ist
function ksUnterschrift(token, name, an) {
  AKTUELL_ = token;
  const m = michSelbst();
  if (!m || !darfKinderschutz_(m)) throw new Error('Keine Berechtigung');
  const heute = Utilities.formatDate(new Date(), 'Europe/Berlin', 'dd.MM.yyyy');
  ksSetz_(String(name).trim(), 'Unterschrift', an ? heute : '');
  return 'ok';
}

// Erinnerung als Nachricht in der App
function ksErinnern(token, name) {
  AKTUELL_ = token;
  const m = michSelbst();
  if (!m || !darfKinderschutz_(m)) throw new Error('Keine Berechtigung');

  nachrichtSchreiben_(String(m.Name).trim(), String(name).trim(),
    'Bitte das Kinderschutzkonzept und den Meldebogen lesen, ausdrucken, ' +
    'unterschreiben und im Büro abgeben. Danach in der App bestätigen.');

  const heute = Utilities.formatDate(new Date(), 'Europe/Berlin', 'dd.MM.yyyy');
  ksSetz_(String(name).trim(), 'Erinnert', heute);
  return 'ok';
}


// Namen, an die eine Nachricht gehen kann
function nachrichtEmpfaenger(token) {
  AKTUELL_ = token;
  const m = michSelbst();
  if (!m || !darfNachricht_(m)) throw new Error('Keine Berechtigung');
  const ich = String(m.Name).trim();
  const namen = leseTab('Mitarbeiter')
    .filter(x => String(x.Name || '').trim() &&
                 String(x.Name).trim() !== ich &&
                 String(x.Aktiv || '').trim().toLowerCase() !== 'nein')
    .map(x => String(x.Name).trim())
    .sort();
  // Alle steht oben. Eine Nachricht an Alle sehen alle aktiven Mitarbeiter.
  return ['Alle'].concat(namen);
}

// Mitteilung eines Mitarbeiters an die Leitung, ohne Bezug zu einem Kind
function mitteilungSenden(token, text) {
  AKTUELL_ = token;
  const m = michSelbst();
  if (!m) throw new Error('Keine Berechtigung');
  const t = String(text || '').trim();
  if (t.length < 3) throw new Error('Bitte schreib kurz, worum es geht');
  nachrichtSchreiben_(String(m.Name).trim(), '', t);
  return 'ok';
}


// der ganze Tagesplan, wird erst geholt, wenn jemand ihn aufklappt
function tagAlle(token, datum) {
  AKTUELL_ = token;
  const m = michSelbst();
  if (!m) throw new Error('Keine Berechtigung');
  const e = einsaetzeFuer_(datum);
  return { alle: e.einsaetze, freigegeben: e.freigegeben };
}
function loginMitGoogleKonto() {
  var email = '';
  try { email = Session.getActiveUser().getEmail() || ''; } catch (err) { email = ''; }

  if (!email) {
    // Das passiert bei jeder Adresse ausserhalb der Domain des Eigentuemers,
    // also bei allen privaten Gmail-Konten. Siehe Hinweis unten im Code.
    return {
      success: false,
      message: 'Google gibt deine Adresse an diese App nicht weiter. ' +
               'Bitte den persönlichen Link benutzen.'
    };
  }
  
  email = email.toLowerCase().trim();
  
  // Mitarbeiter in Tabelle suchen
  var alle = leseTab('Mitarbeiter');
  var m = alle.find(function(x) {
    var mMail = String(x.Email || x.email || x.EMAIL || '').toLowerCase().trim();
    return mMail === email;
  });
  
  if (!m) {
    return {
      success: false,
      message: 'Kein Zugriff: Das Konto ' + email + ' ist nicht in der Mitarbeiter-Tabelle eingetragen.'
    };
  }
  
  var aktiv = String(m.Aktiv || m.aktiv || 'ja').trim().toLowerCase();
  if (aktiv !== 'ja' && aktiv !== 'true') {
    return {
      success: false,
      message: 'Dein Zugang ist zurzeit deaktiviert. Bitte wende dich an die Leitung.'
    };
  }

  var token = String(m.Token || m.token || m.TOKEN || '').trim();
  if (!token) {
    return {
      success: false,
      message: 'Für ' + email + ' ist kein Token hinterlegt.'
    };
  }

  return {
    success: true,
    token: token
  };
}

// HINWEIS ZUM GOOGLE-LOGIN
// Session.getActiveUser().getEmail() liefert bei "Ausfuehren als: Ich" nur
// dann eine Adresse, wenn der Besucher in derselben Workspace-Domain ist wie
// der Eigentuemer. Private Gmail-Adressen bekommen immer einen leeren Wert.
// Dieser Login funktioniert deshalb nur fuer den Eigentuemer selbst.
// Fuer das Team braucht es ein anderes Verfahren, zum Beispiel E-Mail mit
// Einmal-Code.


// ================= Anmeldung mit E-Mail und Einmal-Code =================
//
// Ablauf:
//   1. Der Mitarbeiter gibt seine E-Mail ein  -> codeAnfordern()
//      Die Adresse muss im Tab Mitarbeiter in der Spalte Email stehen.
//      Er bekommt einen sechsstelligen Code per Mail.
//   2. Er gibt den Code ein                   -> codePruefen()
//      Stimmt der Code, wird eine Sitzung angelegt und die App mit
//      ?t=<Sitzung> geoeffnet.
//
// Der persoenliche Token aus der Spalte Token funktioniert weiterhin.
// Das ist der Entwicklerzugang: damit kommt man in jede Ansicht.

const CODE_MIN = 15;            // Gueltigkeit des Codes in Minuten
const CODE_MAX_VERSUCHE = 5;    // danach ist der Code verbrannt
const SITZUNG_TAGE = 30;        // solange bleibt man angemeldet
const CODE_MAX_TAG = 60;        // Bremse: so viele Codes am Tag, insgesamt

// Bremse gegen Missbrauch. Die Anmeldeseite liegt offen im Netz, also
// koennte jemand versuchen, ueber sie massenhaft Mails auszuloesen.
// Google erlaubt ohnehin nur 100 Mails am Tag, die wollen wir nicht
// verbrauchen lassen. Gibt true zurueck, wenn noch eine Mail erlaubt ist.
function mailBudget_() {
  var tag = Utilities.formatDate(new Date(), 'Europe/Berlin', 'yyyy-MM-dd');
  var k = 'MAILTAG_' + tag;
  var n = Number(props_().getProperty(k) || 0);
  if (n >= CODE_MAX_TAG) return false;
  props_().setProperty(k, String(n + 1));
  return true;
}

function props_() { return PropertiesService.getScriptProperties(); }

function appUrl_() {
  try { return ScriptApp.getService().getUrl() || ''; } catch (err) { return ''; }
}

function mailSchluessel_(email) {
  return 'CODE_' + Utilities.base64EncodeWebSafe(String(email).toLowerCase().trim());
}

function mitarbeiterNachMail_(email) {
  var e = String(email || '').toLowerCase().trim();
  if (!e) return null;
  return leseTab('Mitarbeiter').find(function (m) {
    var mm = String(m.Email || m.email || m.EMAIL || m['E-Mail'] || '')
               .toLowerCase().trim();
    return mm && mm === e;
  }) || null;
}

function istAktiv_(m) {
  var a = String(m.Aktiv || m.aktiv || 'ja').trim().toLowerCase();
  return a === 'ja' || a === 'true';
}

// ---------- Schritt 1: Code anfordern ----------
function codeAnfordern(email) {
  var e = String(email || '').toLowerCase().trim();
  if (e.indexOf('@') < 1 || e.indexOf('.') < 0) {
    return { ok: false, text: 'Bitte eine gültige E-Mail-Adresse eintragen.' };
  }

  var m = mitarbeiterNachMail_(e);

  // Ob es die Adresse gibt, wird bewusst nicht verraten. Sonst koennte
  // jemand ueber die Anmeldeseite herausfinden, wer bei uns arbeitet.
  if (m && istAktiv_(m)) {
    var k = mailSchluessel_(e);

    // hoechstens eine Mail pro Minute an dieselbe Adresse
    var alt = props_().getProperty(k);
    if (alt) {
      try {
        var a = JSON.parse(alt);
        if (a.gesendet && (Date.now() - a.gesendet) < 60 * 1000) {
          return { ok: true, text: 'Der Code ist schon unterwegs. Bitte kurz warten.' };
        }
      } catch (err) {}
    }

    // erst hier das Tagesbudget belasten, damit mehrfaches Tippen auf den
    // Knopf nichts verbraucht
    if (!mailBudget_()) {
      return { ok: false,
               text: 'Heute wurden schon sehr viele Codes angefordert. ' +
                     'Bitte wende dich an die Leitung.' };
    }

    var code = ('00000' + Math.floor(Math.random() * 1000000)).slice(-6);
    props_().setProperty(k, JSON.stringify({
      code: code,
      exp: Date.now() + CODE_MIN * 60 * 1000,
      versuche: 0,
      gesendet: Date.now()
    }));

    var vorname = String(m.Name || '').trim().split(' ')[0];
    MailApp.sendEmail({
      to: e,
      subject: 'Dein Anmeldecode: ' + code,
      body: 'Hallo ' + vorname + ',\n\n' +
            'dein Anmeldecode lautet:\n\n    ' + code + '\n\n' +
            'Er gilt ' + CODE_MIN + ' Minuten.\n\n' +
            'Wenn du dich gerade nicht angemeldet hast, kannst du diese ' +
            'Nachricht einfach löschen.\n\n' +
            'PGM Bildungszentrum'
    });
  }

  return { ok: true,
           text: 'Wenn die Adresse bei uns hinterlegt ist, kommt gleich eine ' +
                 'Mail mit deinem Code. Schau auch im Spam-Ordner nach.' };
}

// ---------- Schritt 2: Code pruefen ----------
function codePruefen(email, code) {
  var e = String(email || '').toLowerCase().trim();
  var c = String(code || '').replace(/[^0-9]/g, '');
  var k = mailSchluessel_(e);

  var raw = props_().getProperty(k);
  if (!raw) {
    return { ok: false, text: 'Es liegt kein Code vor. Bitte neu anfordern.' };
  }

  var d;
  try { d = JSON.parse(raw); }
  catch (err) {
    props_().deleteProperty(k);
    return { ok: false, text: 'Bitte einen neuen Code anfordern.' };
  }

  if (Date.now() > d.exp) {
    props_().deleteProperty(k);
    return { ok: false, text: 'Der Code ist abgelaufen. Bitte neu anfordern.' };
  }

  if (String(d.code) !== c) {
    d.versuche = (d.versuche || 0) + 1;
    if (d.versuche >= CODE_MAX_VERSUCHE) {
      props_().deleteProperty(k);
      return { ok: false, text: 'Zu viele Versuche. Bitte einen neuen Code anfordern.' };
    }
    props_().setProperty(k, JSON.stringify(d));
    return { ok: false,
             text: 'Der Code stimmt nicht. Noch ' +
                   (CODE_MAX_VERSUCHE - d.versuche) + ' Versuche.' };
  }

  var m = mitarbeiterNachMail_(e);
  if (!m || !istAktiv_(m)) {
    props_().deleteProperty(k);
    return { ok: false, text: 'Kein Zugriff. Bitte wende dich an die Leitung.' };
  }

  props_().deleteProperty(k);
  var s = sitzungAnlegen_(String(m.Name).trim());
  var basis = appUrl_();

  // admin sagt der Anmeldeseite, welche Seite sie oeffnen soll.
  // Im alten Apps-Script-Betrieb entscheidet das weiter doGet.
  return { ok: true, sitzung: s,
           admin: istAdmin_(m),
           url: basis ? (basis + '?t=' + encodeURIComponent(s)) : '' };
}

// ---------- Sitzungen ----------
function sitzungAnlegen_(name) {
  var s = 's' + Utilities.getUuid().replace(/-/g, '');
  props_().setProperty('SESS_' + s, JSON.stringify({
    name: name,
    seit: Date.now(),
    exp: Date.now() + SITZUNG_TAGE * 24 * 60 * 60 * 1000
  }));
  return s;
}

function sitzungName_(s) {
  var t = String(s || '').trim();
  if (t.indexOf('s') !== 0 || t.length < 20) return null;   // spart den Zugriff
  var raw = props_().getProperty('SESS_' + t);
  if (!raw) return null;
  try {
    var d = JSON.parse(raw);
    if (Date.now() > d.exp) { props_().deleteProperty('SESS_' + t); return null; }
    return d.name;
  } catch (err) { return null; }
}

function abmelden(token) {
  var t = String(token || '').trim();
  if (t) props_().deleteProperty('SESS_' + t);
  return 'ok';
}

// Raeumt abgelaufene Codes und Sitzungen weg.
// Am besten einmal pro Nacht ueber einen Zeit-Trigger laufen lassen.
function sitzungenAufraeumen() {
  var p = props_();
  var alle = p.getProperties();
  var jetzt = Date.now(), weg = 0;
  var vor60 = new Date(); vor60.setDate(vor60.getDate() - 60);
  var grenzeTag = Utilities.formatDate(vor60, 'Europe/Berlin', 'yyyy-MM-dd');
  Object.keys(alle).forEach(function (k) {
    // Tageszaehler 60 Tage aufheben, damit man sehen kann, ob jemand
    // ueber die Anmeldeseite massenhaft Mails ausloest.
    if (k.indexOf('MAILTAG_') === 0) {
      if (k.slice(8) < grenzeTag) { p.deleteProperty(k); weg++; }
      return;
    }
    if (k.indexOf('SESS_') !== 0 && k.indexOf('CODE_') !== 0) return;
    try {
      var d = JSON.parse(alle[k]);
      if (d && d.exp && jetzt > d.exp) { p.deleteProperty(k); weg++; }
    } catch (err) { p.deleteProperty(k); weg++; }
  });
  Logger.log(weg + ' abgelaufene Einträge entfernt');
  return weg;
}


// Merkt sich, dass diese Person die internen Nachrichten gesehen hat.
// Dafuer braucht der Tab Meldung die Spalte GesehenVon. Darin steht eine
// Namensliste, mit Komma getrennt.
function internGesehen(token) {
  AKTUELL_ = token;
  const m = michSelbst();
  if (!m) throw new Error('Keine Berechtigung');
  const name = String(m.Name).trim();

  const sh = ss_().getSheetByName(MELD_TAB);
  if (!sh || sh.getLastRow() < 2) return 'ok';

  const kopf = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
                 .map(x => String(x).trim());
  const iG = kopf.indexOf('GesehenVon');
  if (iG < 0) return 'ok';               // Spalte fehlt, dann eben nicht
  const iVon = kopf.indexOf('Von');
  const iAn = kopf.indexOf('An');
  const iAntw = kopf.indexOf('Antwort');

  const n = sh.getLastRow() - 1;
  const breite = Math.max(iG, iVon, iAn, iAntw) + 1;
  const werte = sh.getRange(2, 1, n, breite).getValues();

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const spalte = [];
    let geaendert = false;

    for (let r = 0; r < n; r++) {
      let jetzt = String(werte[r][iG] || '');
      const von = iVon >= 0 ? String(werte[r][iVon]).trim() : '';
      const an = iAn >= 0 ? String(werte[r][iAn]).trim() : '';
      const antwort = iAntw >= 0 ? String(werte[r][iAntw]).trim() : '';

      const betrifftMich = von && (an === name || an === 'Alle' ||
                                   (von === name && antwort));
      if (betrifftMich) {
        const liste = jetzt.split(',').map(x => x.trim()).filter(Boolean);
        if (liste.indexOf(name) < 0) {
          liste.push(name);
          jetzt = liste.join(', ');
          geaendert = true;
        }
      }
      spalte.push([jetzt]);
    }

    if (geaendert) {
      sh.getRange(2, iG + 1, n, 1).setValues(spalte);
      cacheLeeren(MELD_TAB);
    }
  } finally {
    lock.releaseLock();
  }
  return 'ok';
}


// ================= Zentrale fuer die Seiten auf GitHub =================
// Liegt die Oberflaeche nicht mehr in Apps Script, kann sie kein
// google.script.run mehr benutzen. Stattdessen schickt sie ein JSON-Paket
// an diese eine Stelle:  { fn: 'meinTag', args: ['sc123...', '2026-09-28'] }
// Hier wird geprueft, ob der Name in der Liste steht, dann wird die
// Funktion aufgerufen und das Ergebnis als JSON zurueckgegeben.
//
// Wichtig: Apps Script antwortet nicht auf die Vorabfrage OPTIONS.
// Deshalb schickt die Seite den Inhaltstyp text/plain. Das gilt als
// einfache Anfrage, dann fragt der Browser nicht vorher nach.
//
// Die Rechte pruefen weiter die Funktionen selbst ueber den Token.
// Diese Liste sagt nur, welche Namen ueberhaupt aufgerufen werden duerfen.

const API_ERLAUBT = [
  'abgemeldetListe', 'abmelden', 'abrechnungPdf', 'abwesendHinzu',
  'abwesendLoeschen', 'abwesendZeitraumLoeschen',
  'codeAnfordern', 'codePruefen', 'ehrenFuer', 'ehrenHinzu', 'ehrenLoeschen',
  'elternStart', 'festHinzu', 'festLoeschen', 'internGesehen', 'kindAbmelden',
  'kindPruefen', 'kindSpeichern', 'kindWiederAnmelden', 'kinderDaten',
  'kinderStamm', 'kinderSuche',
  'ksBestaetigen', 'ksErinnern', 'ksStand', 'ksUnterschrift', 'ladeDashboard',
  'ladeTag', 'loescheAbwesend', 'loescheTag', 'meinTag', 'meineAbwesenheiten',
  'meldeAbwesend', 'meldungAntwort', 'meldungGesehen', 'meldungIntern',
  'meineAbrechnung',
  'meldungSenden', 'mitarbeiterSpeichern', 'mitteilungSenden', 'monatBerechnen',
  'monatPerson', 'monatPersonPdf',
  'monatSpeichern', 'nachrichtEmpfaenger', 'nachrichtSenden', 'personSpeichern',
  'setzeAktiv', 'setzeAnwesend', 'setzeKinderRecht', 'setzeTeamRecht',
  'speicherePlan', 'speichereVerfuegbarkeit', 'tagAlle',
  'teamListe', 'werBinIch'
];

function doPost(e) {
  var antwort;
  try {
    var roh = (e && e.postData && e.postData.contents) || '{}';
    var p = JSON.parse(roh);
    var fn = String(p.fn || '');
    var args = Array.isArray(p.args) ? p.args : [];

    if (API_ERLAUBT.indexOf(fn) < 0) throw new Error('Unbekannter Aufruf: ' + fn);
    var f = globalThis[fn];
    if (typeof f !== 'function') throw new Error('Funktion fehlt: ' + fn);

    antwort = { ok: true, wert: jsonFest_(f.apply(null, args)) };
  } catch (err) {
    antwort = { ok: false, fehler: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(antwort))
           .setMimeType(ContentService.MimeType.JSON);
}

// Datumswerte werden zu Text im Format yyyy-MM-dd. Sonst kaeme im Browser
// etwas anderes an als vorher ueber google.script.run.
function jsonFest_(x) {
  if (x === undefined || x === null) return null;
  if (x instanceof Date) return formatDatum(x);
  if (Array.isArray(x)) return x.map(jsonFest_);
  if (typeof x === 'object') {
    var raus = {};
    Object.keys(x).forEach(function (k) { raus[k] = jsonFest_(x[k]); });
    return raus;
  }
  return x;
}

// Die Seite auf GitHub bekommt Name und Rolle nicht mehr vom Server
// mitgeliefert, also fragt sie einmal beim Start nach.
function werBinIch(token) {
  AKTUELL_ = token;
  var m = michSelbst();
  if (!m) throw new Error('Kein Zugriff');
  return {
    name: String(m.Name || '').trim(),
    admin: istAdmin_(m)
  };
}

// Name der Schule fuer die Elternseite
function elternStart(code) {
  var s = schuleFuerCode_(code);
  if (!s) throw new Error('Kein Zugriff');
  return { schule: s.name, kuerzel: s.kuerzel };
}


// ================= Hilfe bei der Fehlersuche =================
// Im Editor aufrufen: pruefeZugang('DEIN_TOKEN_AUS_DER_ADRESSE')
// Schreibt ins Protokoll, was der Server mit dem Token anfangen kann.
// Danach diese Funktion ruhig wieder loeschen.
function pruefeZugang(token) {
  var t = String(token || '').trim();
  Logger.log('Token: [' + t + ']   Laenge: ' + t.length);
  Logger.log('Tabelle: ' + SHEET_ID);

  var name = sitzungName_(t);
  Logger.log('Als Sitzung gespeicherter Name: ' + (name ? '[' + name + ']' : 'keine Sitzung'));

  var m = findeToken(t);
  if (!m) {
    Logger.log('>>> findeToken findet zu diesem Token NIEMANDEN.');
    var alle = leseTab('Mitarbeiter');
    Logger.log('Zeilen im Tab Mitarbeiter: ' + alle.length);
    alle.slice(0, 6).forEach(function (x) {
      Logger.log('   Name=[' + x.Name + ']  Token=[' + x.Token +
                 ']  Aktiv=[' + x.Aktiv + ']  Rolle=[' + x.Rolle + ']');
    });
    return;
  }

  Logger.log('Gefunden: [' + m.Name + ']');
  Logger.log('Rolle steht in der Tabelle als: [' + m.Rolle + ']');
  Logger.log('   gilt als admin? ' + istAdmin_(m));
  Logger.log('Aktiv: [' + m.Aktiv + ']');
  Logger.log('Kinder=[' + m.Kinder + ']  Mitarbeiter=[' + m.Mitarbeiter +
             ']  Meldung=[' + m.Meldung + ']  Nachricht=[' + m.Nachricht +
             ']  Kinderschutz=[' + m.Kinderschutz + ']');

  AKTUELL_ = t;
  ['nurAdmin', 'ladeTag', 'meinTag'].forEach(function (was) {
    try {
      if (was === 'nurAdmin') nurAdmin();
      else if (was === 'ladeTag') ladeTag(t, formatDatum(new Date()));
      else meinTag(t, formatDatum(new Date()));
      Logger.log(was + ': ok');
    } catch (e) {
      Logger.log(was + ': FEHLER -> ' + e.message);
    }
  });
}

// Zeigt, welcher Inhalt in welcher Datei steckt und welches doGet laeuft.
// Im Editor ausfuehren, dann ins Protokoll schauen.
function welcheSeiten() {
  var marken = [['werGruss', 'PLANER'], ['tabPlan', 'BETREUER'],
                ['zurueckZu1', 'ANMELDUNG'], ['schulName', 'ELTERN']];

  ['Planer', 'Betreuer', 'Index', 'Eltern'].forEach(function (n) {
    var s;
    try { s = HtmlService.createHtmlOutputFromFile(n).getContent(); }
    catch (e) { Logger.log('Datei ' + n + ': fehlt oder nicht lesbar'); return; }
    var was = 'unbekannt';
    for (var i = 0; i < marken.length; i++) {
      if (s.indexOf('id="' + marken[i][0] + '"') >= 0 ||
          s.indexOf("'" + marken[i][0] + "'") >= 0 ||
          s.indexOf('function ' + marken[i][0]) >= 0) { was = marken[i][1]; break; }
    }
    Logger.log('Datei "' + n + '" enthaelt: ' + was + '   (' + s.length + ' Zeichen)');
  });

  var d = String(doGet);
  Logger.log('Aktives doGet beginnt mit: ' +
             d.slice(0, 140).replace(/\s+/g, ' '));
  Logger.log(d.indexOf('parameter.e') >= 0
    ? 'Das ist das doGet aus WebApp. Richtig.'
    : '>>> Das ist NICHT das doGet aus WebApp. In Code.gs steht noch ein zweites.');
}
// ---------- Anmeldungen nachsehen ----------
// Im Editor ausfuehren. Zeigt, wie viele Anmeldecodes verschickt wurden,
// wie viele gerade offen sind und wie viele Leute angemeldet sind.
function codeStatistik() {
  var alle = props_().getProperties();
  var heute = Utilities.formatDate(new Date(), 'Europe/Berlin', 'yyyy-MM-dd');
  var tage = [], offen = 0, sitzungen = 0, jetzt = Date.now();

  Object.keys(alle).forEach(function (k) {
    if (k.indexOf('MAILTAG_') === 0) {
      tage.push([k.slice(8), Number(alle[k] || 0)]);
    } else if (k.indexOf('CODE_') === 0) {
      try { if (JSON.parse(alle[k]).exp > jetzt) offen++; } catch (e) {}
    } else if (k.indexOf('SESS_') === 0) {
      try { if (JSON.parse(alle[k]).exp > jetzt) sitzungen++; } catch (e) {}
    }
  });

  tage.sort(function (a, b) { return a[0] < b[0] ? 1 : -1; });

  Logger.log('=== Anmeldecodes ===');
  if (!tage.length) Logger.log('Noch keine verschickt.');
  var summe = 0;
  tage.forEach(function (t) {
    summe += t[1];
    Logger.log('  ' + t[0] + ':  ' + t[1] + ' Mails' +
               (t[0] === heute ? '   (heute, noch ' + (CODE_MAX_TAG - t[1]) +
                                 ' von ' + CODE_MAX_TAG + ' frei)' : ''));
  });
  Logger.log('  --------');
  Logger.log('  insgesamt: ' + summe + ' Mails an ' + tage.length + ' Tagen');
  Logger.log('');
  Logger.log('Gerade offene Codes (noch nicht eingegeben): ' + offen);
  Logger.log('Angemeldete Mitarbeiter (gueltige Sitzungen): ' + sitzungen);
  return { tage: tage, offen: offen, sitzungen: sitzungen };
}

// Wer ist gerade angemeldet und wer fehlt noch?
// Im Editor ausfuehren, dann ins Protokoll schauen.
function werIstAngemeldet() {
  var da = angemeldetNamen_();

  var namen = Object.keys(da).sort();
  Logger.log('===== angemeldet: ' + namen.length + ' =====');
  namen.forEach(function (n) {
    var e = da[n];
    Logger.log('   ' + n +
      (e.geraete > 1 ? '   (' + e.geraete + ' Geräte)' : '') +
      (e.seit ? '   seit ' +
        Utilities.formatDate(new Date(e.seit), 'Europe/Berlin', 'dd.MM. HH:mm') : ''));
  });

  var offen = leseTab('Mitarbeiter').filter(function (m) {
    var n = String(m.Name || '').trim();
    return n && istAktiv_(m) && !istAdmin_(m) && !da[n];
  });

  Logger.log('');
  Logger.log('===== noch nicht angemeldet: ' + offen.length + ' =====');
  offen.forEach(function (m) {
    var mail = String(m.Email || m.email || '').trim();
    Logger.log('   ' + String(m.Name).trim() +
               (mail ? '   ' + mail : '   >>> KEINE E-MAIL IN DER TABELLE'));
  });

  return namen.length;
}

// ===== Taegliche Sicherung des Tabs Plan =====
// Einmal pro Nacht ueber einen Zeit-Trigger laufen lassen. Legt eine Kopie
// des Tabs Plan an und haelt die letzten 7 Kopien vor.
function planSichern() {
  const ss = ss_();
  const sh = ss.getSheetByName('Plan');
  if (!sh) return 'Tab Plan fehlt';

  const heute = Utilities.formatDate(new Date(), 'Europe/Berlin', 'yyyy-MM-dd');
  const name = 'Sicherung Plan ' + heute;

  const alt = ss.getSheetByName(name);
  if (alt) ss.deleteSheet(alt);
  sh.copyTo(ss).setName(name).hideSheet();

  // aeltere Sicherungen wegraeumen, die letzten sieben bleiben
  const kopien = ss.getSheets()
    .map(s => s.getName())
    .filter(n => n.indexOf('Sicherung Plan ') === 0)
    .sort();
  while (kopien.length > 7) {
    const weg = ss.getSheetByName(kopien.shift());
    if (weg) ss.deleteSheet(weg);
  }
  return name + ' angelegt';
}
