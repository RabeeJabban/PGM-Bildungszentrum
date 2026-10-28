function zeitMin_(v) {
  if (v instanceof Date) {
    return minuten(Utilities.formatDate(v, ss_().getSpreadsheetTimeZone(), 'HH:mm'));
  }
  return minuten(String(v || '').trim());
}

function monatText_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, ss_().getSpreadsheetTimeZone(), 'yyyy-MM');
  }
  return String(v || '').trim();
}

function monatName_(monat) {
  const n = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli',
             'August', 'September', 'Oktober', 'November', 'Dezember'];
  const t = String(monat).split('-');
  const i = parseInt(t[1], 10) - 1;
  return (n[i] || monat) + ' ' + t[0];
}

function euro_(x) {
  return (Math.round(x * 100) / 100).toFixed(2).replace('.', ',') + ' €';
}

// monat ist entweder "2026-09" oder ein Zeitraum {von:"2026-09-01", bis:"2026-09-15"}
function zeitraumPruefer_(monat) {
  if (monat && typeof monat === 'object' && monat.von && monat.bis) {
    const v = String(monat.von), b = String(monat.bis);
    return d => d >= v && d <= b;
  }
  const m = String(monat);
  return d => d.indexOf(m) === 0;
}

function zeitraumText_(monat) {
  if (monat && typeof monat === 'object' && monat.von && monat.bis) {
    const t = d => { const x = String(d).split('-');
                     return x[2] + '.' + x[1] + '.' + x[0]; };
    return t(monat.von) + ' bis ' + t(monat.bis);
  }
  return monatName_(String(monat));
}

// Rechnet den Zeitraum durch. Gibt immer die Liste aller Personen zurueck.
// Steht in detailFuer ein Name, wird zusaetzlich jede einzelne Zeile dieser
// Person mitgeschrieben. Gesamt- und Einzelabrechnung kommen so aus derselben
// Rechnung und koennen nicht auseinanderlaufen.
function monatRechnen_(monat, detailFuer) {
  const passt = zeitraumPruefer_(monat);
  const zeilen = leseTab('Plan').filter(z =>
    passt(formatDatum(z.Datum)) && String(z.Status) === 'Freigegeben');

  const nach = {}, prakt = {}, iban = {}, hinweis = {};
  leseTab('Mitarbeiter').forEach(m => {
    const n = String(m.Name).trim();
    nach[n] = String(m.Nachname || '').trim();
    iban[n] = String(m.IBAN || '').trim();
    hinweis[n] = String(m.Hinweis || '').trim();
    if (rolle_(m) === 'praktikant') prakt[n] = true;
  });

  const summe = {};
  const tage = {};             // "Name|Datum" -> Einsätze mit Uhrzeit
  const detail = [];           // nur fuer detailFuer
  const ziel = String(detailFuer || '').trim();

  const neu = name => {
    if (!summe[name]) {
      summe[name] = { name: name, nachname: nach[name] || '',
                      iban: iban[name] || '', hinweis: hinweis[name] || '',
                      abhol: 0, ez: 0, empfang: 0, but: 0, warte: 0,
                      betrag: 0, ohneZeit: 0 };
    }
    return summe[name];
  };

  const merke = (name, d) => { if (ziel && name === ziel) detail.push(d); };

  zeilen.forEach(z => {
    const aufgabe = String(z.Aufgabe);
    const von = zeitMin_(z.Von), bis = zeitMin_(z.Bis);
    const tag = formatDatum(z.Datum);
    const schule = String(z.Schule || '').trim();
    const gruppe = String(z.Gruppe || '').trim();

    String(z.Mitarbeiter || '').split(',').map(s => s.trim()).filter(Boolean)
      .forEach(name => {
        if (prakt[name]) return;
        const s = neu(name);

        if (von > 0 && bis > von) {
          const key = name + '|' + tag;
          (tage[key] = tage[key] || []).push({ art: aufgabe, von: von, bis: bis,
                                               schule: schule, gruppe: gruppe,
                                               tag: tag });
          return;
        }

        // Zeile ohne Uhrzeit: nach Standarddauer bezahlen
        s.ohneZeit++;
        let std = 0, eh = 0, bet = 0;
        if (aufgabe === 'Abholung') {
          std = ABHOL_DAUER / 60; bet = std * SATZ_STUNDE; s.abhol += std;
        } else if (aufgabe === 'EZ') {
          std = BLOCK_DAUER / 60; bet = std * SATZ_STUNDE; s.ez += std;
        } else if (aufgabe === 'BUT') {
          eh = EINHEITEN_PRO_BUT; bet = eh * SATZ_EINHEIT; s.but += eh;
        }
        // Empfang ohne Uhrzeit lässt sich nicht berechnen
        s.betrag += bet;
        if (std || eh) {
          merke(name, { datum: tag, schule: schule, aufgabe: aufgabe,
                        gruppe: gruppe, von: '', bis: '', stunden: std,
                        einheiten: eh, betrag: bet, _s: '98:00',
                        bemerkung: 'ohne Uhrzeit, Standarddauer' });
        }
      });
  });

  // je Person und Tag: Abholung 45 Minuten, wenn nichts direkt folgt
  Object.keys(tage).forEach(key => {
    const name = key.split('|')[0];
    const s = summe[name];
    const l = tage[key].sort((a, b) => a.von - b.von);

    const ende = l.map((x, i) => {
      if (x.art !== 'Abholung') return x.bis;
      let naechst = null;
      l.forEach((y, j) => {
        if (j !== i && y.von >= x.bis && (naechst === null || y.von < naechst)) {
          naechst = y.von;
        }
      });
      let e = x.bis + 15;
      if (naechst !== null && naechst < e) e = naechst;
      return e < x.bis ? x.bis : e;
    });

    l.forEach((x, i) => {
      let std = 0, eh = 0, bet = 0, bisM = x.bis, bem = '';
      if (x.art === 'Abholung') {
        std = (ende[i] - x.von) / 60; bet = std * SATZ_STUNDE; s.abhol += std;
        bisM = ende[i];
        if (ende[i] !== x.bis) bem = 'bezahlt bis ' + hhmm_(ende[i]);
      } else if (x.art === 'EZ') {
        std = (x.bis - x.von) / 60; bet = std * SATZ_STUNDE; s.ez += std;
      } else if (x.art === 'BUT') {
        eh = EINHEITEN_PRO_BUT; bet = eh * SATZ_EINHEIT; s.but += eh;
      } else if (x.art === 'Empfang') {
        std = (x.bis - x.von) / 60; bet = std * SATZ_STUNDE; s.empfang += std;
      }
      s.betrag += bet;
      merke(name, { datum: x.tag, schule: x.schule, aufgabe: x.art,
                    gruppe: x.gruppe, von: hhmm_(x.von), bis: hhmm_(bisM),
                    stunden: std, einheiten: eh, betrag: bet,
                    _s: hhmm_(x.von), bemerkung: bem });
    });

    // Wartezeit zwischen den Einsätzen, auf Basis der verlängerten Abholungen
    let lauf = ende[0], luecke = 0;
    for (let i = 1; i < l.length; i++) {
      if (l[i].von > lauf) luecke += l[i].von - lauf;
      if (ende[i] > lauf) lauf = ende[i];
    }
    if (luecke > 0) {
      s.warte += luecke / 60;
      s.betrag += (luecke / 60) * SATZ_STUNDE;
      merke(name, { datum: l[0].tag, schule: '', aufgabe: 'Wartezeit',
                    gruppe: '', von: '', bis: '', stunden: luecke / 60,
                    einheiten: 0, betrag: (luecke / 60) * SATZ_STUNDE,
                    _s: '99:00', bemerkung: 'Lücke zwischen den Einsätzen' });
    }
  });

  const r2 = x => Math.round(x * 100) / 100;
  const liste = Object.keys(summe).map(n => {
    const s = summe[n];
    return {
      name: s.name, nachname: s.nachname,
      iban: s.iban, hinweis: s.hinweis,
      abhol: r2(s.abhol), ez: r2(s.ez), empfang: r2(s.empfang),
      warte: r2(s.warte), but: s.but,
      stunden: r2(s.abhol + s.ez + s.empfang + s.warte + s.but * 0.75),
      betrag: r2(s.betrag),
      ohneZeit: s.ohneZeit
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  detail.sort((a, b) => String(a.datum).localeCompare(String(b.datum)) ||
                        String(a._s || '').localeCompare(String(b._s || '')));
  detail.forEach(d => { delete d._s; });
  return { liste: liste, detail: detail };
}

function monatBerechnen(token, monat) {
  AKTUELL_ = token;
  nurAdmin();
  return monatRechnen_(monat, null).liste;
}

// Eine einzelne Person mit allen Einsätzen, fuer Rückfragen zum Lohn
function monatPerson(token, monat, name) {
  AKTUELL_ = token;
  nurAdmin();
  const n = String(name || '').trim();
  if (!n) throw new Error('Kein Mitarbeiter gewählt');
  const r = monatRechnen_(monat, n);
  const p = r.liste.find(x => x.name === n);
  if (!p) {
    throw new Error('Für ' + n + ' gibt es in diesem Zeitraum keine freigegebenen Einsätze.');
  }
  return { person: p, zeilen: r.detail, zeitraum: zeitraumText_(monat) };
}

// Die eigene Abrechnung, fuer den Reiter Abrechnung in Mein PGM.
// Kein Admin-Recht noetig, aber der Name kommt aus dem Token und nicht
// vom Client. Jeder sieht also nur sich selbst.
function meineAbrechnung(token, monat) {
  AKTUELL_ = token;
  const m = michSelbst();
  if (!m) throw new Error('Keine Berechtigung');
  const n = String(m.Name).trim();
  const zeit = zeitraumText_(monat);

  if (rolle_(m) === 'praktikant') {
    return { leer: true, name: n, zeitraum: zeit, praktikant: true };
  }

  const r = monatRechnen_(monat, n);
  const p = r.liste.find(x => x.name === n);
  if (!p) return { leer: true, name: n, zeitraum: zeit };

  // IBAN und der interne Hinweis gehen den Mitarbeiter hier nichts an
  return {
    zeitraum: zeit,
    person: {
      name: p.name, nachname: p.nachname,
      abhol: p.abhol, ez: p.ez, empfang: p.empfang, warte: p.warte,
      but: p.but, stunden: p.stunden, betrag: p.betrag, ohneZeit: p.ohneZeit
    },
    zeilen: r.detail
  };
}

function monatSpeichern(token, monat, daten) {
  AKTUELL_ = token;
  nurAdmin();

  const sh = ss_().getSheetByName('Stunden');
  const werte = sh.getDataRange().getValues();
  const kopf = werte.shift().map(k => String(k).trim());
  const iM = kopf.indexOf('Monat');

  const andere = werte
    .filter(z => z.join('') !== '' && monatText_(z[iM]) !== monat)
    .map(z => { z[iM] = monatText_(z[iM]); return z; });

  const neu = daten.map(d => {
    const feld = {
      'Monat': monat, 'Mitarbeiter': d.name, 'Nachname': d.nachname || '',
      'Abhol_Std': d.abhol, 'EZ_Std': d.ez, 'Empfang_Std': d.empfang || 0,
      'Warte_Std': d.warte,
      'BUT_Einheiten': d.but, 'Std_Gesamt': d.stunden, 'Betrag': d.betrag
    };
    return kopf.map(k => feld[k] !== undefined ? feld[k] : '');
  });

  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, kopf.length).clearContent();
  }

  const alle = andere.concat(neu);
  if (alle.length) {
    sh.getRange(2, iM + 1, alle.length).setNumberFormat('@');
    sh.getRange(2, 1, alle.length, kopf.length).setValues(alle);
    const iB = kopf.indexOf('Betrag');
    if (iB >= 0) sh.getRange(2, iB + 1, alle.length).setNumberFormat('#,##0.00 €');
  }

  cacheLeeren('Stunden');
  return 'ok';
}

// ---------- PDF ----------

// Immer derselbe Ordner. Beim ersten Mal wird seine ID gemerkt, danach wird
// nur noch diese ID benutzt. So landen alle PDFs an einer Stelle, auch wenn
// im Drive irgendwann ein zweiter Ordner mit demselben Namen auftaucht.
function ordnerHolen_(name) {
  const p = props_();
  const schl = 'ORDNER_' + name;
  const id = p.getProperty(schl);

  if (id) {
    try {
      const o = DriveApp.getFolderById(id);
      if (!o.isTrashed()) return o;
    } catch (e) { /* ID taugt nicht mehr, unten neu suchen */ }
  }

  const it = DriveApp.getFoldersByName(name);
  while (it.hasNext()) {
    const o = it.next();
    if (!o.isTrashed()) { p.setProperty(schl, o.getId()); return o; }
  }

  const neu = DriveApp.createFolder(name);
  p.setProperty(schl, neu.getId());
  return neu;
}

// zeigt im Apps-Script-Editor, welcher Ordner benutzt wird
function abrechnungOrdner() {
  const o = ordnerHolen_('PGM Abrechnungen');
  Logger.log('Ordner: %s', o.getUrl());
  Logger.log('Dateien darin: %s', (function () {
    let n = 0; const it = o.getFiles(); while (it.hasNext()) { it.next(); n++; } return n;
  })());
  return o.getUrl();
}

function abrechnungPdf(token, monat, daten, extra) {
  AKTUELL_ = token;
  nurAdmin();
  if (!daten || !daten.length) throw new Error('Erst berechnen');

  let summe = 0;
  let reihen = '';
  daten.forEach(d => {
    summe += d.betrag;
    reihen += '<tr><td>' + d.name +
              (d.hinweis ? '<div class="hw">' + d.hinweis + '</div>' : '') +
              '</td><td>' + (d.nachname || '') +
              '</td><td class="ib">' + (d.iban || '') +
              '</td><td class="r">' + euro_(d.betrag) + '</td></tr>';
  });

  (extra || []).forEach(d => {
    summe += d.betrag;
    reihen += '<tr><td>' + d.name + ' <span class="k">(' + d.art + ')</span></td><td>' +
              (d.nachname || '') + '</td><td class="ib"></td><td class="r">' +
              euro_(d.betrag) + '</td></tr>';
  });

  const html =
    '<html><head><meta charset="utf-8"><style>' +
    'body{font-family:Arial,sans-serif;color:#111;margin:36px}' +
    '.kopf{margin-bottom:20px}' +
    '.kopf img{height:56px;display:block;margin-bottom:10px}' +
    'h1{font-size:19px;margin:0 0 4px}' +
    '.d{color:#666;font-size:12px}' +
    'table{width:100%;border-collapse:collapse;font-size:13px}' +
    'th{text-align:left;background:#eee;padding:8px;border-bottom:1px solid #999}' +
    'td{padding:8px;border-bottom:1px solid #ddd;vertical-align:top}' +
    '.r{text-align:right;white-space:nowrap}' +
    '.ib{font-size:11px;color:#444;font-family:monospace}' +
    '.hw{font-size:11px;color:#666;margin-top:3px}' +
    'tr.s td{font-weight:bold;border-top:2px solid #333;border-bottom:0}' +
    '.k{color:#666;font-size:11px}' +
    '</style></head><body>' +
    '<div class="kopf">' +
    '<img src="data:image/png;base64,' + PDF_LOGO_ + '">' +
    '<h1>Abrechnung ' + zeitraumText_(monat) + '</h1>' +
    '<div class="d">PGM Bildungszentrum, erstellt am ' +
    Utilities.formatDate(new Date(), 'Europe/Berlin', 'dd.MM.yyyy') + '</div></div>' +
    '<table><tr><th>Vorname</th><th>Nachname</th><th>IBAN</th>' +
    '<th class="r">Betrag</th></tr>' +
    reihen +
    '<tr class="s"><td>Gesamt</td><td></td><td></td><td class="r">' + euro_(summe) +
    '</td></tr></table></body></html>';

  const name = 'Abrechnung_' +
    (monat && typeof monat === 'object' ? monat.von + '_bis_' + monat.bis
                                        : String(monat)) + '.pdf';
  const blob = Utilities.newBlob(html, 'text/html', name)
                        .getAs('application/pdf').setName(name);

  const ordner = ordnerHolen_('PGM Abrechnungen');
  const alt = ordner.getFilesByName(name);
  while (alt.hasNext()) alt.next().setTrashed(true);

  const datei = ordner.createFile(blob);
  return { url: datei.getUrl(), name: name };
}


// "2026-09-21" -> "Mo 21.09."
function tagText_(d) {
  const t = String(d || '').split('-');
  if (t.length !== 3) return String(d || '');
  const w = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  let kurz = '';
  try {
    const dat = new Date(Number(t[0]), Number(t[1]) - 1, Number(t[2]), 12, 0, 0);
    kurz = w[dat.getDay()] + ' ';
  } catch (e) { kurz = ''; }
  return kurz + t[2] + '.' + t[1] + '.';
}

function std_(x) {
  if (!x) return '';
  return (Math.round(x * 100) / 100).toFixed(2).replace('.', ',');
}

// Eine Seite fuer eine Person: jeder Einsatz einzeln, damit man eine
// Rueckfrage zum Lohn Zeile fuer Zeile durchgehen kann.
function monatPersonPdf(token, monat, name) {
  AKTUELL_ = token;
  nurAdmin();
  const d = monatPerson(token, monat, name);
  const p = d.person;

  let reihen = '';
  d.zeilen.forEach(z => {
    const menge = z.einheiten ? (z.einheiten + ' Einh.')
                              : (z.stunden ? std_(z.stunden) + ' Std' : '');
    reihen += '<tr>' +
      '<td class="nw">' + tagText_(z.datum) + '</td>' +
      '<td>' + (z.schule || '') + '</td>' +
      '<td>' + (z.aufgabe || '') + '</td>' +
      '<td>' + (z.gruppe || '') + '</td>' +
      '<td class="nw">' + (z.von ? z.von + '–' + z.bis : '') + '</td>' +
      '<td class="r nw">' + menge + '</td>' +
      '<td class="r nw">' + euro_(z.betrag) + '</td>' +
      '<td class="bem">' + (z.bemerkung || '') + '</td></tr>';
  });

  if (!reihen) {
    reihen = '<tr><td colspan="8">Keine einzelnen Einsätze hinterlegt.</td></tr>';
  }

  const teil = (titel, wert, einheit) => wert
    ? '<span class="t"><b>' + titel + '</b> ' + std_(wert) + ' ' + einheit + '</span>'
    : '';

  const summenzeile =
    teil('Abholung', p.abhol, 'Std') +
    teil('Extrazeit', p.ez, 'Std') +
    teil('Empfang', p.empfang, 'Std') +
    teil('Wartezeit', p.warte, 'Std') +
    (p.but ? '<span class="t"><b>BUT</b> ' + p.but + ' Einheiten</span>' : '');

  const html =
    '<html><head><meta charset="utf-8"><style>' +
    'body{font-family:Arial,sans-serif;color:#111;margin:30px}' +
    '.kopf{margin-bottom:18px}' +
    '.kopf img{height:56px;display:block;margin-bottom:10px}' +
    'h1{font-size:19px;margin:0 0 2px}' +
    'h2{font-size:15px;margin:0 0 4px;font-weight:normal}' +
    '.d{color:#666;font-size:12px}' +
    '.sum{margin:14px 0 16px;font-size:12px;color:#333}' +
    '.sum .t{display:inline-block;margin-right:16px}' +
    'table{width:100%;border-collapse:collapse;font-size:12px}' +
    'th{text-align:left;background:#eee;padding:6px;border-bottom:1px solid #999}' +
    'td{padding:6px;border-bottom:1px solid #ddd;vertical-align:top}' +
    '.r{text-align:right}' +
    '.nw{white-space:nowrap}' +
    '.bem{font-size:11px;color:#666}' +
    'tr.s td{font-weight:bold;border-top:2px solid #333;border-bottom:0;font-size:13px}' +
    '.fuss{margin-top:16px;font-size:11px;color:#666}' +
    '</style></head><body>' +
    '<div class="kopf">' +
    '<img src="data:image/png;base64,' + PDF_LOGO_ + '">' +
    '<h1>Abrechnung ' + d.zeitraum + '</h1>' +
    '<h2>' + p.name + (p.nachname ? ' ' + p.nachname : '') + '</h2>' +
    '<div class="d">PGM Bildungszentrum, erstellt am ' +
    Utilities.formatDate(new Date(), 'Europe/Berlin', 'dd.MM.yyyy') + '</div></div>' +
    '<div class="sum">' + summenzeile + '</div>' +
    '<table><tr><th>Tag</th><th>Schule</th><th>Aufgabe</th><th>Gruppe</th>' +
    '<th>von–bis</th><th class="r">Menge</th><th class="r">Betrag</th>' +
    '<th>Bemerkung</th></tr>' + reihen +
    '<tr class="s"><td colspan="6">Gesamt</td><td class="r nw">' +
    euro_(p.betrag) + '</td><td></td></tr></table>' +
    '<div class="fuss">Stundensatz ' + euro_(SATZ_STUNDE) +
    ', BUT-Einheit ' + euro_(SATZ_EINHEIT) +
    '. Abholungen werden bis zu 15 Minuten über das Ende hinaus bezahlt, ' +
    'wenn direkt danach kein weiterer Einsatz beginnt. ' +
    'Lücken zwischen zwei Einsätzen am selben Tag gelten als Wartezeit.' +
    (p.hinweis ? '<br>' + p.hinweis : '') +
    '</div></body></html>';

  const roh = p.name + (p.nachname ? '_' + p.nachname : '') + '_' +
    (monat && typeof monat === 'object' ? monat.von + '_bis_' + monat.bis
                                        : String(monat));
  const datname = 'Abrechnung_' + roh.replace(/[^A-Za-z0-9_\-]+/g, '_') + '.pdf';

  const blob = Utilities.newBlob(html, 'text/html', datname)
                        .getAs('application/pdf').setName(datname);

  const ordner = ordnerHolen_('PGM Abrechnungen');
  const alt = ordner.getFilesByName(datname);
  while (alt.hasNext()) alt.next().setTrashed(true);

  const datei = ordner.createFile(blob);
  return { url: datei.getUrl(), name: datname };
}


// ---------- Ehrenamtliche und andere Zusätze ----------

const EHREN_TAB = 'Ehrenamtlich';

function ehrenKopf_(sh) {
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
           .map(k => String(k).trim());
}

function ehrenFuer(token, monat) {
  AKTUELL_ = token;
  nurAdmin();
  const nurMonat = !(monat && typeof monat === 'object');

  // auch inaktive, damit Externe als inaktive Mitarbeiter abgerechnet werden koennen
  const namen = leseTab('Mitarbeiter')
    .filter(m => !istAdmin_(m))
    .map(m => ({ name: String(m.Name).trim(),
                 aktiv: String(m.Aktiv).trim() === 'ja' }))
    .sort((x, y) => (x.aktiv === y.aktiv ? x.name.localeCompare(y.name)
                                         : (x.aktiv ? -1 : 1)));

  const sh = ss_().getSheetByName(EHREN_TAB);
  if (!sh || sh.getLastRow() < 2) return { personen: namen, zeilen: [] };

  const w = sh.getDataRange().getValues();
  const kopf = w.shift().map(k => String(k).trim());
  const i = n => kopf.indexOf(n);

  const zeilen = w
    .filter(z => z.join('') !== '' && nurMonat
                 && monatText_(z[i('Monat')]) === String(monat))
    .map(z => ({
      name: String(z[i('Name')] || '').trim(),
      nachname: String(z[i('Nachname')] || '').trim(),
      art: String(z[i('Art')] || '').trim(),
      stunden: Number(z[i('Stunden')]) || 0,
      satz: Number(z[i('Satz')]) || 0,
      betrag: Number(z[i('Betrag')]) || 0
    }));

  return { personen: namen, zeilen: zeilen };
}

function ehrenHinzu(token, monat, e) {
  AKTUELL_ = token;
  nurAdmin();

  const name = String(e.name || '').trim();
  const stunden = Number(e.stunden) || 0;
  const satz = Number(e.satz) || 0;
  if (!name) throw new Error('Bitte eine Person wählen');
  if (stunden <= 0) throw new Error('Bitte Stunden eintragen');

  const m = leseTab('Mitarbeiter').find(x => String(x.Name).trim() === name);
  const sh = ss_().getSheetByName(EHREN_TAB);
  if (!sh) throw new Error('Tab ' + EHREN_TAB + ' fehlt');

  const kopf = ehrenKopf_(sh);
  const feld = {
    'Monat': monat, 'Name': name,
    'Nachname': m ? String(m.Nachname || '').trim() : '',
    'Art': String(e.art || 'Ehrenamtliche Arbeit').trim(),
    'Stunden': stunden, 'Satz': satz,
    'Betrag': Math.round(stunden * satz * 100) / 100
  };

  const nr = sh.getLastRow() + 1;
  const iM = kopf.indexOf('Monat');
  if (iM >= 0) sh.getRange(nr, iM + 1).setNumberFormat('@');
  sh.getRange(nr, 1, 1, kopf.length)
    .setValues([kopf.map(k => feld[k] !== undefined ? feld[k] : '')]);

  const iB = kopf.indexOf('Betrag');
  if (iB >= 0) sh.getRange(nr, iB + 1).setNumberFormat('#,##0.00 €');

  cacheLeeren(EHREN_TAB);
  return 'ok';
}

function ehrenLoeschen(token, monat, name, art, stunden) {
  AKTUELL_ = token;
  nurAdmin();

  const sh = ss_().getSheetByName(EHREN_TAB);
  const w = sh.getDataRange().getValues();
  const kopf = w[0].map(k => String(k).trim());
  const i = n => kopf.indexOf(n);

  for (let r = w.length - 1; r >= 1; r--) {
    if (monatText_(w[r][i('Monat')]) !== monat) continue;
    if (String(w[r][i('Name')]).trim() !== String(name).trim()) continue;
    if (String(w[r][i('Art')]).trim() !== String(art).trim()) continue;
    if ((Number(w[r][i('Stunden')]) || 0) !== (Number(stunden) || 0)) continue;
    sh.deleteRow(r + 1);
    cacheLeeren(EHREN_TAB);
    return 'ok';
  }
  throw new Error('Eintrag nicht gefunden');
}


// Logo fuer den Briefkopf der PDF
const PDF_LOGO_ = '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';

// IBAN und Hinweis dauerhaft beim Mitarbeiter speichern
function personSpeichern(token, name, iban, hinweis) {
  AKTUELL_ = token;
  nurAdmin();

  const sh = ss_().getSheetByName('Mitarbeiter');
  if (!sh) throw new Error('Tab Mitarbeiter fehlt');
  const w = sh.getDataRange().getValues();
  const kopf = w[0].map(x => String(x).trim());
  const iN = kopf.indexOf('Name');
  const iI = kopf.indexOf('IBAN');
  const iH = kopf.indexOf('Hinweis');
  if (iN < 0) throw new Error('Spalte Name fehlt');
  if (iI < 0 && iH < 0) {
    throw new Error('Bitte im Tab Mitarbeiter die Spalten IBAN und Hinweis anlegen');
  }

  const ziel = String(name).trim();
  for (let r = 1; r < w.length; r++) {
    if (String(w[r][iN]).trim() !== ziel) continue;
    if (iI >= 0) sh.getRange(r + 1, iI + 1).setNumberFormat('@')
                   .setValue(String(iban || '').trim());
    if (iH >= 0) sh.getRange(r + 1, iH + 1).setValue(String(hinweis || '').trim());
    cacheLeeren('Mitarbeiter');
    return 'ok';
  }
  throw new Error(ziel + ' steht nicht im Tab Mitarbeiter');
}
