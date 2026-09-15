/**
 * NouveauDividende.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Formulaire de déclaration d'un dividende pour un associé.
 *
 * Écritures via garde-fou :
 *   A la décision d'AG :
 *     Débit 110 ou 120 (Report à nouveau / Résultat) / Crédit 457 (dividendes à payer)
 *
 *   Le versement est déclenché depuis la Fiche Associé (bouton "Verser") :
 *     Débit 457 / Crédit 512
 */
import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
    collection, getDocs, query, orderBy,
    addDoc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { ecrireEcriture } from '../services/api';
import { formatMontant, toISODate } from '../services/helpers';
import { Tooltip } from './Shared';
import { DateInput } from './common/DateInput';

const COMPTES_DEBIT = [
    { value: '110', label: '110 — Report à nouveau' },
    { value: '120', label: '120 — Résultat de l\'exercice' },
];

export function NouveauDividende({ onCreated }) {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const [associes, setAssocies] = useState([]);
    const [associeId, setAssocieId] = useState(searchParams.get('associeId') ?? '');
    const [montant, setMontant] = useState('');
    const [compteDebit, setCompteDebit] = useState('120');
    const [dateDecision, setDateDecision] = useState(toISODate(new Date()));
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [done, setDone] = useState(null);

    useEffect(() => {
        getDocs(query(collection(db, 'associes'), orderBy('nom')))
            .then((s) => setAssocies(s.docs.filter((d) => d.data().actif).map((d) => ({ id: d.id, ...d.data() }))));
    }, []);

    const associe = associes.find((a) => a.id === associeId);
    const montantNum = parseFloat(montant) || 0;

    async function handleSubmit(e) {
        e.preventDefault();
        setError('');
        if (!associeId) { setError('Sélectionnez un associé.'); return; }
        if (!montantNum) { setError('Le montant est obligatoire.'); return; }
        setSaving(true);

        try {
            const { ecritureId } = await ecrireEcriture({
                journal: 'OD',
                date: dateDecision,
                libelle: `Décision AG — dividendes ${associe.nom} ${associe.prenom}`,
                sourceType: 'dividende',
                mouvements: [
                    { compte: compteDebit, libelle: COMPTES_DEBIT.find((c) => c.value === compteDebit)?.label.split(' — ')[1], debit: montantNum, credit: 0 },
                    { compte: '457', libelle: `Dividendes à payer — ${associe.nom}`, debit: 0, credit: montantNum },
                ],
            });

            const ref = await addDoc(collection(db, 'dividendes'), {
                associeId,
                associeNom: `${associe.nom} ${associe.prenom}`.trim(),
                montant: montantNum,
                compteDebit,
                dateDecisionAG: new Date(dateDecision),
                dateVersement: null,
                statut: 'a_verser',
                ecritureDecisionId: ecritureId,
                ecritureVersementId: null,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            });

            setDone({ associeId, associeNom: associe.nom, montant: montantNum, dividendeId: ref.id });
            onCreated?.({ dividendeId: ref.id });
        } catch (e) {
            setError(e.message);
        } finally {
            setSaving(false);
        }
    }

    if (done) return (
        <div>
            <div className="notice notice--success">
                Dividende de {formatMontant(done.montant)} enregistré pour {done.associeNom}.
                L'écriture comptable AG est générée. Le versement se fait depuis la fiche associé.
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn btn--ghost" onClick={() => navigate(`/associes/${done.associeId}`)}>Voir la fiche</button>
                <button className="btn btn--primary" onClick={() => { setDone(null); setMontant(''); }}>Nouveau dividende</button>
            </div>
        </div>
    );

    return (
        <form onSubmit={handleSubmit}>
            <div className="page-header">
                <div>
                    <h1>Nouveau dividende</h1>
                    <p>Décision d'Assemblée Générale — génère l'écriture 110/120 → 457</p>
                </div>
            </div>

            {error && <div className="notice notice--danger">{error}</div>}

            <div className="card">
                <div className="card__title">Associé</div>
                <div className="form-group">
                    <label className="form-label">Associé concerné</label>
                    <select className="form-select" value={associeId} onChange={(e) => setAssocieId(e.target.value)} required>
                        <option value="">Sélectionner...</option>
                        {associes.map((a) => (
                            <option key={a.id} value={a.id}>{a.nom} {a.prenom} ({a.pourcentageParts} %)</option>
                        ))}
                    </select>
                </div>
            </div>

            <div className="card">
                <div className="card__title">
                    Montant & compte
                    <Tooltip text="Le compte 120 (Résultat de l'exercice) est utilisé quand on distribue le bénéfice de l'exercice en cours. Le compte 110 (Report à nouveau) sert à distribuer des réserves accumulées des exercices précédents." />
                </div>
                <div className="form-row">
                    <div className="form-group">
                        <label className="form-label">Montant du dividende (€)</label>
                        <input type="number" min="0.01" step="0.01" className="form-input" value={montant} onChange={(e) => setMontant(e.target.value)} required placeholder="Ex. 5000" />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Compte débité</label>
                        <select className="form-select" value={compteDebit} onChange={(e) => setCompteDebit(e.target.value)}>
                            {COMPTES_DEBIT.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                        </select>
                    </div>
                </div>
                <div className="form-group">
                    <label className="form-label">Date de décision d'AG</label>
                    <DateInput className="form-input" style={{ maxWidth: 200 }} value={dateDecision} onChange={(e) => setDateDecision(e.target.value)} required />
                </div>
            </div>

            {/* Aperçu écritures */}
            {montantNum > 0 && associe && (
                <div className="card" style={{ borderColor: '#2563eb' }}>
                    <div className="card__title">Ecritures générées (décision AG)</div>
                    <div className="table-wrap">
                        <table>
                            <thead><tr><th>Compte</th><th>Libellé</th><th style={{ textAlign: 'right' }}>Débit</th><th style={{ textAlign: 'right' }}>Crédit</th></tr></thead>
                            <tbody>
                                <tr>
                                    <td><code>{compteDebit}</code></td>
                                    <td style={{ fontSize: 12 }}>{COMPTES_DEBIT.find((c) => c.value === compteDebit)?.label.split(' — ')[1]}</td>
                                    <td style={{ textAlign: 'right' }}>{formatMontant(montantNum)}</td>
                                    <td style={{ textAlign: 'right' }}>—</td>
                                </tr>
                                <tr>
                                    <td><code>457</code></td>
                                    <td style={{ fontSize: 12 }}>Dividendes à payer — {associe.nom}</td>
                                    <td style={{ textAlign: 'right' }}>—</td>
                                    <td style={{ textAlign: 'right' }}>{formatMontant(montantNum)}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                    <p className="form-hint" style={{ marginTop: 10 }}>Le versement (457 → 512) sera enregistré depuis la fiche associé.</p>
                </div>
            )}

            <button type="submit" className="btn btn--primary" disabled={saving || !montantNum || !associeId} style={{ minWidth: 180 }}>
                {saving ? 'Enregistrement...' : 'Enregistrer la décision AG'}
            </button>
        </form>
    );
}
