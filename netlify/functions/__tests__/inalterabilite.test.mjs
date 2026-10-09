/**
 * Tests des règles d'inaltérabilité (netlify/lib/compta.js), sans serveur ni base.
 * Lancement : node netlify/functions/__tests__/inalterabilite.test.mjs
 */
import { controlerEcriture, memeContenu, estFigee, controlerPeriodeOuverte, dateCorrection, lendemain } from '../../lib/compta.js';
let echecs = 0;
const ok = (l, c) => { if (!c) echecs++; console.log(c ? '  ✅' : '  ❌', l); };
const throws = (f) => { try { f(); return false; } catch { return true; } };
const base = { journal: 'BQ', date: '2026-09-26', libelle: 'Règlement', mouvements: [{ compte: '512', debit: 177.17 }, { compte: '627', debit: 2.83 }, { compte: '411', credit: 180 }, { compte: '6278', debit: 0, credit: 0 }] };
const m = controlerEcriture(base);
ok('écriture équilibrée acceptée, lignes à 0 retirées', m.length === 3);
ok('déséquilibre refusé', throws(() => controlerEcriture({ ...base, mouvements: [{ compte: '512', debit: 10 }, { compte: '411', credit: 9 }] })));
ok('compte invalide refusé', throws(() => controlerEcriture({ ...base, mouvements: [{ compte: '9x', debit: 10 }, { compte: '411', credit: 10 }] })));
ok('montant négatif refusé', throws(() => controlerEcriture({ ...base, mouvements: [{ compte: '512', debit: -10 }, { compte: '411', credit: -10 }] })));
ok('date invalide refusée', throws(() => controlerEcriture({ ...base, date: '26/09/2026' })));
ok('écriture vide (0/0) refusée', throws(() => controlerEcriture({ ...base, mouvements: [{ compte: '512', debit: 0 }, { compte: '411', credit: 0 }] })));
const orig = { journal: 'BQ', date: new Date('2026-09-26'), libelle: 'Règlement', pieceRef: null, mouvements: m };
ok('contenu identique détecté', memeContenu(orig, { ...base, pieceRef: null }, m));
ok('montant modifié détecté', !memeContenu(orig, base, controlerEcriture({ ...base, mouvements: [{ compte: '512', debit: 180 }, { compte: '411', credit: 180 }] })));
ok('figée si validée', estFigee({ validee: true, date: new Date('2026-12-01') }, null));
ok('figée si datée dans la période validée', estFigee({ date: new Date('2026-09-26') }, '2026-09-30'));
ok('brouillard si après le verrou', !estFigee({ date: new Date('2026-10-02') }, '2026-09-30'));
ok('date dans période validée refusée', throws(() => controlerPeriodeOuverte('2026-09-15', '2026-09-30')));
ok('date après verrou acceptée', !throws(() => controlerPeriodeOuverte('2026-10-01', '2026-09-30')));
ok('correction datée en période ouverte', dateCorrection('2026-09-30') > '2026-09-30');
ok('lendemain', lendemain('2026-12-31') === '2027-01-01');
console.log(`
  Résultat : ${echecs ? echecs + ' échec(s)' : 'tous les tests réussis'}`);
process.exitCode = echecs ? 1 : 0;
